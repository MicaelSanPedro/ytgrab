mod commands;

/// First-run automatic dependency setup (standalone yt-dlp + static ffmpeg)
/// on Linux desktop.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod linux_setup;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::install_ytdlp,
            commands::install_ffmpeg,
            commands::check_dependencies,
            commands::setup_dependencies,
            commands::get_platform,
            commands::get_deps_dir,
            commands::check_app_update,
            commands::get_ytdlp_install_info,
            commands::get_video_info,
            commands::get_default_download_dir,
            commands::download,
            commands::open_in_file_manager,
            commands::cancel_download,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar YTGrab");
}
