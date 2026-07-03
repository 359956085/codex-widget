use std::path::Path;
use std::process::Command;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::app_state::AppState;
use crate::autostart::sync_auto_start;
use crate::logging::LogLevel;
use crate::quota::{self, QuotaSnapshot, ResetCreditExpiries};
use crate::settings::{AppSettings, SettingsService};
use crate::tray::rebuild_tray_menu;

#[tauri::command]
pub(crate) async fn get_quota(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<QuotaSnapshot, String> {
    let settings = SettingsService::load(&app).map_err(|error| {
        let message = error.to_string();
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.quota", &message);
        message
    })?;
    let codex_cli_path = settings.codex_cli_path.as_deref().map(Path::new);
    // 长连接会话必须串行使用，避免多个刷新同时读写同一条 stdio 通道。
    let mut service = state.quota_service.lock().await;
    service.get_quota(codex_cli_path).await.map_err(|error| {
        let message = error.to_string();
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.quota", &message);
        message
    })
}

#[tauri::command]
pub(crate) async fn get_reset_credit_expiries(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResetCreditExpiries, String> {
    let settings = SettingsService::load(&app).map_err(|error| error.to_string())?;
    quota::fetch_reset_credit_expiries(settings.update_proxy.as_deref())
        .await
        .map_err(|error| {
            let message = error.to_string();
            state
                .logger
                .write_best_effort(LogLevel::Error, "backend.quota.resetCredits", &message);
            message
        })
}

#[tauri::command]
pub(crate) fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub(crate) fn get_always_on_top(state: State<'_, AppState>) -> bool {
    state.always_on_top.load(Ordering::SeqCst)
}

#[tauri::command]
pub(crate) fn set_always_on_top(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    value: bool,
) -> Result<bool, String> {
    window.set_always_on_top(value).map_err(|error| {
        let message = error.to_string();
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.window", &message);
        message
    })?;
    state.always_on_top.store(value, Ordering::SeqCst);
    rebuild_tray_menu(&app, value).map_err(|error| error.to_string())?;
    app.emit("window:always-on-top-changed", value)
        .map_err(|error| error.to_string())?;
    Ok(value)
}

#[tauri::command]
pub(crate) fn open_codex(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let settings = SettingsService::load(&app).map_err(|error| error.to_string())?;
    let codex_cli_path = settings.codex_cli_path.as_deref().map(Path::new);
    let command = quota::resolve_codex_command(codex_cli_path);
    Command::new(&command).spawn().map_err(|error| {
        let message = format!("无法打开 Codex CLI：{}，{}", command.display(), error);
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.codex", &message);
        message
    })?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    SettingsService::load(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let previous = SettingsService::load(&app).map_err(|error| error.to_string())?;
    let settings = SettingsService::normalize(settings).map_err(|error| error.to_string())?;
    if previous.auto_start_enabled != settings.auto_start_enabled {
        sync_auto_start(&app, settings.auto_start_enabled).map_err(|error| {
            state
                .logger
                .write_best_effort(LogLevel::Error, "backend.settings", &error);
            error
        })?;
    }
    let saved = SettingsService::save(&app, settings).map_err(|error| error.to_string())?;
    state
        .logger
        .configure(&app, saved.log_level)
        .map_err(|error| error.to_string())?;
    state
        .logger
        .write_best_effort(LogLevel::Debug, "backend.settings", "设置已保存");
    if previous.codex_cli_path != saved.codex_cli_path {
        let mut service = state.quota_service.lock().await;
        service.reset_session().await;
    }
    Ok(saved)
}

#[tauri::command]
pub(crate) fn write_frontend_log(
    state: State<'_, AppState>,
    level: LogLevel,
    message: String,
    context: Option<String>,
) -> Result<(), String> {
    let source = context
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("frontend");
    state
        .logger
        .write(level, source, &message)
        .map(|_| ())
        .map_err(|error| error.to_string())
}
