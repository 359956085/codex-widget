mod app_state;
mod autostart;
mod commands;
mod quota;
mod settings;
mod tray;
mod window_state;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

use app_state::AppState;
use commands::{
    close_app, get_always_on_top, get_quota, get_settings, hide_window, open_codex, save_settings,
    set_always_on_top,
};
use settings::SettingsService;
use tray::{create_tray, load_app_icon};
use window_state::apply_startup_window_state;

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let window = app
                .get_webview_window(MAIN_WINDOW_LABEL)
                .expect("主窗口不存在");
            // Windows 的无边框原生阴影会附带 1px 白边，圆角加大后会在透明角落露出虚框。
            window.set_shadow(false)?;
            window.set_icon(load_app_icon()?)?;
            let settings = SettingsService::load(app.handle()).unwrap_or_default();
            apply_startup_window_state(&window, &settings)?;
            window.show()?;
            create_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_quota,
            hide_window,
            close_app,
            get_always_on_top,
            set_always_on_top,
            open_codex,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}
