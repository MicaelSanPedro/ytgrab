use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

// ─── Types ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub title: String,
    pub thumbnail: String,
    pub duration: Option<u64>,
    pub formats: Vec<FormatInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FormatInfo {
    pub format_id: String,
    pub ext: String,
    pub resolution: Option<String>,
    pub fps: Option<f64>,
    pub vcodec: String,
    pub acodec: String,
    pub tbr: Option<f64>,
    pub abr: Option<f64>,
    pub vbr: Option<f64>,
    pub filesize: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadOptions {
    pub url: String,
    pub format: String,       // "mp3" or "mp4"
    pub quality: String,      // e.g. "320", "256", "128", "best", "1080", "720", "480"
    pub output_dir: String,
    pub filename: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub id: String,
    pub percent: f64,
    pub speed: String,
    pub eta: String,
    pub status: String, // "downloading", "processing", "done", "error"
    pub error: Option<String>,
}

// ─── Helpers ─────────────────────────────────────────────

/// Find yt-dlp binary
fn find_ytdlp() -> Result<PathBuf, String> {
    // Try common locations
    let candidates = if cfg!(target_os = "windows") {
        vec![
            PathBuf::from("yt-dlp.exe"),
            PathBuf::from("yt-dlp/yt-dlp.exe"),
            dirs_path("APPDATA").map(|p| p.join("ytgrab/yt-dlp.exe")),
        ]
    } else {
        vec![
            PathBuf::from("/usr/local/bin/yt-dlp"),
            PathBuf::from("/usr/bin/yt-dlp"),
            dirs_path("HOME").map(|p| p.join(".local/bin/yt-dlp")),
            dirs_path("HOME").map(|p| p.join(".ytgrab/yt-dlp")),
        ]
    };

    for candidate in candidates.iter().flatten() {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    // Try PATH
    if let Ok(output) = which_ytdlp() {
        return Ok(output);
    }

    Err("yt-dlp not found. Please install it first.".into())
}

fn dirs_path(var: &str) -> Option<PathBuf> {
    std::env::var(var).ok().map(PathBuf::from)
}

fn which_ytdlp() -> Result<PathBuf, String> {
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    let output = std::process::Command::new(cmd)
        .arg("yt-dlp")
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let p = PathBuf::from(&path);
        if p.exists() {
            return Ok(p);
        }
    }
    Err("not in PATH".into())
}

fn find_ffmpeg() -> Result<PathBuf, String> {
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    let output = std::process::Command::new(cmd)
        .arg("ffmpeg")
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(PathBuf::from(path));
    }
    Err("ffmpeg not found".into())
}

// ─── Tauri Commands ─────────────────────────────────────

#[tauri::command]
pub fn check_dependencies() -> Result<serde_json::Value, String> {
    let ytdlp = find_ytdlp().ok();
    let ffmpeg = find_ffmpeg().ok();
    Ok(serde_json::json!({
        "ytdlp": ytdlp.map(|p| p.to_string_lossy().to_string()),
        "ffmpeg": ffmpeg.map(|p| p.to_string_lossy().to_string()),
        "ready": ytdlp.is_some() && ffmpeg.is_some()
    }))
}

#[tauri::command]
pub async fn get_video_info(url: String) -> Result<VideoInfo, String> {
    let ytdlp = find_ytdlp()?;

    let output = tokio::process::Command::new(ytdlp)
        .arg("--dump-json")
        .arg("--no-download")
        .arg("--flat-playlist")
        .arg(&url)
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp error: {}", stderr));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse yt-dlp output: {}", e))?;

    let title = data["title"].as_str().unwrap_or("Unknown").to_string();
    let thumbnail = data["thumbnail"].as_str().unwrap_or("").to_string();
    let duration = data["duration"].as_f64().map(|d| d as u64);

    let mut formats = Vec::new();
    if let Some(fmts) = data["formats"].as_array() {
        for f in fmts {
            let vcodec = f["vcodec"].as_str().unwrap_or("none").to_string();
            let acodec = f["acodec"].as_str().unwrap_or("none").to_string();

            formats.push(FormatInfo {
                format_id: f["format_id"].as_str().unwrap_or("").to_string(),
                ext: f["ext"].as_str().unwrap_or("").to_string(),
                resolution: f["resolution"].as_str().map(|s| s.to_string()),
                fps: f["fps"].as_f64(),
                vcodec: vcodec.clone(),
                acodec: acodec.clone(),
                tbr: f["tbr"].as_f64(),
                abr: f["abr"].as_f64(),
                vbr: f["vbr"].as_f64(),
                filesize: f["filesize"].as_u64(),
            });
        }
    }

    Ok(VideoInfo { title, thumbnail, duration, formats })
}

#[tauri::command]
pub async fn download(app: AppHandle, options: DownloadOptions) -> Result<String, String> {
    let ytdlp = find_ytdlp()?;
    let id = format!("dl-{}", chrono_free_id());

    let output_template = format!(
        "{}/{}.%(ext)s",
        options.output_dir, options.filename
    );

    let mut args = vec![
        "--newline".to_string(),
        "--progress".to_string(),
        "--no-warnings".to_string(),
        "-o".to_string(),
        output_template,
    ];

    match options.format.as_str() {
        "mp3" => {
            args.push("-x".to_string());
            args.push("--audio-format".to_string());
            args.push("mp3".to_string());
            args.push("--audio-quality".to_string());
            match options.quality.as_str() {
                "320" => args.push("320K".to_string()),
                "256" => args.push("256K".to_string()),
                "192" => args.push("192K".to_string()),
                "128" => args.push("128K".to_string()),
                _ => args.push("0".to_string()), // best VBR
            }
            args.push("--embed-thumbnail".to_string());
            args.push("--add-metadata".to_string());
        }
        "mp4" => {
            let height = match options.quality.as_str() {
                "4k" | "2160" => "2160",
                "1440" => "1440",
                "1080" => "1080",
                "720" => "720",
                "480" => "480",
                "360" => "360",
                _ => "1080",
            };
            args.push("-f".to_string());
            args.push(format!(
                "bestvideo[height<={}][ext=mp4]+bestaudio[ext=m4a]/best[height<={}]",
                height, height
            ));
            args.push("--merge-output-format".to_string());
            args.push("mp4".to_string());
            args.push("--embed-thumbnail".to_string());
            args.push("--add-metadata".to_string());
        }
        _ => {
            return Err(format!("Unsupported format: {}", options.format));
        }
    }

    args.push(options.url.clone());

    let id_clone = id.clone();
    let app_clone = app.clone();

    // Spawn the process and stream progress
    let mut child = tokio::process::Command::new(ytdlp)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;

    let stdout = child.stdout.take().ok_or("No stdout")?;
    use tokio::io::{AsyncBufReadExt, BufReader};
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let line_str = line;

        // Parse yt-dlp progress lines: [download]  45.2% of 120.5MiB at 2.3MiB/s ETA 00:30
        if line_str.starts_with("[download]") && line_str.contains('%') {
            let percent = parse_percent(&line_str);
            let speed = parse_speed(&line_str);
            let eta = parse_eta(&line_str);

            let _ = app_clone.emit("download-progress", DownloadProgress {
                id: id_clone.clone(),
                percent,
                speed,
                eta,
                status: "downloading".into(),
                error: None,
            });
        } else if line_str.contains("Merging") || line_str.contains("Deleting") || line_str.contains("Converting") {
            let _ = app_clone.emit("download-progress", DownloadProgress {
                id: id_clone.clone(),
                percent: 100.0,
                speed: String::new(),
                eta: String::new(),
                status: "processing".into(),
                error: None,
            });
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if status.success() {
        let _ = app.emit("download-progress", DownloadProgress {
            id: id_clone,
            percent: 100.0,
            speed: String::new(),
            eta: String::new(),
            status: "done".into(),
            error: None,
        });
        Ok(id)
    } else {
        let _ = app.emit("download-progress", DownloadProgress {
            id: id_clone,
            percent: 0.0,
            speed: String::new(),
            eta: String::new(),
            status: "error".into(),
            error: Some("Download failed".into()),
        });
        Err("Download failed".into())
    }
}

#[tauri::command]
pub fn get_default_download_dir() -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot find home directory")?;
    let download_dir = PathBuf::from(&home).join("Downloads");
    Ok(download_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg("-R").arg(&path).spawn().map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;

    Ok(())
}

// ─── Parsing helpers ─────────────────────────────────────

fn parse_percent(line: &str) -> f64 {
    // [download]  45.2% of ...
    let re = regex_lite::Regex::new(r"(\d+\.?\d*)%").unwrap();
    if let Some(caps) = re.captures(line) {
        return caps[1].parse().unwrap_or(0.0);
    }
    0.0
}

fn parse_speed(line: &str) -> String {
    // at 2.3MiB/s
    let re = regex_lite::Regex::new(r"at\s+([\d.]+\w+/s)").unwrap();
    if let Some(caps) = re.captures(line) {
        return caps[1].to_string();
    }
    String::new()
}

fn parse_eta(line: &str) -> String {
    // ETA 00:30
    let re = regex_lite::Regex::new(r"ETA\s+([\d:]+)").unwrap();
    if let Some(caps) = re.captures(line) {
        return caps[1].to_string();
    }
    String::new()
}

fn chrono_free_id() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
