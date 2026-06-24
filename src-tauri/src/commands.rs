use std::path::Path;
use std::process::Command;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::app_state::AppState;
use crate::autostart::sync_auto_start;
use crate::quota::{self, QuotaSnapshot};
use crate::settings::{AppSettings, SettingsService};
use crate::tray::rebuild_tray_menu;

#[tauri::command]
pub(crate) async fn get_quota(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<QuotaSnapshot, String> {
    let settings = SettingsService::load(&app).map_err(|error| error.to_string())?;
    let codex_cli_path = settings.codex_cli_path.as_deref().map(Path::new);
    // 长连接会话必须串行使用，避免多个刷新同时读写同一条 stdio 通道。
    let mut service = state.quota_service.lock().await;
    service
        .get_quota(codex_cli_path)
        .await
        .map_err(|error| error.to_string())
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
    window
        .set_always_on_top(value)
        .map_err(|error| error.to_string())?;
    state.always_on_top.store(value, Ordering::SeqCst);
    rebuild_tray_menu(&app, value).map_err(|error| error.to_string())?;
    app.emit("window:always-on-top-changed", value)
        .map_err(|error| error.to_string())?;
    Ok(value)
}

#[tauri::command]
pub(crate) fn open_codex(app: AppHandle) -> Result<(), String> {
    let settings = SettingsService::load(&app).map_err(|error| error.to_string())?;
    let codex_cli_path = settings.codex_cli_path.as_deref().map(Path::new);
    let command = quota::resolve_codex_command(codex_cli_path);
    Command::new(&command)
        .spawn()
        .map_err(|error| format!("无法打开 Codex CLI：{}，{}", command.display(), error))?;
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
        sync_auto_start(&app, settings.auto_start_enabled)?;
    }
    let saved = SettingsService::save(&app, settings).map_err(|error| error.to_string())?;
    if previous.codex_cli_path != saved.codex_cli_path {
        let mut service = state.quota_service.lock().await;
        service.reset_session().await;
    }
    Ok(saved)
}
