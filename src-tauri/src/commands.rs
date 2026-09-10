use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::Emitter;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub title: String,
    pub thumbnail: String,
    pub duration: String,
    pub author: String,
    /// Resoluções de vídeo que a fonte realmente oferece (decrescente), para o
    /// seletor de qualidade só mostrar opções existentes. Vazio = não checado.
    pub available_heights: Vec<u32>,
    /// Bitrates de áudio disponíveis na fonte (kbps, decrescente).
    pub audio_bitrates: Vec<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub percentage: f64,
    pub speed: String,
    pub eta: String,
    pub stage: String,
}

/// Get the directory where the app is installed (exe location)
fn get_app_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("Não foi possível obter o diretório do app")?;
    Ok(dir.to_path_buf())
}

/// Get the yt-dlp binary name for the current platform
#[cfg(target_os = "windows")]
fn ytdlp_bin_name() -> &'static str {
    "yt-dlp.exe"
}
#[cfg(not(target_os = "windows"))]
fn ytdlp_bin_name() -> &'static str {
    "yt-dlp"
}

/// Get the ffmpeg binary name for the current platform
#[cfg(target_os = "windows")]
fn ffmpeg_bin_name() -> &'static str {
    "ffmpeg.exe"
}
#[cfg(not(target_os = "windows"))]
fn ffmpeg_bin_name() -> &'static str {
    "ffmpeg"
}

// ---------------------------------------------------------------------------
// Linux / AppImage: where the dependencies may live
//
// An AppImage is a self-mounting squashfs image: `current_exe()` points inside
// `/tmp/.mount_XXXXXX/usr/bin`, which is mounted **read-only**. Nothing can be
// written next to the binary, so the lookup walks three places:
//
//   1. `<app_data_dir>/ytgrab-deps/bin` — writable; written by `linux_setup`
//   2. `<resource_dir>/ytgrab`          — read-only, bundled inside the image
//   3. the directory of the binary      — legacy manual installs / .deb
//
// and falls back to `which` on the host PATH.
// ---------------------------------------------------------------------------

/// True when running from inside an AppImage.
#[cfg(all(target_os = "linux", not(target_os = "android")))]
fn is_appimage() -> bool {
    std::env::var_os("APPIMAGE").is_some()
}

/// Directory the app may write dependencies to.
///
/// On Linux this is **not** the executable directory (see above); everywhere
/// else it is, which keeps the historical behaviour of the Windows installer.
#[cfg(all(target_os = "linux", not(target_os = "android")))]
fn deps_install_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bin = crate::linux_setup::deps_bin_dir(app)?;
    std::fs::create_dir_all(&bin)
        .map_err(|e| format!("Erro ao criar o diretório de dependências: {e}"))?;
    Ok(bin)
}

#[cfg(not(all(target_os = "linux", not(target_os = "android"))))]
fn deps_install_dir(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    get_app_dir()
}

/// Read-only directory that holds the dependencies bundled with the app.
///
/// `tauri.linux.conf.json` maps `src-tauri/bin` to `deps/` inside the bundle,
/// which lands in `<resource_dir>/deps` at runtime.
///
/// The destination must NOT be called `ytgrab`: tauri-build copies the
/// resources into the cargo target directory while the build script runs, so
/// `target/release/<dest>` would collide with the `ytgrab` binary cargo writes
/// at that same path ("failed to remove file ... Is a directory").
#[cfg(all(target_os = "linux", not(target_os = "android")))]
fn bundled_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join("deps"))
        .filter(|d| d.is_dir())
}

#[cfg(not(all(target_os = "linux", not(target_os = "android"))))]
fn bundled_dir(_app: &tauri::AppHandle) -> Option<PathBuf> {
    None
}

/// Is `path` an executable file? Used to skip the bundled copies when the
/// archive lost their +x bit, so the lookup falls through to a working one.
#[cfg(unix)]
pub(crate) fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && (m.permissions().mode() & 0o111) != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
pub(crate) fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// Drop the library paths the AppImage runtime injects into the environment.
///
/// The runtime prepends its own `usr/lib` to `LD_LIBRARY_PATH` so the app can
/// find the webkit/GTK libraries it ships. That same variable is inherited by
/// every child process, and the standalone yt-dlp binary is a PyInstaller
/// executable that carries its own `libz`/`libexpat` — picking up the AppImage
/// copies instead makes it fail at startup. The ffmpeg build is fully static,
/// so it is unaffected.
#[cfg(all(target_os = "linux", not(target_os = "android")))]
fn clean_appimage_env(cmd: &mut Command) {
    if !is_appimage() {
        return;
    }
    for var in ["LD_LIBRARY_PATH", "LD_PRELOAD", "PERL5LIB", "PYTHONHOME", "PYTHONPATH"] {
        cmd.env_remove(var);
    }
}

#[cfg(not(all(target_os = "linux", not(target_os = "android"))))]
fn clean_appimage_env(_cmd: &mut Command) {}

// ---------------------------------------------------------------------------
// Android: first-run dependencies (Termux-style prefix)
//
// On first use the app downloads a Termux aarch64 runtime (python3 + ffmpeg
// + shared libraries + the yt-dlp script) into `<dataDir>/ytgrab-deps/bin`
// (see `android_setup.rs`), which lives right under the directory
// `AppHandle::path().app_data_dir()` resolves to.
// ---------------------------------------------------------------------------
#[cfg(target_os = "android")]
mod android_deps {
    use super::*;

    /// Root of the extracted bundled dependencies.
    pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let data = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Erro ao obter diretório do app: {}", e))?;
        Ok(data.join("ytgrab-deps").join("bin"))
    }

    /// Path to the bundled python3 interpreter.
    pub fn python(root: &Path) -> PathBuf {
        root.join("termux").join("usr").join("bin").join("python3")
    }

    /// Path to the bundled yt-dlp script.
    pub fn script(root: &Path) -> PathBuf {
        root.join("yt-dlp")
    }

    /// Path to the bundled ffmpeg binary.
    pub fn ffmpeg(root: &Path) -> PathBuf {
        root.join("termux").join("usr").join("bin").join("ffmpeg")
    }

    /// Prefix used by the Termux python build (PYTHONHOME).
    pub fn prefix(root: &Path) -> PathBuf {
        root.join("termux").join("usr")
    }
}

#[cfg(target_os = "android")]
fn find_ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = android_deps::root(app)?;
    let python = android_deps::python(&root);
    let script = android_deps::script(&root);
    if python.is_file() && script.is_file() {
        // Return the script path: it is what identifies the "yt-dlp install"
        // for display purposes; the actual process is `python3 <script>`.
        return Ok(script);
    }
    Err("yt-dlp não encontrado. As dependências ainda não foram instaladas no aparelho.".to_string())
}

#[cfg(not(target_os = "android"))]
fn find_ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Candidate directories, in priority order: the writable directory managed
    // by the first-run setup, the copies bundled inside the app (AppImage),
    // the app dir itself (legacy manual installs) and the `bin/` directory
    // created by the Windows installer.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = deps_install_dir(app) {
        candidates.push(dir.join(ytdlp_bin_name()));
    }
    if let Some(dir) = bundled_dir(app) {
        candidates.push(dir.join(ytdlp_bin_name()));
    }
    if let Ok(app_dir) = get_app_dir() {
        candidates.push(app_dir.join(ytdlp_bin_name()));
        candidates.push(app_dir.join("bin").join(ytdlp_bin_name()));
        #[cfg(target_os = "windows")]
        {
            // Also check for yt-dlp without extension (Python script)
            candidates.push(app_dir.join("yt-dlp"));
            candidates.push(app_dir.join("bin").join("yt-dlp"));
        }
    }
    for candidate in &candidates {
        if is_executable(candidate) {
            return Ok(candidate.clone());
        }
    }

    // Check if yt-dlp is in PATH using `where` (Windows) or `which` (Unix)
    let find_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    let output = std::process::Command::new(find_cmd)
        .arg("yt-dlp")
        .output()
        .map_err(|e| format!("Erro ao buscar yt-dlp: {}", e))?;

    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout);
        let first_line = path_str.lines().next().unwrap_or("").trim();
        if !first_line.is_empty() {
            return Ok(PathBuf::from(first_line));
        }
    }

    Err("yt-dlp não encontrado. Clique em 'Reinstalar dependências' para instalar.".to_string())
}

#[cfg(target_os = "android")]
fn find_ffmpeg(app: &tauri::AppHandle) -> Option<PathBuf> {
    let root = android_deps::root(app).ok()?;
    let ffmpeg = android_deps::ffmpeg(&root);
    if ffmpeg.is_file() {
        Some(ffmpeg)
    } else {
        None
    }
}

#[cfg(not(target_os = "android"))]
fn find_ffmpeg(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Same priority order as `find_ytdlp`: writable setup dir, bundle, app dir.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = deps_install_dir(app) {
        candidates.push(dir.join(ffmpeg_bin_name()));
    }
    if let Some(dir) = bundled_dir(app) {
        candidates.push(dir.join(ffmpeg_bin_name()));
    }
    if let Ok(app_dir) = get_app_dir() {
        candidates.push(app_dir.join(ffmpeg_bin_name()));
        candidates.push(app_dir.join("bin").join(ffmpeg_bin_name()));
    }
    for candidate in &candidates {
        if is_executable(candidate) {
            return Some(candidate.clone());
        }
    }

    // Check if ffmpeg is in PATH
    let find_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    let output = std::process::Command::new(find_cmd)
        .arg("ffmpeg")
        .output()
        .ok()?;

    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout);
        let first_line = path_str.lines().next().unwrap_or("").trim();
        if !first_line.is_empty() {
            return Some(PathBuf::from(first_line));
        }
    }

    None
}

/// Build the base process for running yt-dlp (no yt-dlp arguments yet).
///
/// Desktop: runs the yt-dlp binary (no console window on Windows).
/// Android: runs the bundled python3 interpreter against the bundled yt-dlp
/// script, with the environment the Termux prefix needs
/// (PYTHONHOME, TMPDIR and the CA bundle for TLS).
#[cfg(target_os = "android")]
fn ytdlp_base_command(app: &tauri::AppHandle) -> Result<Command, String> {
    let root = android_deps::root(app)?;
    let python = android_deps::python(&root);
    let script = android_deps::script(&root);
    let prefix = android_deps::prefix(&root);

    if !python.is_file() || !script.is_file() {
        return Err("yt-dlp não encontrado. As dependências ainda não foram instaladas no aparelho.".to_string());
    }

    let mut cmd = Command::new(&python);
    // The Termux python build looks for its standard library at its compile
    // time prefix; PYTHONHOME redirects it to the extracted copy.
    cmd.env("PYTHONHOME", &prefix);
    // Make sure the dynamic linker finds the Termux shared libraries
    // (libpython, libssl, libcrypto, ...) even if rpath is missing.
    cmd.env("LD_LIBRARY_PATH", prefix.join("lib"));
    // Writable temp directory inside the app's own data (never the APK path).
    let tmp = root
        .parent()
        .map(|p| p.join("tmp"))
        .unwrap_or_else(std::env::temp_dir);
    let _ = std::fs::create_dir_all(&tmp);
    cmd.env("TMPDIR", &tmp)
        .env("TMP", &tmp)
        .env("TEMP", &tmp);
    // Termux libssl was built with a hardcoded CA path (which varies between
    // builds); point OpenSSL at the first valid CA bundle we can find.
    let ca_candidates = [
        prefix.join("ssl").join("certs").join("ca-bundle.crt"),
        prefix.join("etc").join("tls").join("cert.pem"),
        prefix.join("etc").join("ssl").join("cert.pem"),
    ];
    if let Some(ca) = ca_candidates.iter().find(|c| c.is_file()) {
        cmd.env("SSL_CERT_FILE", ca);
    }
    cmd.arg(&script);
    Ok(cmd)
}

#[cfg(not(target_os = "android"))]
fn ytdlp_base_command(app: &tauri::AppHandle) -> Result<Command, String> {
    let ytdlp = find_ytdlp(app)?;
    let mut cmd = Command::new(&ytdlp);

    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    {
        // The AppImage runtime exports LD_LIBRARY_PATH pointing at the libs it
        // ships; that would break the standalone yt-dlp binary (see
        // `clean_appimage_env`). Point it at a writable TMPDIR too.
        clean_appimage_env(&mut cmd);
        if let Ok(tmp) = crate::linux_setup::tmp_dir(app) {
            cmd.env("TMPDIR", &tmp).env("TMP", &tmp).env("TEMP", &tmp);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    Ok(cmd)
}

/// Install yt-dlp by downloading from GitHub
///
/// Windows: `yt-dlp.exe` next to the binary (the installer's own directory is
/// writable there). Linux: the standalone `yt-dlp_linux` binary, downloaded by
/// `linux_setup` into the app's data directory — an AppImage is read-only, so
/// writing next to the executable is not an option.
#[tauri::command]
pub async fn install_ytdlp(app: tauri::AppHandle) -> Result<String, String> {
    if let Ok(path) = find_ytdlp(&app) {
        return Ok(format!("yt-dlp já está instalado: {}", path.display()));
    }

    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    {
        return crate::linux_setup::run(app, false).await;
    }

    #[cfg(not(all(target_os = "linux", not(target_os = "android"))))]
    {
    let app_dir = deps_install_dir(&app)?;
    let ytdlp_path = app_dir.join(ytdlp_bin_name());

    if ytdlp_path.exists() {
        return Ok("yt-dlp já está instalado.".to_string());
    }

    if cfg!(target_os = "windows") {
        // Windows: download yt-dlp.exe standalone binary
        let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
        let response = reqwest::get(url).await.map_err(|e| format!("Erro ao baixar yt-dlp: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("Erro HTTP ao baixar yt-dlp: {}", response.status()));
        }
        let bytes = response.bytes().await.map_err(|e| format!("Erro ao ler dados: {}", e))?;
        std::fs::write(&ytdlp_path, &bytes).map_err(|e| format!("Erro ao salvar yt-dlp: {}", e))?;
        Ok(format!("yt-dlp instalado em: {}", ytdlp_path.display()))
    } else {
        // Linux/Android: download the yt-dlp Python script and make it executable
        // On Android, this requires Python to be available (e.g. via Termux)
        let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
        let response = reqwest::get(url).await.map_err(|e| format!("Erro ao baixar yt-dlp: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("Erro HTTP ao baixar yt-dlp: {}", response.status()));
        }
        let bytes = response.bytes().await.map_err(|e| format!("Erro ao ler dados: {}", e))?;
        std::fs::write(&ytdlp_path, &bytes).map_err(|e| format!("Erro ao salvar yt-dlp: {}", e))?;

        // Make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o755);
            std::fs::set_permissions(&ytdlp_path, perms).map_err(|e| format!("Erro ao definir permissões: {}", e))?;
        }

        Ok(format!("yt-dlp instalado em: {}", ytdlp_path.display()))
    }
    }
}

/// Install ffmpeg by downloading from GitHub (gyan.dev builds for Windows)
///
/// Linux uses the static johnvansickle build through `linux_setup`: the gyan.dev
/// archive below is Windows-only and is unpacked with PowerShell.
#[tauri::command]
pub async fn install_ffmpeg(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(path) = find_ffmpeg(&app) {
        return Ok(format!("ffmpeg já está instalado: {}", path.display()));
    }

    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    {
        return crate::linux_setup::run(app, false).await;
    }

    #[cfg(not(all(target_os = "linux", not(target_os = "android"))))]
    {
    let app_dir = deps_install_dir(&app)?;
    let ffmpeg_path = app_dir.join(ffmpeg_bin_name());

    if ffmpeg_path.exists() {
        return Ok("ffmpeg já está instalado.".to_string());
    }

    // Download ffmpeg essentials build from gyan.dev
    let url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

    let response = reqwest::get(url).await.map_err(|e| format!("Erro ao baixar ffmpeg: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Erro HTTP ao baixar ffmpeg: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("Erro ao ler dados: {}", e))?;

    // Save zip to temp
    let zip_path = app_dir.join("ffmpeg-temp.zip");
    std::fs::write(&zip_path, &bytes).map_err(|e| format!("Erro ao salvar arquivo zip: {}", e))?;

    // Extract ffmpeg.exe from zip using PowerShell
    let ps_cmd = format!(
        "Add-Type -AssemblyName System.IO.Compression.FileSystem; \
         $zip = [System.IO.Compression.ZipFile]::OpenRead('{}'); \
         $entry = $zip.Entries | Where-Object {{ $_.FullName -like '*/bin/ffmpeg.exe' }} | Select-Object -First 1; \
         if ($entry) {{ \
           [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '{}', $true); \
         }}; \
         $zip.Dispose()",
        zip_path.display(),
        ffmpeg_path.display()
    );

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_cmd])
        .output()
        .map_err(|e| format!("Erro ao extrair ffmpeg: {}", e))?;

    // Clean up zip
    let _ = std::fs::remove_file(&zip_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Erro ao extrair ffmpeg: {}", stderr));
    }

    if ffmpeg_path.exists() {
        Ok(format!("ffmpeg instalado em: {}", ffmpeg_path.display()))
    } else {
        Err("ffmpeg.exe não foi encontrado no arquivo zip.".to_string())
    }
    }
}

/// Check if yt-dlp and ffmpeg are installed (bundled or on PATH)
#[tauri::command]
pub async fn check_dependencies(app: tauri::AppHandle) -> Result<HashMap<String, bool>, String> {
    let mut result = HashMap::new();
    result.insert("ytdlp".to_string(), find_ytdlp(&app).is_ok());
    result.insert("ffmpeg".to_string(), find_ffmpeg(&app).is_some());
    Ok(result)
}

/// Compara versões semver simples (x.y.z): `a > b`?
fn version_gt(a: &str, b: &str) -> bool {
    let pa: Vec<u32> = a.split('.').filter_map(|s| s.parse().ok()).collect();
    let pb: Vec<u32> = b.split('.').filter_map(|s| s.parse().ok()).collect();
    for i in 0..3 {
        let x = *pa.get(i).unwrap_or(&0);
        let y = *pb.get(i).unwrap_or(&0);
        if x != y {
            return x > y;
        }
    }
    false
}

#[derive(Debug, Serialize, Clone)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub latest: String,
    pub url: String,
}

/// Consulta a release mais recente do YTGrab no GitHub e compara com a versão
/// embutida no binário. A frequência das consultas é controlada pela UI.
#[tauri::command]
pub async fn check_app_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION");
    let response = reqwest::Client::new()
        .get("https://api.github.com/repos/MicaelSanPedro/ytgrab/releases/latest")
        .header("User-Agent", "ytgrab")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Falha ao verificar atualizações: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "Falha ao verificar atualizações (HTTP {})",
            response.status()
        ));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("Falha ao verificar atualizações: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Resposta inválida do GitHub: {}", e))?;
    let tag = json["tag_name"].as_str().unwrap_or("").trim_start_matches('v');
    let url = json["html_url"]
        .as_str()
        .unwrap_or("https://github.com/MicaelSanPedro/ytgrab/releases")
        .to_string();
    Ok(UpdateInfo {
        has_update: version_gt(tag, current),
        latest: tag.to_string(),
        url,
    })
}

/// Current platform identifier ("android", "windows", "linux" or "other").
#[tauri::command]
pub fn get_platform() -> String {
    if cfg!(target_os = "android") {
        "android".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "linux") {
        "linux".to_string()
    } else {
        "other".to_string()
    }
}

/// Where the app stores/looks for yt-dlp and ffmpeg (for the UI footer).
#[tauri::command]
pub fn get_deps_dir(app: tauri::AppHandle) -> String {
    deps_install_dir(&app)
        .map(|d| d.display().to_string())
        .unwrap_or_else(|_| String::from("desconhecido"))
}

/// Prepare the dependencies automatically.
///
/// Android: downloads and sets everything up on first run (Termux python +
/// ffmpeg + yt-dlp) into the app's private storage, emitting `setup-progress`
/// events while it works. No manual step or permission is needed.
/// Linux: the AppImage ships both binaries, so this normally answers right
/// away. If they are missing (a `.deb` install, or the user removed them), it
/// downloads them into the app's data directory with the same progress events.
/// Windows: dependencies come with the installer; this only reports on them.
/// `force` makes the "Reinstalar dependências" button actually re-download
/// everything, ignoring the marker left by a previous successful setup.
#[tauri::command]
pub async fn setup_dependencies(app: tauri::AppHandle, force: Option<bool>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let _ = force;
        crate::android_setup::run(app).await
    }
    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    {
        if force.unwrap_or(false) {
            return crate::linux_setup::run(app, true).await;
        }
        if find_ytdlp(&app).is_ok() && find_ffmpeg(&app).is_some() {
            return Ok("Dependências já estão disponíveis neste app.".to_string());
        }
        // yt-dlp is the hard requirement: without it nothing works, so it is
        // worth the download. A missing ffmpeg still leaves video downloads
        // working (only mp3 conversion needs it), and the system one is picked
        // up from PATH whenever the distro provides it.
        if find_ytdlp(&app).is_err() {
            return crate::linux_setup::run(app, false).await;
        }
        Err("ffmpeg não encontrado. Instale-o com `sudo apt install ffmpeg` ou clique em 'Instalar ffmpeg'.".to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "linux")))]
    {
        let _ = force;
        if find_ytdlp(&app).is_ok() && find_ffmpeg(&app).is_some() {
            Ok("Dependências já estão disponíveis neste app.".to_string())
        } else {
            Err("Dependências ausentes. Use o painel de dependências para instalá-las.".to_string())
        }
    }
}

/// Get yt-dlp install info (path and version)
#[tauri::command]
pub async fn get_ytdlp_install_info(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let mut result = HashMap::new();

    match find_ytdlp(&app) {
        Ok(path) => {
            result.insert("path".to_string(), path.display().to_string());
            // Runs `yt-dlp --version` (or `python3 yt-dlp --version` on Android)
            match ytdlp_base_command(&app) {
                Ok(mut cmd) => {
                    cmd.arg("--version")
                        .stdout(std::process::Stdio::piped())
                        .stderr(std::process::Stdio::piped());
                    match cmd.output().await {
                        Ok(o) => {
                            let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
                            result.insert("version".to_string(), version);
                        }
                        Err(_) => {
                            result.insert("version".to_string(), "desconhecida".to_string());
                        }
                    }
                }
                Err(_) => {
                    result.insert("version".to_string(), "desconhecida".to_string());
                }
            }
            result.insert("installed".to_string(), "true".to_string());
        }
        Err(_) => {
            result.insert("installed".to_string(), "false".to_string());
        }
    }

    match find_ffmpeg(&app) {
        Some(path) => {
            result.insert("ffmpeg_path".to_string(), path.display().to_string());
            result.insert("ffmpeg_installed".to_string(), "true".to_string());
        }
        None => {
            result.insert("ffmpeg_installed".to_string(), "false".to_string());
        }
    }

    Ok(result)
}

/// Get video info using yt-dlp
#[tauri::command]
pub async fn get_video_info(app: tauri::AppHandle, url: String) -> Result<VideoInfo, String> {
    let mut cmd = ytdlp_base_command(&app)?;
    cmd.args(["--no-warnings", "-j", &url])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = cmd.output().await.map_err(|e| format!("Erro ao executar yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Erro ao obter informações do vídeo: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Erro ao processar informações: {}", e))?;

    let title = json["title"].as_str().unwrap_or("Vídeo sem título").to_string();
    let thumbnail = json["thumbnail"].as_str().unwrap_or("").to_string();
    let duration_secs = json["duration"].as_f64().unwrap_or(0.0);
    let author = json["channel"].as_str().unwrap_or("Desconhecido").to_string();

    // Resoluções reais da fonte: formatos com vídeo (height > 0), sem
    // duplicatas, em ordem decrescente.
    let mut heights: Vec<u32> = json["formats"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|f| {
                    let h = f["height"].as_u64().unwrap_or(0);
                    let has_video = f["vcodec"].as_str().unwrap_or("none") != "none";
                    (h > 0 && has_video).then_some(h as u32)
                })
                .collect()
        })
        .unwrap_or_default();
    heights.sort_unstable();
    heights.dedup();
    heights.reverse();

    // Bitrates reais de áudio (kbps): formatos sem vídeo que carregam abr/tbr.
    let mut bitrates: Vec<u32> = json["formats"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|f| {
                    let has_video = f["vcodec"].as_str().unwrap_or("none") != "none";
                    if has_video {
                        return None;
                    }
                    let kbps = f["abr"].as_f64().or_else(|| f["tbr"].as_f64())?;
                    (kbps > 0.0).then_some(kbps.round() as u32)
                })
                .collect()
        })
        .unwrap_or_default();
    bitrates.sort_unstable();
    bitrates.dedup();
    bitrates.reverse();

    let duration = if duration_secs > 0.0 {
        let mins = (duration_secs / 60.0).floor() as i32;
        let secs = (duration_secs % 60.0).round() as i32;
        format!("{}:{:02}", mins, secs)
    } else {
        "?:??".to_string()
    };

    Ok(VideoInfo {
        title,
        thumbnail,
        duration,
        author,
        available_heights: heights,
        audio_bitrates: bitrates,
    })
}

/// Get default download directory
///
/// Android: the app's own data directory (scoped storage).
/// Desktop: the user's Downloads folder.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn get_default_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erro ao obter diretório do app: {}", e))?;
    let download_dir = data.join("Downloads");
    if !download_dir.exists() {
        std::fs::create_dir_all(&download_dir)
            .map_err(|e| format!("Erro ao criar diretório: {}", e))?;
    }
    Ok(download_dir.to_string_lossy().to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_default_download_dir(own_folder: Option<bool>) -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|e| format!("Erro ao obter diretório home: {}", e))?;

    // own_folder=true (padrão): pasta própria do app, Downloads/YTGrab;
    // false: Downloads do usuário, sem subpasta.
    let mut download_dir = PathBuf::from(&home).join("Downloads");
    if own_folder.unwrap_or(true) {
        download_dir = download_dir.join("YTGrab");
    }
    if !download_dir.exists() {
        std::fs::create_dir_all(&download_dir)
            .map_err(|e| format!("Erro ao criar diretório: {}", e))?;
    }

    Ok(download_dir.to_string_lossy().to_string())
}

/// Run yt-dlp command and emit progress events
async fn run_ytdlp(
    app: &tauri::AppHandle,
    args: &[String],
    output_dir: &str,
    url: &str,
    is_audio: bool,
    convert_to: Option<String>,
) -> Result<String, String> {
    let mut cmd = ytdlp_base_command(app)?;

    // Add all args
    for arg in args {
        cmd.arg(arg);
    }

    cmd.arg(url)
        .arg("--newline")
        .arg("--no-warnings")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // Set ffmpeg location if available
    if let Some(ffmpeg) = find_ffmpeg(app) {
        if let Some(ffmpeg_dir) = ffmpeg.parent() {
            cmd.arg("--ffmpeg-location").arg(ffmpeg_dir.to_string_lossy().to_string());
        }
    }

    // Environment is inherited by default from parent process
    // This makes it behave exactly like running from cmd

    let mut child = cmd.spawn().map_err(|e| format!("Erro ao iniciar yt-dlp: {}", e))?;

    let stdout = child.stdout.take().ok_or("Não foi possível capturar saída")?;
    let stderr = child.stderr.take().ok_or("Não foi possível capturar erros")?;

    let stdout_reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);

    let mut stdout_lines = stdout_reader.lines();
    let mut stderr_lines = stderr_reader.lines();

    let mut last_error = String::new();
    let output_dir_path = output_dir.to_string();

    loop {
        tokio::select! {
            line = stdout_lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        let line = line.trim();

                        // Parse download progress: [download]  45.2% of 123.45MiB at 1.23MiB/s ETA 00:30
                        if line.contains("[download]") && line.contains('%') {
                            let pct = extract_percentage(line);
                            let speed = extract_speed(line);
                            let eta = extract_eta(line);

                            let stage = if pct >= 100.0 {
                                if is_audio {
                                    "converting".to_string()
                                } else {
                                    "done".to_string()
                                }
                            } else {
                                "downloading".to_string()
                            };

                            let _ = app.emit("download-progress", DownloadProgress {
                                percentage: pct,
                                speed,
                                eta,
                                stage,
                            });
                        }
                        // Parse extraction/conversion progress
                        else if line.contains("[ExtractAudio]") || line.contains("[Merge]") || line.contains("[Convert]") {
                            let _ = app.emit("download-progress", DownloadProgress {
                                percentage: 100.0,
                                speed: "".to_string(),
                                eta: "".to_string(),
                                stage: "converting".to_string(),
                            });
                        }
                        // Already downloaded
                        else if line.contains("[download]") && line.contains("has already been downloaded") {
                            let _ = app.emit("download-progress", DownloadProgress {
                                percentage: 100.0,
                                speed: "".to_string(),
                                eta: "".to_string(),
                                stage: "done".to_string(),
                            });
                        }
                        // Deleting original file (post-extract cleanup by yt-dlp)
                        else if line.contains("Deleting original file") {
                            let _ = app.emit("download-progress", DownloadProgress {
                                percentage: 100.0,
                                speed: "".to_string(),
                                eta: "".to_string(),
                                stage: "done".to_string(),
                            });
                        }
                    }
                    Ok(None) => break,
                    Err(_) => continue,
                }
            }
            line = stderr_lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        let line = line.trim();
                        if !line.is_empty() {
                            last_error = line.to_string();
                            let _ = app.emit("download-error", &last_error);
                        }
                    }
                    Ok(None) => {},
                    Err(_) => continue,
                }
            }
        }
    }

    let status = child.wait().await.map_err(|e| format!("Erro ao aguardar processo: {}", e))?;

    if !status.success() {
        return Err(
            if last_error.is_empty() {
                "Download falhou com erro desconhecido.".to_string()
            } else {
                last_error
            },
        );
    }

    // Clean up intermediate files for audio downloads
    if is_audio {
        cleanup_intermediate_files(&output_dir_path);
    }

    // Pós-conversão pedida na UI (select "Converter para:"): roda o ffmpeg
    // embutido sobre o arquivo baixado e o substitui pelo resultado.
    if let Some(target) = convert_to.as_deref().filter(|t| *t != "none") {
        let downloaded_ext = if is_audio { "mp3" } else { "mp4" };
        let produced = convert_downloaded(app, &output_dir_path, downloaded_ext, target).await?;
        return Ok(format!("Convertido para .{target}: {}", produced));
    }

    Ok("Download concluído!".to_string())
}

/// Extract percentage from yt-dlp progress line
fn extract_percentage(line: &str) -> f64 {
    let re = regex_lite::Regex::new(r"(\d+\.?\d*)%").ok();
    if let Some(re) = re {
        if let Some(caps) = re.captures(line) {
            if let Some(m) = caps.get(1) {
                return m.as_str().parse::<f64>().unwrap_or(0.0);
            }
        }
    }
    0.0
}

/// Extract download speed from yt-dlp progress line
fn extract_speed(line: &str) -> String {
    let re = regex_lite::Regex::new(r"at\s+([\d.]+\w+/s)").ok();
    if let Some(re) = re {
        if let Some(caps) = re.captures(line) {
            if let Some(m) = caps.get(1) {
                return m.as_str().to_string();
            }
        }
    }
    "".to_string()
}

/// Extract ETA from yt-dlp progress line
fn extract_eta(line: &str) -> String {
    let re = regex_lite::Regex::new(r"ETA\s+([\d:]+)").ok();
    if let Some(re) = re {
        if let Some(caps) = re.captures(line) {
            if let Some(m) = caps.get(1) {
                return m.as_str().to_string();
            }
        }
    }
    "".to_string()
}

/// Delete intermediate files (.webm, .temp, .part) left by yt-dlp after audio extraction
fn cleanup_intermediate_files(output_dir: &str) {
    if let Ok(entries) = std::fs::read_dir(output_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                let lower = name.to_lowercase();
                // Delete intermediate video files that yt-dlp downloads before extracting audio
                // These are .webm, .m4a, .opus, .temp, .part, .ytdl files
                if lower.ends_with(".webm")
                    || lower.ends_with(".opus")
                    || lower.ends_with(".temp")
                    || lower.ends_with(".part")
                    || lower.ends_with(".ytdl")
                {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

/// Download video/audio using yt-dlp with simple direct commands
#[tauri::command]
pub async fn download(
    app: tauri::AppHandle,
    url: String,
    format: String,
    quality: String,
    output_dir: String,
    // Pós-conversão opcional do resultado: "none" (padrão), "mp4", "mkv",
    // "webm" (vídeo) ou "mp3", "m4a", "opus", "wav" (só áudio).
    convert_to: Option<String>,
) -> Result<String, String> {
    // Validate yt-dlp exists
    find_ytdlp(&app)?;

    // Ensure output directory exists
    let out_path = Path::new(&output_dir);
    if !out_path.exists() {
        std::fs::create_dir_all(out_path)
            .map_err(|e| format!("Erro ao criar diretório de saída: {}", e))?;
    }

    let is_audio = format == "mp3";

    // Build output template - clean title, proper extension
    let output_template = format!("{}/%(title)s.{}", output_dir, format);

    // Build simple, direct yt-dlp command arguments.
    // `quality` comes from the UI as the value the user picked among the
    // options the source actually offers: a height in pixels (video) or a
    // bitrate in kbps (audio); "best" leaves the choice to yt-dlp.
    let args: Vec<String> = if is_audio {
        // MP3: extract audio, convert to mp3 at the chosen bitrate.
        vec![
            "-x".into(),
            "--audio-format".into(),
            "mp3".into(),
            "--audio-quality".into(),
            format!("{quality}K"),
            "-o".into(),
            output_template.clone(),
        ]
    } else {
        // MP4: download video capped at the chosen height.
        let fmt = if quality == "best" {
            "bestvideo+bestaudio/best".to_string()
        } else {
            format!("bestvideo[height<={quality}]+bestaudio/best")
        };
        vec![
            "-f".into(),
            fmt,
            "-o".into(),
            output_template.clone(),
            "--merge-output-format".into(),
            "mp4".into(),
        ]
    };

    // Emit initial progress
    let _ = app.emit("download-progress", DownloadProgress {
        percentage: 0.0,
        speed: "".to_string(),
        eta: "".to_string(),
        stage: "starting".to_string(),
    });

    run_ytdlp(&app, &args, &output_dir, &url, is_audio, convert_to).await
}

// ---------------------------------------------------------------------------
// Conversor embutido (ffmpeg)
// ---------------------------------------------------------------------------

/// Duração em segundos de um arquivo de mídia, via ffprobe (o build embutido
/// traz o ffprobe ao lado do ffmpeg). None = progresso indeterminado.
fn probe_duration(ffmpeg_dir: &Path, file: &Path) -> Option<f64> {
    let name = if cfg!(target_os = "windows") { "ffprobe.exe" } else { "ffprobe" };
    let ffprobe = ffmpeg_dir.join(name);
    if !ffprobe.is_file() {
        return None;
    }
    let out = std::process::Command::new(ffprobe)
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=nk=1"])
        .arg(file)
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse::<f64>().ok()
}

/// Converte `time=HH:MM:SS.cc` das linhas de progresso do ffmpeg em segundos.
fn parse_ffmpeg_time(line: &str) -> Option<f64> {
    let pos = line.find("time=")?;
    let rest = &line[pos + 5..];
    let end = rest.find(|c: char| c == ' ' || c == '\r').unwrap_or(rest.len());
    let mut parts = rest[..end].split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Argumentos do ffmpeg por formato de destino. Formatos de vídeo reencodam
/// (libx264/libvpx); os de áudio descartam o fluxo de vídeo.
fn ffmpeg_target_args(target: &str) -> Option<Vec<String>> {
    Some(match target {
        "mp4" => vec!["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "192k"],
        "mkv" => vec!["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "192k"],
        "webm" => vec!["-c:v", "libvpx", "-b:v", "2M", "-c:a", "libvorbis", "-q:a", "4"],
        "mp3" => vec!["-vn", "-c:a", "libmp3lame", "-b:a", "320k"],
        "m4a" => vec!["-vn", "-c:a", "aac", "-b:a", "192k"],
        "opus" => vec!["-vn", "-c:a", "libopus", "-b:a", "128k"],
        "wav" => vec!["-vn", "-c:a", "pcm_s16le"],
        _ => return None,
    }.into_iter().map(String::from).collect())
}

/// Converte o arquivo baixado para o formato pedido e, se a conversão tiver
/// sucesso, remove o original (o resultado vira o artefato final).
async fn convert_downloaded(
    app: &tauri::AppHandle,
    output_dir: &str,
    downloaded_ext: &str,
    target: &str,
) -> Result<String, String> {
    let ffmpeg = find_ffmpeg(app)
        .ok_or_else(|| "ffmpeg não encontrado para converter o arquivo.".to_string())?;

    // O arquivo que o yt-dlp acabou de produzir = o mais recente da pasta com
    // a extensão do download.
    let dir = Path::new(output_dir);
    let mut produced: Option<PathBuf> = None;
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase())
            == Some(downloaded_ext.to_string())
        {
            let newer = match &produced {
                Some(cur) => {
                    let a = entry.metadata().ok().and_then(|m| m.modified().ok());
                    let b = cur.metadata().ok().and_then(|m| m.modified().ok());
                    match (a, b) {
                        (Some(x), Some(y)) => x > y,
                        _ => true,
                    }
                }
                None => true,
            };
            if newer {
                produced = Some(p);
            }
        }
    }
    let input = produced.ok_or_else(|| "Arquivo baixado não foi localizado para conversão.".to_string())?;

    let out = input.with_extension(target);
    let mut cmd = tokio::process::Command::new(&ffmpeg);
    cmd.arg("-y").arg("-i").arg(&input).arg("-hide_banner").arg("-loglevel").arg("info");
    let args = ffmpeg_target_args(target)
        .ok_or_else(|| format!("Formato de conversão não suportado: {target}"))?;
    for a in &args {
        cmd.arg(a);
    }
    cmd.arg(&out).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());

    let total = ffmpeg.parent().and_then(|d| probe_duration(d, &input));

    let mut child = cmd.spawn().map_err(|e| format!("Erro ao iniciar o ffmpeg: {e}"))?;
    let stderr = child.stderr.take().ok_or("Não foi possível ler a saída do ffmpeg")?;
    let mut lines = tokio::io::BufReader::new(stderr).lines();
    let mut last_error = String::new();
    while let Ok(Some(line)) = lines.next_line().await {
        if let (Some(total_secs), Some(t)) = (total, parse_ffmpeg_time(&line)) {
            if total_secs > 0.0 {
                let pct = (t / total_secs * 100.0).min(100.0);
                let _ = app.emit("download-progress", DownloadProgress {
                    percentage: pct,
                    speed: String::new(),
                    eta: String::new(),
                    stage: "converting".to_string(),
                });
            }
        }
        if !line.trim().is_empty() {
            last_error = line;
        }
    }

    let status = child.wait().await.map_err(|e| format!("Erro ao aguardar o ffmpeg: {e}"))?;
    if !status.success() || !out.is_file() {
        return Err(format!("Conversão falhou: {}", last_error.trim().chars().take(300).collect::<String>()));
    }

    // O convertido vira o artefato final; o intermediário sai de cena.
    let _ = std::fs::remove_file(&input);
    Ok(out.display().to_string())
}

/// Open directory in file manager
#[tauri::command]
pub async fn open_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&path).spawn();
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "android")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
    }
    #[cfg(target_os = "android")]
    {
        // No general-purpose file manager on stock Android; nothing to do.
        let _ = path;
    }
    Ok(())
}

/// Cancel any running download (placeholder)
#[tauri::command]
pub async fn cancel_download() -> Result<(), String> {
    Ok(())
}
