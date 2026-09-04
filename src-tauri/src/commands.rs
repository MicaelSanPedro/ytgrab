use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

// ─── Tipos ───────────────────────────────────────────────

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
    pub format: String,
    pub quality: String,
    pub output_dir: String,
    pub filename: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub id: String,
    pub percent: f64,
    pub speed: String,
    pub eta: String,
    pub status: String,
    pub error: Option<String>,
}

// ─── Helpers ─────────────────────────────────────────────

fn find_ytdlp() -> Result<PathBuf, String> {
    let candidates: Vec<Option<PathBuf>> = if cfg!(target_os = "windows") {
        vec![
            Some(PathBuf::from("yt-dlp.exe")),
            dirs_path("APPDATA").map(|p| p.join("ytgrab/yt-dlp.exe")),
            dirs_path("LOCALAPPDATA").map(|p| p.join("ytgrab/yt-dlp.exe")),
        ]
    } else {
        vec![
            Some(PathBuf::from("/usr/local/bin/yt-dlp")),
            Some(PathBuf::from("/usr/bin/yt-dlp")),
            dirs_path("HOME").map(|p| p.join(".local/bin/yt-dlp")),
            dirs_path("HOME").map(|p| p.join(".ytgrab/yt-dlp")),
        ]
    };

    for candidate in candidates.iter().flatten() {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    if let Ok(output) = which_ytdlp() {
        return Ok(output);
    }

    Err("yt-dlp não encontrado. Instale usando o botão abaixo ou manualmente.".into())
}

fn dirs_path(var: &str) -> Option<PathBuf> {
    std::env::var(var).ok().map(PathBuf::from)
}

fn which_ytdlp() -> Result<PathBuf, String> {
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    let output = std::process::Command::new(cmd)
        .arg("yt-dlp")
        .output()
        .map_err(|e| format!("Erro ao buscar yt-dlp: {}", e))?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let p = PathBuf::from(&path);
        if p.exists() {
            return Ok(p);
        }
    }
    Err("yt-dlp não está no PATH".into())
}

fn find_ffmpeg() -> Result<PathBuf, String> {
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    let output = std::process::Command::new(cmd)
        .arg("ffmpeg")
        .output()
        .map_err(|e| format!("Erro ao buscar ffmpeg: {}", e))?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(PathBuf::from(path));
    }
    Err("ffmpeg não encontrado. Instale o ffmpeg para continuar.".into())
}

// ─── Comandos Tauri ─────────────────────────────────────

#[tauri::command]
pub fn check_dependencies() -> Result<serde_json::Value, String> {
    let ytdlp = find_ytdlp().ok();
    let ffmpeg = find_ffmpeg().ok();
    let ready = ytdlp.is_some() && ffmpeg.is_some();
    Ok(serde_json::json!({
        "ytdlp": ytdlp.as_ref().map(|p| p.to_string_lossy().to_string()),
        "ffmpeg": ffmpeg.as_ref().map(|p| p.to_string_lossy().to_string()),
        "ready": ready
    }))
}

#[tauri::command]
pub async fn get_video_info(url: String) -> Result<VideoInfo, String> {
    let ytdlp = find_ytdlp()?;

    let output = tokio::process::Command::new(&ytdlp)
        .arg("--dump-json")
        .arg("--no-download")
        .arg("--flat-playlist")
        .arg("--extractor-args")
        .arg("youtube:player_client=android")
        .arg(&url)
        .output()
        .await
        .map_err(|e| format!("Falha ao executar yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Erro do yt-dlp: {}", stderr));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Falha ao processar resposta do yt-dlp: {}", e))?;

    let title = data["title"].as_str().unwrap_or("Desconhecido").to_string();
    let thumbnail = data["thumbnail"].as_str().unwrap_or("").to_string();
    let duration = data["duration"].as_f64().map(|d| d as u64);

    let mut formats = Vec::new();
    if let Some(fmts) = data["formats"].as_array() {
        for f in fmts {
            formats.push(FormatInfo {
                format_id: f["format_id"].as_str().unwrap_or("").to_string(),
                ext: f["ext"].as_str().unwrap_or("").to_string(),
                resolution: f["resolution"].as_str().map(|s| s.to_string()),
                fps: f["fps"].as_f64(),
                vcodec: f["vcodec"].as_str().unwrap_or("none").to_string(),
                acodec: f["acodec"].as_str().unwrap_or("none").to_string(),
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

    let output_template = format!("{}/{}.%(ext)s", options.output_dir, options.filename);

    // Comando simples e direto, igual ao terminal
    let mut args = vec![
        "--newline".to_string(),
        "--no-warnings".to_string(),
        "-o".to_string(),
        output_template,
        // Fix 403 do YouTube - força player_client=android
        "--extractor-args".to_string(),
        "youtube:player_client=android".to_string(),
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
                _ => args.push("0".to_string()),
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
            args.push(format!("bv*[height<={}]+ba/b[height<={}]/b", height, height));
            args.push("--merge-output-format".to_string());
            args.push("mp4".to_string());
            args.push("--embed-thumbnail".to_string());
            args.push("--add-metadata".to_string());
        }
        _ => return Err(format!("Formato não suportado: {}", options.format)),
    }

    args.push(options.url.clone());

    let id_clone = id.clone();
    let app_clone = app.clone();

    // Executa o yt-dlp igual ao cmd
    let mut child = tokio::process::Command::new(&ytdlp)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar yt-dlp: {}", e))?;

    let stdout = child.stdout.take().ok_or("Sem saída padrão")?;
    let stderr_handle = child.stderr.take().ok_or("Sem saída de erro")?;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let stderr_reader = BufReader::new(stderr_handle);
    let mut stderr_lines = stderr_reader.lines();
    let mut stderr_output = String::new();

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(line_str)) => {
                        if line_str.starts_with("[download]") && line_str.contains('%') {
                            let _ = app_clone.emit("download-progress", DownloadProgress {
                                id: id_clone.clone(),
                                percent: parse_percent(&line_str),
                                speed: parse_speed(&line_str),
                                eta: parse_eta(&line_str),
                                status: "downloading".into(),
                                error: None,
                            });
                        } else if line_str.contains("Merging") || line_str.contains("Deleting") || line_str.contains("Converting") || line_str.contains("Extracting") {
                            let _ = app_clone.emit("download-progress", DownloadProgress {
                                id: id_clone.clone(), percent: 100.0, speed: String::new(), eta: String::new(),
                                status: "processing".into(), error: None,
                            });
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            err_line = stderr_lines.next_line() => {
                if let Ok(Some(l)) = err_line { stderr_output.push_str(&l); stderr_output.push('\n'); }
            }
        }
    }

    while let Ok(Some(l)) = stderr_lines.next_line().await { stderr_output.push_str(&l); stderr_output.push('\n'); }
    let status = child.wait().await.map_err(|e| e.to_string())?;

    if status.success() {
        let _ = app.emit("download-progress", DownloadProgress {
            id: id_clone, percent: 100.0, speed: String::new(), eta: String::new(),
            status: "done".into(), error: None,
        });
        Ok(id)
    } else {
        let err_msg = if stderr_output.is_empty() { "Download falhou".to_string() }
        else { format!("Erro: {}", stderr_output.trim().lines().take(3).collect::<Vec<_>>().join("\n")) };
        let _ = app.emit("download-progress", DownloadProgress {
            id: id_clone, percent: 0.0, speed: String::new(), eta: String::new(),
            status: "error".into(), error: Some(err_msg.clone()),
        });
        Err(err_msg)
    }
}



// ─── Instalar yt-dlp ────────────────────────────────────

#[tauri::command]
pub async fn install_ytdlp(app: AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let emit_progress = |app: &AppHandle, msg: &str, pct: f64| {
        let _ = app.emit("install-progress", serde_json::json!({
            "message": msg,
            "percent": pct
        }));
    };

    emit_progress(&app, "Baixando yt-dlp...", 10.0);

    // Determine install directory and download URL
    let (install_dir, file_name, download_url) = if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA")
            .unwrap_or_else(|_| dirs_path("LOCALAPPDATA").unwrap_or_default().to_string_lossy().to_string());
        let dir = PathBuf::from(&appdata).join("ytgrab");
        (dir, "yt-dlp.exe".to_string(), "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe".to_string())
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let dir = PathBuf::from(&home).join(".local").join("bin");
        (dir, "yt-dlp".to_string(), "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp".to_string())
    };

    // Create install directory
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Erro ao criar pasta de instalação: {}", e))?;

    let dest_path = install_dir.join(&file_name);

    // Download the binary
    let client = reqwest::Client::new();
    let mut response = client.get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar yt-dlp: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Falha ao baixar yt-dlp (HTTP {})", response.status()));
    }

    emit_progress(&app, "Salvando arquivo...", 50.0);

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::io::BufWriter::new(
        tokio::fs::File::create(&dest_path)
            .await
            .map_err(|e| format!("Erro ao criar arquivo: {}", e))?
    );

    use tokio::io::AsyncWriteExt;
    let mut buffer = [0u8; 8192];

    loop {
        let n = response.chunk().await
            .map_err(|e| format!("Erro no download: {}", e))?;
        
        match n {
            Some(chunk) => {
                let mut cursor = std::io::Cursor::new(&chunk);
                loop {
                    let read = std::io::Read::read(&mut cursor, &mut buffer).map_err(|e| format!("Erro de leitura: {}", e))?;
                    if read == 0 { break; }
                    file.write_all(&buffer[..read]).await
                        .map_err(|e| format!("Erro ao salvar: {}", e))?;
                    downloaded += read as u64;
                    if total_size > 0 {
                        let pct = 50.0 + (downloaded as f64 / total_size as f64) * 40.0;
                        emit_progress(&app, "Baixando yt-dlp...", pct);
                    }
                }
            }
            None => break,
        }
    }

    file.flush().await.map_err(|e| format!("Erro ao finalizar arquivo: {}", e))?;
    drop(file);

    emit_progress(&app, "Configurando permissões...", 95.0);

    // On Linux, make it executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Erro ao definir permissões: {}", e))?;
    }

    emit_progress(&app, "yt-dlp instalado com sucesso!", 100.0);

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_ytdlp_install_info() -> Result<serde_json::Value, String> {
    if cfg!(target_os = "windows") {
        Ok(serde_json::json!({
            "platform": "windows",
            "command": "winget install yt-dlp.yt-dlp",
            "manualUrl": "https://github.com/yt-dlp/yt-dlp/releases/latest",
            "hint": "Aceite os termos digitando Y quando pedido."
        }))
    } else {
        Ok(serde_json::json!({
            "platform": "linux",
            "command": "pip install yt-dlp  (ou: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp)",
            "manualUrl": "https://github.com/yt-dlp/yt-dlp/releases/latest",
            "hint": "Se usar pip, digite Y para aceitar os termos."
        }))
    }
}

// ─── Parsing helpers ─────────────────────────────────────

fn parse_percent(line: &str) -> f64 {
    let re = regex_lite::Regex::new(r"(\d+\.?\d*)%").unwrap();
    if let Some(caps) = re.captures(line) {
        return caps[1].parse().unwrap_or(0.0);
    }
    0.0
}

fn parse_speed(line: &str) -> String {
    let re = regex_lite::Regex::new(r"at\s+([\d.]+\w+/s)").unwrap();
    if let Some(caps) = re.captures(line) {
        return caps[1].to_string();
    }
    String::new()
}

fn parse_eta(line: &str) -> String {
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
