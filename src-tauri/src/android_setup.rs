//! Automatic dependency setup for Android (first run).
//!
//! Downloads a minimal Termux aarch64 runtime (Python 3 + ffmpeg + all shared
//! libraries), the yt-dlp script and a TLS CA bundle, then extracts everything
//! into the app's private storage — no runtime permissions are required.
//!
//! Layout after setup:
//! ```text
//! <app_data_dir>/ytgrab-deps/
//!   bin/
//!     termux/usr/bin/python3        (Termux CPython)
//!     termux/usr/bin/ffmpeg
//!     termux/usr/lib/...            (shared libs, $ORIGIN rpaths)
//!     termux/usr/lib/python3.X/     (standard library)
//!     termux/usr/ssl/certs/ca-bundle.crt
//!     yt-dlp                        (yt-dlp script)
//!   tmp/                            (writable TMPDIR)
//! ```

use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use tauri::Emitter;
use tauri::Manager;

const TERMUX_BASE: &str = "https://packages.termux.dev/apt/termux-main";
const PACKAGES_INDEX: &str =
    "https://packages.termux.dev/apt/termux-main/dists/stable/main/binary-aarch64/Packages.gz";
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
const CA_BUNDLE_URL: &str = "https://curl.se/ca/cacert.pem";

#[derive(Debug, Clone, serde::Serialize)]
pub struct SetupProgress {
    pub stage: String,
    pub percent: f64,
    pub message: String,
}

/// Shared with `linux_setup`: both first-run setups report through the same
/// `setup-progress` event, so the frontend overlay is identical on both.
pub fn emit(app: &tauri::AppHandle, stage: &str, percent: f64, message: &str) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            stage: stage.to_string(),
            percent,
            message: message.to_string(),
        },
    );
}

// ---------------------------------------------------------------------------
// Termux apt index
// ---------------------------------------------------------------------------

struct PkgInfo {
    version: String,
    depends: String,
    recommends: String,
    filename: String,
}

fn is_field_key(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Parse an apt "Packages" index into `{name: [versions]}`.
/// A new stanza begins at every `Package:` line.
fn parse_index(text: &str) -> HashMap<String, Vec<PkgInfo>> {
    let mut pkgs: HashMap<String, Vec<PkgInfo>> = HashMap::new();
    let mut name: String = String::new();
    let mut info: Option<PkgInfo> = None;

    for line in text.lines() {
        // Field lines start at column 0 ("Key: value"); indented lines are
        // continuations of multi-line fields and can be ignored here.
        if line.is_empty() || line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let (key, value) = match line.split_once(':') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => continue,
        };
        if !is_field_key(key) {
            continue;
        }
        match key.to_ascii_lowercase().as_str() {
            "package" => {
                if !name.is_empty() {
                    if let Some(p) = info.take() {
                        pkgs.entry(name.clone()).or_default().push(p);
                    }
                }
                name = value.to_string();
                info = Some(PkgInfo {
                    version: String::new(),
                    depends: String::new(),
                    recommends: String::new(),
                    filename: String::new(),
                });
            }
            "version" => {
                if let Some(p) = info.as_mut() {
                    p.version = value.to_string();
                }
            }
            "depends" => {
                if let Some(p) = info.as_mut() {
                    p.depends = value.to_string();
                }
            }
            "recommends" => {
                if let Some(p) = info.as_mut() {
                    p.recommends = value.to_string();
                }
            }
            "filename" => {
                if let Some(p) = info.as_mut() {
                    p.filename = value.to_string();
                }
            }
            _ => {}
        }
    }
    if !name.is_empty() {
        if let Some(p) = info.take() {
            pkgs.entry(name).or_default().push(p);
        }
    }
    pkgs
}

fn version_key(v: &str) -> Vec<(u8, u64, String)> {
    v.split(|c: char| c == '.' || c == '-' || c == '+' || c == '~' || c == ':')
        .map(|chunk| {
            if let Ok(n) = chunk.parse::<u64>() {
                (1, n, String::new())
            } else {
                (0, 0, chunk.to_string())
            }
        })
        .collect()
}

/// Concrete package names required by a Depends/Recommends field.
/// Handles version constraints ("libz (>= 1.2)") and alternatives ("a | b").
fn dep_names(field: &str, known: &HashSet<String>) -> Vec<String> {
    let mut names = Vec::new();
    for dep in field.split(',') {
        let dep = dep.trim();
        if dep.is_empty() {
            continue;
        }
        let mut chosen: Option<String> = None;
        for alt in dep.split('|') {
            let name = alt
                .split(|c: char| c.is_whitespace() || c == '(')
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if name.is_empty() {
                continue;
            }
            if known.contains(&name) {
                chosen = Some(name);
                break;
            }
        }
        if chosen.is_none() {
            // No known alternative (possibly a virtual package): keep the first.
            if let Some(first) = dep.split('|').next() {
                let name = first
                    .split(|c: char| c.is_whitespace() || c == '(')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !name.is_empty() {
                    chosen = Some(name);
                }
            }
        }
        if let Some(n) = chosen {
            if !names.contains(&n) {
                names.push(n);
            }
        }
    }
    names
}

/// Resolve the full closure (Depends + Recommends) for the seed packages.
/// Returns `(package, filename)` pairs, sorted by name.
fn resolve_closure(
    pkgs: &HashMap<String, Vec<PkgInfo>>,
    seeds: &[&str],
) -> Result<Vec<(String, String)>, String> {
    let known: HashSet<String> = pkgs.keys().cloned().collect();
    let mut closure: HashSet<String> = HashSet::new();
    let mut missing: HashSet<String> = HashSet::new();
    let mut queue: Vec<String> = seeds.iter().map(|s| s.to_string()).collect();

    while let Some(name) = queue.pop() {
        if closure.contains(&name) {
            continue;
        }
        let Some(versions) = pkgs.get(&name) else {
            missing.insert(name);
            continue;
        };
        closure.insert(name.clone());
        let best = versions
            .iter()
            .max_by(|a, b| version_key(&a.version).cmp(&version_key(&b.version)))
            .unwrap();
        for field in [&best.depends, &best.recommends] {
            for dep in dep_names(field, &known) {
                if !closure.contains(&dep) && !missing.contains(&dep) {
                    queue.push(dep);
                }
            }
        }
    }

    missing.retain(|m| !closure.contains(m));
    if !missing.is_empty() {
        let list: Vec<String> = missing.iter().cloned().collect();
        eprintln!("aviso: dependências não encontradas no índice: {}", list.join(", "));
    }

    for seed in seeds {
        if !closure.contains(*seed) {
            return Err(format!(
                "O pacote '{seed}' não foi encontrado no repositório Termux"
            ));
        }
    }

    let mut names: Vec<&String> = closure.iter().collect();
    names.sort();
    let mut result: Vec<(String, String)> = Vec::new();
    for name in names {
        let versions = &pkgs[name];
        let best = versions
            .iter()
            .max_by(|a, b| version_key(&a.version).cmp(&version_key(&b.version)))
            .unwrap();
        if best.filename.is_empty() {
            return Err(format!("O pacote '{name}' não tem Filename no índice"));
        }
        result.push((name.clone(), best.filename.clone()));
    }
    Ok(result)
}

/// Compact listing of directory entries for diagnostic error messages
/// (capped, so the text stays readable in the UI overlay).
fn bin_listing(dir: &Path) -> String {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .filter_map(|e| e.file_name().to_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    if names.is_empty() {
        return "(nenhum arquivo!)".to_string();
    }
    let shown: Vec<&str> = names.iter().take(40).map(|n| n.as_str()).collect();
    let mut s = shown.join(", ");
    if names.len() > 40 {
        s.push_str(&format!(" (+{} outros)", names.len() - 40));
    }
    s
}

// ---------------------------------------------------------------------------
// .deb (ar) and tar handling
// ---------------------------------------------------------------------------

/// Extract the compressed tar member (`data.tar.xz` / `data.tar.gz`) from a
/// `.deb` (ar) image. Returns `(compression, tar-bytes)`.
/// GNU `ar` stores member names in a 16-byte field, space-padded and usually
/// terminated with `/` (`data.tar.xz/` rather than `data.tar.xz`). Without
/// stripping that slash the compression suffix becomes `"xz/"` and unpacking
/// fails with "compressão não suportada".
fn ar_member_name(header: &[u8]) -> String {
    let raw = std::str::from_utf8(&header[0..16]).unwrap_or("").trim();
    raw.trim_end_matches('/').trim().to_string()
}

fn deb_data_tar(bytes: &[u8]) -> Result<(String, Vec<u8>), String> {
    if bytes.len() < 8 || &bytes[0..8] != b"!<arch>\n" {
        return Err("arquivo .deb inválido (magic não reconhecido)".into());
    }
    let mut off = 8usize;
    while off + 60 <= bytes.len() {
        let name = ar_member_name(&bytes[off..off + 60]);
        let size_str = std::str::from_utf8(&bytes[off + 48..off + 58])
            .unwrap_or("0")
            .trim();
        let size = size_str
            .parse::<usize>()
            .map_err(|_| "cabeçalho ar inválido".to_string())?;
        off += 60;
        if off + size > bytes.len() {
            return Err("arquivo .deb truncado".into());
        }
        if name.starts_with("data.tar.") || name == "data.tar" {
            let fmt = if name == "data.tar" {
                "tar".to_string()
            } else {
                name.rsplit('.')
                    .next()
                    .unwrap_or("")
                    .trim_end_matches('/')
                    .to_ascii_lowercase()
            };
            let data = bytes[off..off + size].to_vec();
            return Ok((fmt, data));
        }
        // ar members are padded to a 2-byte boundary
        off += size + (size % 2);
    }
    Err("membro data.tar não encontrado no .deb".into())
}

/// Decompress the tar payload and unpack it into `dest`.
fn unpack_tar_into(data: &[u8], fmt: &str, dest: &Path) -> Result<(), String> {
    let payload: Vec<u8> = match fmt {
        "gz" | "gzip" => {
            let mut dec = flate2::read::GzDecoder::new(&data[..]);
            let mut buf = Vec::new();
            dec.read_to_end(&mut buf)
                .map_err(|e| format!("falha ao descomprimir gzip: {e}"))?;
            buf
        }
        "xz" => {
            let mut dec = xz2::read::XzDecoder::new(&data[..]);
            let mut buf = Vec::new();
            dec.read_to_end(&mut buf)
                .map_err(|e| format!("falha ao descomprimir xz: {e}"))?;
            buf
        }
        "tar" | "" => data.to_vec(),
        other => {
            return Err(format!(
                "compressão '{other}' do .deb não suportada (esperado xz ou gz)"
            ))
        }
    };
    let mut archive = tar::Archive::new(Cursor::new(payload));
    archive
        .unpack(dest)
        .map_err(|e| format!("falha ao extrair o pacote: {e}"))
}

// ---------------------------------------------------------------------------
// Permissions helpers
// ---------------------------------------------------------------------------

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    if dir.is_file() {
        out.push(dir.to_path_buf());
        return;
    }
    if !dir.is_dir() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                collect_files(&p, out);
            } else {
                out.push(p);
            }
        }
    }
}

/// Make binaries, the yt-dlp script and shared libraries executable.
#[cfg(unix)]
fn make_executable(bin: &Path, termux: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let exec = std::fs::Permissions::from_mode(0o755);

    // Everything in termux/usr/bin (python3, ffmpeg, ...)
    let mut files: Vec<PathBuf> = Vec::new();
    collect_files(&termux.join("usr").join("bin"), &mut files);
    for f in files {
        std::fs::set_permissions(&f, exec.clone())?;
    }

    // The yt-dlp script
    let script = bin.join("yt-dlp");
    if script.exists() {
        std::fs::set_permissions(&script, exec.clone())?;
    }

    // Shared libraries (defensive: the tar header already carries the modes)
    let mut all: Vec<PathBuf> = Vec::new();
    collect_files(termux, &mut all);
    for f in all {
        if let Some(n) = f.file_name().and_then(|s| s.to_str()) {
            if n.contains(".so") {
                let _ = std::fs::set_permissions(&f, exec.clone());
            }
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_bin: &Path, _termux: &Path) -> std::io::Result<()> {
    Ok(())
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/// Only one setup may run at a time. Android can reload the webview (which
/// resets the JS-side guard) while a previous setup task is still running in
/// Rust — without this lock, the second run would `remove_dir_all` the first
/// run's half-extracted prefix and both runs would fail with a bogus
/// "instalação incompleta". A second caller simply waits; when the lock is
/// released it hits the idempotency check below and returns immediately if
/// the first run succeeded.
static SETUP_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

pub async fn run(app: tauri::AppHandle) -> Result<String, String> {
    if std::env::consts::ARCH != "aarch64" {
        return Err(format!(
            "A versão embutida do YTGrab suporta apenas dispositivos ARM64 (seu aparelho é {}).",
            std::env::consts::ARCH
        ));
    }

    let _setup_guard = SETUP_LOCK.lock().await;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erro ao obter o diretório do app: {e}"))?;
    let root = data_dir.join("ytgrab-deps");
    let bin = root.join("bin");
    let termux = bin.join("termux");
    let pybin = termux.join("usr").join("bin");

    // Idempotency: a previous run finished successfully → nothing to download.
    // (Covers webview reloads after a successful setup without re-wiping.)
    let has_python = pybin.join("python3").is_file()
        || std::fs::read_dir(&pybin)
            .map(|it| {
                it.flatten().any(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .starts_with("python3.")
                        && e.path().is_file()
                })
            })
            .unwrap_or(false);
    if root
        .join(".setup-ok")
        .is_file()
        && has_python
        && pybin.join("ffmpeg").is_file()
        && bin.join("yt-dlp").is_file()
    {
        emit(&app, "done", 100.0, "Tudo pronto!");
        return Ok("Dependências já instaladas automaticamente!".to_string());
    }

    // Start from a clean state (a half-finished setup from a previous run is
    // simply redone). Only the extracted prefix is wiped — never the rest of
    // bin/ (e.g. a previously written yt-dlp script).
    if termux.exists() {
        std::fs::remove_dir_all(&termux).map_err(|e| format!("Erro ao limpar a instalação anterior: {e}"))?;
    }
    std::fs::create_dir_all(&termux).map_err(|e| e.to_string())?;

    // 1) Resolve the package list (Termux stable, aarch64)
    emit(&app, "index", 1.0, "Buscando a lista de pacotes...");
    let index_bytes = reqwest::get(PACKAGES_INDEX)
        .await
        .map_err(|e| format!("Falha ao baixar o índice do Termux (verifique sua internet): {e}"))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let mut index_text = String::new();
    {
        let mut gz = Cursor::new(&index_bytes[..]);
        flate2::read::GzDecoder::new(&mut gz)
            .read_to_string(&mut index_text)
            .map_err(|e| format!("Falha ao descomprimir o índice: {e}"))?;
    }

    emit(&app, "index", 3.0, "Calculando os pacotes necessários (python + ffmpeg)...");
    let pkgs = parse_index(&index_text);
    let closure = resolve_closure(&pkgs, &["python", "ffmpeg"])
        .map_err(|e| format!("Erro ao resolver as dependências do Termux: {e}"))?;
    let total = closure.len();

    // 2) Download and extract every .deb into the prefix
    let client = reqwest::Client::new();
    for (i, (name, filename)) in closure.iter().enumerate() {
        let pct = 3.0 + 77.0 * (i as f64) / total as f64;
        emit(
            &app,
            "download",
            pct,
            &format!("Baixando {name} ({}/{})", i + 1, total),
        );
        let url = format!("{TERMUX_BASE}/{filename}");
        let bytes = client
            .get(url.as_str())
            .send()
            .await
            .map_err(|e| format!("Falha ao baixar {name}: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Erro HTTP ao baixar {name}: {e}"))?
            .bytes()
            .await
            .map_err(|e| format!("Falha ao ler {name}: {e}"))?;
        let (fmt, tar_bytes) = deb_data_tar(&bytes).map_err(|e| format!("{name}: {e}"))?;
        unpack_tar_into(&tar_bytes, &fmt, &termux)
            .map_err(|e| format!("{name}: {e}"))?;

        // Per-package sanity: both `python` and `ffmpeg` have become
        // metapackages or have moved their binaries in the past (Termux 3.14
        // transition). For now we only warn here and let the final
        // verification (which also handles the python3 -> python3.X symlink
        // dance and lists usr/bin) decide. The CI guard
        // ci/termux_deb_check.py does the strict layout check.
        if name == "ffmpeg" {
            let pybin = termux.join("usr").join("bin");
            if !pybin.join("ffmpeg").exists() {
                eprintln!(
                    "aviso: pacote 'ffmpeg' extraído mas ainda sem ffmpeg em usr/bin (metapacote? aguardando dependências): {}",
                    bin_listing(&pybin)
                );
            }
        } else if name == "python" {
            let pybin = termux.join("usr").join("bin");
            let mut has = false;
            if let Ok(entries) = std::fs::read_dir(&pybin) {
                for entry in entries.flatten() {
                    let file_name = entry.file_name();
                    let Some(n) = file_name.to_str() else { continue };
                    if n == "python3" || (n.starts_with("python3.") && pybin.join(n).is_file()) {
                        has = true;
                        break;
                    }
                }
            }
            if !has {
                eprintln!(
                    "aviso: pacote 'python' extraído mas ainda sem python3* em usr/bin (metapacote? aguardando dependências): {}",
                    bin_listing(&pybin)
                );
            }
        }
    }

    // Make sure `python3` exists (some builds only ship `python3.X`)
    let pybin = termux.join("usr").join("bin");
    let python = pybin.join("python3");
    if !python.exists() {
        let mut candidates: Vec<(Vec<(u8, u64, String)>, String)> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&pybin) {
            for entry in entries.flatten() {
                let n = match entry.file_name().to_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                if n.starts_with("python3") && n != "python3" {
                    let minor = n.trim_start_matches("python3.");
                    candidates.push((version_key(&minor), n));
                }
            }
        }
        candidates.sort();
        if let Some((_, cand)) = candidates.pop() {
            let from = pybin.join(&cand);
            if from.is_file() {
                std::fs::copy(&from, &python)
                    .map_err(|e| format!("Erro ao criar python3 a partir de {cand}: {e}"))?;
            }
        }
    }

    // 3) yt-dlp script
    emit(&app, "ytdlp", 81.0, "Baixando o yt-dlp...");
    let ytdlp_bytes = client
        .get(YTDLP_URL)
        .send()
        .await
        .map_err(|e| format!("Falha ao baixar o yt-dlp: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Erro HTTP ao baixar o yt-dlp: {e}"))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let ytdlp_path = bin.join("yt-dlp");
    std::fs::write(&ytdlp_path, &ytdlp_bytes)
        .map_err(|e| format!("Erro ao salvar o yt-dlp: {e}"))?;

    // 4) CA bundle (the Termux libssl was built with a hardcoded CA path,
    //    which varies between builds; make sure a known location is valid)
    let prefix = termux.join("usr");
    let ca_candidates = [
        prefix.join("ssl").join("certs").join("ca-bundle.crt"),
        prefix.join("etc").join("tls").join("cert.pem"),
        prefix.join("etc").join("ssl").join("cert.pem"),
    ];
    if !ca_candidates.iter().any(|c| c.is_file()) {
        emit(&app, "ca", 84.0, "Baixando os certificados de segurança...");
        let ca_bytes = client
            .get(CA_BUNDLE_URL)
            .send()
            .await
            .map_err(|e| format!("Falha ao baixar os certificados: {e}"))?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;
        let ca = ca_candidates[0].clone();
        if let Some(parent) = ca.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&ca, &ca_bytes)
            .map_err(|e| format!("Erro ao salvar os certificados: {e}"))?;
    }

    // 5) Permissions
    emit(&app, "perms", 87.0, "Preparando os arquivos...");
    make_executable(&bin, &termux)
        .map_err(|e| format!("Erro ao definir as permissões: {e}"))?;

    // 6) Verify the runtime actually works (a broken prefix should fail
    //    loudly here, not at download time)
    emit(&app, "check", 93.0, "Verificando o runtime...");
    let ffmpeg = pybin.join("ffmpeg");
    let mut missing: Vec<&str> = Vec::new();
    if !python.is_file() {
        missing.push("usr/bin/python3");
    }
    if !ffmpeg.is_file() {
        missing.push("usr/bin/ffmpeg");
    }
    if !ytdlp_path.is_file() {
        missing.push("bin/yt-dlp");
    }
    if !missing.is_empty() {
        return Err(format!(
            "Instalação incompleta: {} não encontrado(s) após extrair os pacotes. Conteúdo de usr/bin: {} — envie esta mensagem.",
            missing.join(", "),
            bin_listing(&pybin)
        ));
    }
    let tmp = root.join("tmp");
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let mut probe = std::process::Command::new(&python);
    probe
        .env("PYTHONHOME", &prefix)
        .env("LD_LIBRARY_PATH", prefix.join("lib"))
        .env("TMPDIR", &tmp)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(ca) = ca_candidates.iter().find(|c| c.is_file()) {
        probe.env("SSL_CERT_FILE", ca);
    }
    probe.arg("-c").arg(
        "import ssl, sys; sys.stderr.write(sys.version.split()[0] + ' ' + ssl.OPENSSL_VERSION)",
    );
    let out = probe
        .output()
        .map_err(|e| format!("Erro ao iniciar o Python embutido: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "O Python embutido não inicializou: {err} Tente novamente, ou verifique a internet e o espaço no aparelho."
        ));
    }

    let ff_out = std::process::Command::new(&ffmpeg)
        .env("LD_LIBRARY_PATH", prefix.join("lib"))
        .arg("-version")
        .output()
        .map_err(|e| format!("Erro ao iniciar o ffmpeg embutido: {e}"))?;
    if !ff_out.status.success() {
        let err = String::from_utf8_lossy(&ff_out.stderr);
        return Err(format!("O ffmpeg embutido não funcionou: {err} Tente novamente."));
    }

    let _ = std::fs::write(root.join(".setup-ok"), "ok");

    emit(&app, "done", 100.0, "Tudo pronto!");
    Ok("Dependências instaladas automaticamente!".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ar_header(name: &str, size: usize) -> Vec<u8> {
        let mut h = vec![b' '; 60];
        let name_bytes = name.as_bytes();
        h[..name_bytes.len()].copy_from_slice(name_bytes);
        let size_s = size.to_string();
        let size_b = size_s.as_bytes();
        h[48..48 + size_b.len()].copy_from_slice(size_b);
        h[58] = b'`';
        h[59] = b'\n';
        h
    }

    fn make_ar(members: &[(&str, &[u8])]) -> Vec<u8> {
        let mut out = b"!<arch>\n".to_vec();
        for (name, data) in members {
            out.extend_from_slice(&ar_header(name, data.len()));
            out.extend_from_slice(data);
            if data.len() % 2 == 1 {
                out.push(b'\n');
            }
        }
        out
    }

    #[test]
    fn deb_data_tar_strips_gnu_ar_trailing_slash() {
        let payload = b"not-really-xz-but-ok";
        let bytes = make_ar(&[
            ("debian-binary/", b"2.0\n"),
            ("data.tar.xz/", payload),
        ]);
        let (fmt, data) = deb_data_tar(&bytes).expect("parse");
        assert_eq!(fmt, "xz");
        assert_eq!(data, payload);
    }

    #[test]
    fn deb_data_tar_accepts_name_without_slash() {
        let payload = b"gzip-payload";
        let bytes = make_ar(&[("data.tar.gz", payload)]);
        let (fmt, data) = deb_data_tar(&bytes).expect("parse");
        assert_eq!(fmt, "gz");
        assert_eq!(data, payload);
    }

    /// Round-trip against a REAL Termux .deb. CI downloads one from the current
    /// index (via the `DEB_FIXTURE` env var) so that changes in the repo
    /// (member names, compression) break the build instead of the first run
    /// on a real device. Skipped when `DEB_FIXTURE` is not set.
    #[test]
    fn real_termux_deb_parses_and_unpacks() {
        let Some(path) = std::env::var("DEB_FIXTURE").ok() else {
            eprintln!("(teste ignorado: DEB_FIXTURE não definido)");
            return;
        };
        let bytes = std::fs::read(&path).expect("ler o .deb de teste");
        let (fmt, tar_bytes) = deb_data_tar(&bytes).expect("parse do ar no .deb real");
        assert!(
            matches!(fmt.as_str(), "xz" | "gz"),
            "compressão inesperada no .deb real: {fmt}"
        );
        let dest = std::env::temp_dir().join(format!(
            "ytgrab-deb-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dest).expect("criar dir de teste");
        unpack_tar_into(&tar_bytes, &fmt, &dest).expect("extrair data.tar do .deb real");
        let entries = std::fs::read_dir(&dest)
            .expect("ler dir de teste")
            .count();
        assert!(entries > 0, "extração vazia");
        let _ = std::fs::remove_dir_all(&dest);
    }
}
