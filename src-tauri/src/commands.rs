use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub title: String,
    pub thumbnail: String,
    pub duration: String,
    pub author: String,
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
fn ytdlp_bin_name() -> &'static str { "yt-dlp.exe" }
#[cfg(not(target_os = "windows"))]
fn ytdlp_bin_name() -> &'static str { "yt-dlp" }

/// Get the ffmpeg binary name for the current platform
#[cfg(target_os = "windows")]
fn ffmpeg_bin_name() -> &'static str { "ffmpeg.exe" }
#[cfg(not(target_os = "windows"))]
fn ffmpeg_bin_name() -> &'static str { "ffmpeg" }

/// Find yt-dlp executable - check app dir first, then PATH
fn find_ytdlp() -> Result<PathBuf, String> {
    let app_dir = get_app_dir()?;

    // Check app directory first
    let local_ytdlp = app_dir.join(ytdlp_bin_name());
    if local_ytdlp.exists() {
        return Ok(local_ytdlp);
    }

    // Also check for yt-dlp without extension (Python script)
    #[cfg(target_os = "windows")]
    {
        let local_ytdlp_py = app_dir.join("yt-dlp");
        if local_ytdlp_py.exists() {
            return Ok(local_ytdlp_py);
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

/// Find ffmpeg executable - check app dir first, then PATH
fn find_ffmpeg() -> Option<PathBuf> {
    let app_dir = get_app_dir().ok()?;

    // Check app directory first
    let local_ffmpeg = app_dir.join(ffmpeg_bin_name());
    if local_ffmpeg.exists() {
        return Some(local_ffmpeg);
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

/// Install yt-dlp by downloading from GitHub
#[tauri::command]
pub async fn install_ytdlp() -> Result<String, String> {
    let app_dir = get_app_dir()?;
    let ytdlp_path = app_dir.join(ytdlp_bin_name());

    if ytdlp_path.exists() {
        return Ok("yt-dlp já está instalado.".to_string());
    }

    // Download latest yt-dlp.exe from GitHub
    let url = if cfg!(target_os = "windows") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    };

    let response = reqwest::get(url).await.map_err(|e| format!("Erro ao baixar yt-dlp: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Erro HTTP ao baixar yt-dlp: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("Erro ao ler dados: {}", e))?;

    std::fs::write(&ytdlp_path, &bytes).map_err(|e| format!("Erro ao salvar yt-dlp: {}", e))?;

    Ok(format!("yt-dlp instalado em: {}", ytdlp_path.display()))
}

/// Install ffmpeg by downloading from GitHub (gyan.dev builds for Windows)
#[tauri::command]
pub async fn install_ffmpeg() -> Result<String, String> {
    let app_dir = get_app_dir()?;
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

/// Check if yt-dlp and ffmpeg are installed
#[tauri::command]
pub async fn check_dependencies() -> Result<HashMap<String, bool>, String> {
    let mut result = HashMap::new();
    result.insert("ytdlp".to_string(), find_ytdlp().is_ok());
    result.insert("ffmpeg".to_string(), find_ffmpeg().is_some());
    Ok(result)
}

/// Get yt-dlp install info (path and version)
#[tauri::command]
pub async fn get_ytdlp_install_info() -> Result<HashMap<String, String>, String> {
    let mut result = HashMap::new();

    match find_ytdlp() {
        Ok(path) => {
            result.insert("path".to_string(), path.display().to_string());
            let output = std::process::Command::new(&path).arg("--version").output();
            match output {
                Ok(o) => {
                    let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    result.insert("version".to_string(), version);
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

    match find_ffmpeg() {
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
pub async fn get_video_info(url: String) -> Result<VideoInfo, String> {
    let ytdlp = find_ytdlp()?;

    let mut cmd = Command::new(&ytdlp);
    cmd.args(["--no-warnings", "-j", &url])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

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

    let duration = if duration_secs > 0.0 {
        let mins = (duration_secs / 60.0).floor() as i32;
        let secs = (duration_secs % 60.0).round() as i32;
        format!("{}:{:02}", mins, secs)
    } else {
        "?:??".to_string()
    };

    Ok(VideoInfo { title, thumbnail, duration, author })
}

/// Get default download directory
#[tauri::command]
pub async fn get_default_download_dir() -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|e| format!("Erro ao obter diretório home: {}", e))?;

    let download_dir = PathBuf::from(&home).join("Downloads");
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
) -> Result<String, String> {
    let ytdlp = find_ytdlp()?;

    let mut cmd = Command::new(&ytdlp);

    // Add all args
    for arg in args {
        cmd.arg(arg);
    }

    cmd.arg(url)
        .arg("--newline")
        .arg("--no-warnings")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW - hide console window
    }

    // Set ffmpeg location if available in app dir
    if let Some(ffmpeg) = find_ffmpeg() {
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
        return Err(if last_error.is_empty() {
            "Download falhou com erro desconhecido.".to_string()
        } else {
            last_error
        });
    }

    // Clean up intermediate files for audio downloads
    if is_audio {
        cleanup_intermediate_files(&output_dir_path);
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
) -> Result<String, String> {
    // Validate yt-dlp exists
    find_ytdlp()?;

    // Ensure output directory exists
    let out_path = Path::new(&output_dir);
    if !out_path.exists() {
        std::fs::create_dir_all(out_path)
            .map_err(|e| format!("Erro ao criar diretório de saída: {}", e))?;
    }

    let is_audio = format == "mp3";

    // Build output template - clean title, proper extension
    let output_template = format!("{}/%(title)s.{}", output_dir, format);

    // Build simple, direct yt-dlp command arguments
    // NO cookies, NO complex format strings - just like running from cmd
    let args: Vec<String> = if is_audio {
        // MP3: extract audio, convert to mp3
        match quality.as_str() {
            "0" => vec![
                "-x".into(),
                "--audio-format".into(), "mp3".into(),
                "--audio-quality".into(), "0".into(),
                "-o".into(), output_template.clone(),
            ],
            "2" => vec![
                "-x".into(),
                "--audio-format".into(), "mp3".into(),
                "--audio-quality".into(), "2".into(),
                "-o".into(), output_template.clone(),
            ],
            _ => vec![
                "-x".into(),
                "--audio-format".into(), "mp3".into(),
                "--audio-quality".into(), "0".into(),
                "-o".into(), output_template.clone(),
            ],
        }
    } else {
        // MP4: download video with specified quality
        match quality.as_str() {
            "2160" => vec![
                "-f".into(), "bestvideo[height<=2160]+bestaudio/best".into(),
                "-o".into(), output_template.clone(),
                "--merge-output-format".into(), "mp4".into(),
            ],
            "1080" => vec![
                "-f".into(), "bestvideo[height<=1080]+bestaudio/best".into(),
                "-o".into(), output_template.clone(),
                "--merge-output-format".into(), "mp4".into(),
            ],
            "720" => vec![
                "-f".into(), "bestvideo[height<=720]+bestaudio/best".into(),
                "-o".into(), output_template.clone(),
                "--merge-output-format".into(), "mp4".into(),
            ],
            "480" => vec![
                "-f".into(), "bestvideo[height<=480]+bestaudio/best".into(),
                "-o".into(), output_template.clone(),
                "--merge-output-format".into(), "mp4".into(),
            ],
            _ => vec![
                "-f".into(), "bestvideo+bestaudio/best".into(),
                "-o".into(), output_template.clone(),
                "--merge-output-format".into(), "mp4".into(),
            ],
        }
    };

    // Emit initial progress
    let _ = app.emit("download-progress", DownloadProgress {
        percentage: 0.0,
        speed: "".to_string(),
        eta: "".to_string(),
        stage: "starting".to_string(),
    });

    run_ytdlp(&app, &args, &output_dir, &url, is_audio).await
}

/// Open directory in file manager
#[tauri::command]
pub async fn open_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&path).spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
    }
    Ok(())
}

/// Cancel any running download (placeholder)
#[tauri::command]
pub async fn cancel_download() -> Result<(), String> {
    Ok(())
}
