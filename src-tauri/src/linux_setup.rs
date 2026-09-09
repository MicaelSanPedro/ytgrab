//! Automatic dependency setup for Linux desktop (first run).
//!
//! Downloads the standalone yt-dlp binary and a fully static ffmpeg build,
//! then stores both in the app's own data directory — nothing needs to be
//! installed system-wide and no root permission is required.
//!
//! The binaries come from the AppImage whenever they are bundled with it
//! (see `commands::find_ytdlp`); this module only runs when they are missing,
//! so a user who deleted them, or who is running the `.deb`, can recover with
//! the same "Reinstalar dependências" button Android already uses.
//!
//! Layout after setup (identical to Android, so both share the lookup order):
//! ```text
//! <app_data_dir>/ytgrab-deps/
//!   bin/
//!     yt-dlp     (standalone binary, Python embedded)
//!     ffmpeg     (static build, no shared libraries)
//!     ffprobe    (static build, optional)
//!   tmp/         (writable TMPDIR)
//! ```

use std::path::{Path, PathBuf};
use tauri::Manager;
use tokio::io::AsyncWriteExt;

use crate::android_setup::emit;

/// Standalone Linux binary: ships its own Python, so the host distro does not
/// need `python3` installed.
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

/// johnvansickle static builds: `--enable-static`, no shared library
/// dependencies, and built with libmp3lame (so `-x --audio-format mp3` works).
fn ffmpeg_url() -> Result<String, String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => {
            return Err(format!(
                "Não há build estático do ffmpeg para a arquitetura {other}."
            ))
        }
    };
    Ok(format!(
        "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-{arch}-static.tar.xz"
    ))
}

/// Same lock Android uses: webview reloads must not start two setups at once.
static SETUP_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Writable directory that holds the downloaded dependencies.
///
/// Public so `commands` can search it: an AppImage is mounted read-only, so
/// this is the only place the app is ever allowed to write binaries to.
pub fn deps_bin_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erro ao obter o diretório do app: {e}"))?;
    Ok(data.join("ytgrab-deps").join("bin"))
}

/// Writable TMPDIR, created on demand (the AppImage mount is read-only).
pub fn tmp_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erro ao obter o diretório do app: {e}"))?;
    let tmp = data.join("ytgrab-deps").join("tmp");
    std::fs::create_dir_all(&tmp).map_err(|e| format!("Erro ao criar o diretório temporário: {e}"))?;
    Ok(tmp)
}

/// Download and install both dependencies.
///
/// `force` ignores the `.setup-ok` marker: that is what the "Reinstalar
/// dependências" button asks for, and it also makes a retry possible after a
/// verification failure.
pub async fn run(app: tauri::AppHandle, force: bool) -> Result<String, String> {
    if std::env::consts::ARCH != "x86_64" && std::env::consts::ARCH != "aarch64" {
        return Err(format!(
            "O YTGrab para Linux suporta apenas x86_64 e ARM64 (seu computador é {}).",
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
    std::fs::create_dir_all(&bin)
        .map_err(|e| format!("Erro ao criar o diretório de dependências: {e}"))?;

    // Idempotency: a previous run finished successfully → nothing to download.
    if !force
        && root.join(".setup-ok").is_file()
        && bin.join("yt-dlp").is_file()
        && bin.join("ffmpeg").is_file()
    {
        emit(&app, "done", 100.0, "Tudo pronto!");
        return Ok("Dependências já estão instaladas.".to_string());
    }

    if force {
        let _ = std::fs::remove_file(root.join(".setup-ok"));
    }

    // 1) yt-dlp — a single self-contained binary (~39 MB).
    emit(&app, "ytdlp", 4.0, "Baixando o yt-dlp...");
    let ytdlp = bin.join("yt-dlp");
    let bytes = download_with_progress(&app, "ytdlp", YTDLP_URL, 4.0, 34.0).await?;
    write_executable(&ytdlp, &bytes)?;

    // 2) ffmpeg — static build, streamed straight out of the .tar.xz so the
    //    archive never has to fit in memory.
    emit(&app, "ffmpeg", 36.0, "Baixando o ffmpeg (build estático)...");
    let ffmpeg = bin.join("ffmpeg");
    let ffprobe = bin.join("ffprobe");
    let tmp_tar = bin.join("ffmpeg-static.tar.xz");
    download_to_file_with_progress(&app, "ffmpeg", &ffmpeg_url()?, &tmp_tar, 36.0, 84.0).await?;

    emit(&app, "ffmpeg", 85.0, "Extraindo o ffmpeg...");
    extract_static_ffmpeg(&tmp_tar, &ffmpeg, &ffprobe)
        .map_err(|e| format!("Erro ao extrair o ffmpeg: {e}"))?;
    let _ = std::fs::remove_file(&tmp_tar);
    // `extract_static_ffmpeg` already guarantees the executable bit.

    // 3) Sanity check: the binaries must actually run.
    emit(&app, "check", 92.0, "Verificando o yt-dlp e o ffmpeg...");
    verify(&app, &bin).await?;

    std::fs::write(root.join(".setup-ok"), b"ok")
        .map_err(|e| format!("Erro ao gravar a marcação de instalação: {e}"))?;

    emit(&app, "done", 100.0, "Tudo pronto!");
    Ok(format!(
        "yt-dlp e ffmpeg instalados em: {}",
        bin.display()
    ))
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/// Download `url` fully into memory, emitting `setup-progress` on the way.
async fn download_with_progress(
    app: &tauri::AppHandle,
    stage: &str,
    url: &str,
    _from: f64,
    to: f64,
) -> Result<Vec<u8>, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Falha ao baixar {url} (verifique sua internet): {e}"))?
        .error_for_status()
        .map_err(|e| format!("Erro HTTP ao baixar {url}: {e}"))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Falha ao ler {url}: {e}"))?;
    emit(app, stage, to, "Download concluído.");
    Ok(bytes.to_vec())
}

/// Stream `url` into `dest`, emitting `setup-progress` as the bytes arrive.
/// Used for the big ffmpeg archive: streaming keeps the memory footprint flat
/// on the small devices the AppImage is expected to run on.
async fn download_to_file_with_progress(
    app: &tauri::AppHandle,
    stage: &str,
    url: &str,
    dest: &Path,
    from: f64,
    to: f64,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Falha ao baixar o ffmpeg (verifique sua internet): {e}"))?
        .error_for_status()
        .map_err(|e| format!("Erro HTTP ao baixar o ffmpeg: {e}"))?;

    let total = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Erro ao criar {}: {e}", dest.display()))?;
    let mut stream = response.bytes_stream();
    let mut done: u64 = 0;
    let mut last_pct = 0.0f64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Falha ao ler o download do ffmpeg: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Erro ao gravar o arquivo: {e}"))?;
        done += chunk.len() as u64;

        // Emit at most ~1% at a time: enough feedback, no event spam.
        if total > 0 {
            let pct = from + (to - from) * (done as f64 / total as f64);
            if pct - last_pct >= 1.0 {
                last_pct = pct;
                let mb = done as f64 / (1024.0 * 1024.0);
                emit(
                    app,
                    stage,
                    pct,
                    &format!("Baixando o ffmpeg... {mb:.1} MB"),
                );
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Erro ao finalizar o arquivo: {e}"))?;
    if done == 0 {
        return Err("O download do ffmpeg veio vazio.".to_string());
    }
    emit(app, stage, to, "Download concluído.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Extraction / permissions
// ---------------------------------------------------------------------------

/// Pull the top-level `ffmpeg` (and `ffprobe`, when present) out of the
/// johnvansickle `ffmpeg-<version>-<arch>-static.tar.xz` archive.
///
/// Only those two members are extracted: the tarball also ships manpages and
/// whisper models we do not need, which keeps the install small.
fn extract_static_ffmpeg(archive: &Path, ffmpeg: &Path, ffprobe: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("Não consegui abrir o arquivo: {e}"))?;
    let xz = xz2::read::XzDecoder::new(file);
    let mut ar = tar::Archive::new(xz);

    let mut got_ffmpeg = false;
    let mut got_ffprobe = false;

    for entry in ar.entries().map_err(|e| format!("Arquivo inválido: {e}"))? {
        let mut entry = entry.map_err(|e| format!("Falha ao ler o arquivo: {e}"))?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let raw = entry
            .path()
            .map_err(|e| format!("Caminho inválido no arquivo: {e}"))?
            .to_string_lossy()
            .to_string();
        let name = raw.rsplit('/').next().unwrap_or("");

        let dest = if name == "ffmpeg" {
            ffmpeg
        } else if name == "ffprobe" {
            ffprobe
        } else {
            continue;
        };

        // Read the mode before moving the entry: `entry.path()` borrows it.
        let mode = entry.header().mode().unwrap_or(0o755);

        let mut out =
            std::fs::File::create(dest).map_err(|e| format!("Erro ao criar {name}: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("Erro ao gravar {name}: {e}"))?;
        drop(out);

        // The `tar` crate does not apply the entry mode, and `File::create`
        // obeys the umask — so without this the binary lands as 0644 and
        // cannot be executed. Keep the archive's mode and always force +x.
        set_mode(dest, mode)?;

        if name == "ffmpeg" {
            got_ffmpeg = true;
        } else {
            got_ffprobe = true;
        }
    }

    if !got_ffmpeg {
        return Err("O binário ffmpeg não foi encontrado no arquivo baixado.".to_string());
    }
    let _ = got_ffprobe; // ffprobe is optional: yt-dlp works without it.
    Ok(())
}

/// Apply `mode` to `path`, always keeping the executable bits on.
#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut m = mode & 0o7777;
    if m & 0o111 == 0 {
        m |= 0o755;
    }
    let perms = std::fs::Permissions::from_mode(m);
    std::fs::set_permissions(path, perms)
        .map_err(|e| format!("Erro ao definir permissões de {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

fn write_executable(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes)
        .map_err(|e| format!("Erro ao salvar {}: {e}", path.display()))?;
    make_executable(path)
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o755);
    std::fs::set_permissions(path, perms)
        .map_err(|e| format!("Erro ao definir permissões de {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/// Make sure both binaries really run before declaring the setup finished —
/// the same guard Android applies, so a truncated download is retried instead
/// of failing later, at download time.
async fn verify(app: &tauri::AppHandle, bin: &Path) -> Result<(), String> {
    let tmp = tmp_dir(app)?;

    let mut cmd = tokio::process::Command::new(bin.join("yt-dlp"));
    cmd.arg("--version")
        .env("TMPDIR", &tmp)
        .env("TMP", &tmp)
        .env("TEMP", &tmp)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let out = tokio::time::timeout(std::time::Duration::from_secs(90), cmd.output())
        .await
        .map_err(|_| "Tempo esgotado ao executar o yt-dlp.".to_string())?
        .map_err(|e| format!("Não foi possível executar o yt-dlp: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("O yt-dlp não executou corretamente: {}", err.trim()));
    }
    let version = String::from_utf8_lossy(&out.stdout).trim().to_string();

    let ffmpeg = bin.join("ffmpeg");
    if !ffmpeg.is_file() {
        return Err("O ffmpeg não foi instalado.".to_string());
    }
    let size = std::fs::metadata(&ffmpeg).map(|m| m.len()).unwrap_or(0);
    if size < 1024 * 1024 {
        return Err(format!(
            "O ffmpeg baixado está incompleto ({} bytes).",
            size
        ));
    }

    emit(
        app,
        "check",
        96.0,
        &format!("yt-dlp {version} + ffmpeg prontos."),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip against a REAL johnvansickle archive. CI downloads one (via
    /// the `FFMPEG_FIXTURE` env var) so that a change in the upstream layout —
    /// a renamed member, a different compression — breaks the build instead of
    /// the first run on a real machine. Skipped when the var is not set.
    #[test]
    fn real_static_ffmpeg_extracts() {
        let Some(path) = std::env::var("FFMPEG_FIXTURE").ok() else {
            eprintln!("(teste ignorado: FFMPEG_FIXTURE não definido)");
            return;
        };

        let dir = std::env::temp_dir().join(format!("ytgrab-ffmpeg-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("criar dir de teste");
        let ffmpeg = dir.join("ffmpeg");
        let ffprobe = dir.join("ffprobe");

        extract_static_ffmpeg(std::path::Path::new(&path), &ffmpeg, &ffprobe)
            .expect("extrair ffmpeg do tarball real");

        assert!(
            crate::commands::is_executable(&ffmpeg),
            "ffmpeg extraído sem o bit de execução"
        );
        let size = std::fs::metadata(&ffmpeg).expect("metadata").len();
        assert!(
            size > 10 * 1024 * 1024,
            "ffmpeg extraído pequeno demais ({size} bytes)"
        );

        // It must be a binary that really runs, not a placeholder.
        let out = std::process::Command::new(&ffmpeg)
            .arg("-version")
            .output()
            .expect("executar o ffmpeg extraído");
        assert!(out.status.success(), "ffmpeg extraído não executou");
        assert!(
            String::from_utf8_lossy(&out.stdout).contains("ffmpeg version"),
            "saída inesperada do ffmpeg extraído"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
