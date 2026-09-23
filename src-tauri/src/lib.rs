#[cfg(target_os = "macos")]
mod macos_wechat;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "macos")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        macos_wechat::request_screen_capture_access,
        macos_wechat::scan_wechat,
        macos_wechat::import_recent_wechat_customers,
        macos_wechat::fill_wechat_input,
        macos_wechat::agent_strategy,
        macos_wechat::check_agent_provider,
        macos_wechat::bocha_search
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running Jev Sales Copilot");
}
