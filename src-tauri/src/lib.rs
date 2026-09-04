mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::check_dependencies,
            commands::get_video_info,
            commands::download,
            commands::get_default_download_dir,
            commands::open_in_file_manager,
            commands::install_ytdlp,
            commands::get_ytdlp_install_info,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar aplicação tauri");
}
