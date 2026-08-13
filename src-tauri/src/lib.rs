mod app_state;
mod autostart;
mod commands;
mod logging;
mod quota;
mod settings;
mod tray;
mod window_state;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

use app_state::AppState;
use autostart::reconcile_auto_start;
use commands::{
    close_app, get_always_on_top, get_quota, get_reset_credit_expiries, get_settings, hide_window,
    open_codex, save_settings, set_always_on_top, write_frontend_log,
};
use logging::LogLevel;
use settings::{AppSettings, SettingsService};
use tray::{create_tray, load_app_icon};
use window_state::apply_startup_window_state;

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

struct StartupSettings {
    settings: AppSettings,
    load_error: Option<String>,
}

impl StartupSettings {
    fn should_sync_auto_start(&self) -> bool {
        self.load_error.is_none()
    }
}

fn resolve_startup_settings(result: anyhow::Result<AppSettings>) -> StartupSettings {
    match result {
        Ok(settings) => StartupSettings {
            settings,
            load_error: None,
        },
        Err(error) => StartupSettings {
            settings: AppSettings::default(),
            load_error: Some(error.to_string()),
        },
    }
}

pub fn run() {
    // Reqwest 与 updater 共用 Ring，启动时显式安装，避免依赖传递特性决定 TLS 行为。
    let _ = rustls::crypto::ring::default_provider().install_default();

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
            let startup_settings = resolve_startup_settings(SettingsService::load(app.handle()));
            let state = app.state::<AppState>();
            state
                .logger
                .configure(app.handle(), startup_settings.settings.log_level)?;
            if let Some(error) = &startup_settings.load_error {
                // 损坏配置启动时只回退运行，不能覆盖文件或按默认值改写系统自启状态。
                state.logger.write_best_effort(
                    LogLevel::Error,
                    "backend.settings",
                    &format!("启动设置读取失败，当前运行使用默认值：{error}"),
                );
            } else if startup_settings.should_sync_auto_start() {
                if let Err(error) =
                    reconcile_auto_start(app.handle(), startup_settings.settings.auto_start_enabled)
                {
                    state
                        .logger
                        .write_best_effort(LogLevel::Error, "backend.settings", &error);
                }
            }
            apply_startup_window_state(&window, &startup_settings.settings)?;
            window.show()?;
            create_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_quota,
            get_reset_credit_expiries,
            hide_window,
            close_app,
            get_always_on_top,
            set_always_on_top,
            open_codex,
            get_settings,
            save_settings,
            write_frontend_log
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 损坏配置启动时禁用自启校准() {
        let startup = resolve_startup_settings(Err(anyhow::anyhow!("设置文件格式无效")));

        assert!(startup.load_error.is_some());
        assert!(!startup.should_sync_auto_start());
        assert_eq!(startup.settings, AppSettings::default());
    }

    #[test]
    fn 有效配置启动时允许自启校准() {
        let startup = resolve_startup_settings(Ok(AppSettings::default()));

        assert!(startup.load_error.is_none());
        assert!(startup.should_sync_auto_start());
    }
}
