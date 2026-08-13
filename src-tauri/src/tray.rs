use std::sync::atomic::Ordering;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::app_state::AppState;
use crate::logging::LogLevel;
use crate::MAIN_WINDOW_LABEL;

const TRAY_ID: &str = "main-tray";

pub(crate) fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app, true)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(load_app_icon()?)
        .tooltip("Codex CLI 额度小组件")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle-window" => {
                let _ = toggle_window(app);
            }
            "refresh-quota" => {
                let _ = app.emit("quota:refresh-requested", ());
            }
            "toggle-always-on-top" => {
                if let Err(error) = toggle_always_on_top_from_tray(app) {
                    log_tray_error(app, "切换置顶失败", &error);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(error) = toggle_window(tray.app_handle()) {
                    log_tray_error(tray.app_handle(), "切换窗口显示状态失败", &error);
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn build_tray_menu(app: &AppHandle, always_on_top: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let toggle = MenuItem::with_id(app, "toggle-window", "显示/隐藏", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh-quota", "刷新数据", true, None::<&str>)?;
    let pin_label = if always_on_top {
        "取消置顶"
    } else {
        "置顶"
    };
    let pin = MenuItem::with_id(app, "toggle-always-on-top", pin_label, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    Menu::with_items(app, &[&toggle, &refresh, &pin, &separator, &quit])
}

pub(crate) fn rebuild_tray_menu(app: &AppHandle, always_on_top: bool) -> tauri::Result<()> {
    let menu = build_tray_menu(app, always_on_top)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

pub(crate) fn set_always_on_top_authoritative(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    value: bool,
) -> tauri::Result<bool> {
    // 窗口属性是权威状态；托盘与事件只是投影，投影失败不能把已成功操作报告成失败。
    window.set_always_on_top(value)?;
    let state = app.state::<AppState>();
    state.always_on_top.store(value, Ordering::SeqCst);

    if let Err(error) = rebuild_tray_menu(app, value) {
        log_tray_error(app, "刷新置顶托盘菜单失败", &error);
    }
    if let Err(error) = app.emit("window:always-on-top-changed", value) {
        log_tray_error(app, "发送置顶状态事件失败", &error);
    }
    Ok(value)
}

fn toggle_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if window.is_visible()? {
            window.hide()?;
        } else {
            window.show()?;
            window.set_focus()?;
        }
    }
    Ok(())
}

fn toggle_always_on_top_from_tray(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let next = !state.always_on_top.load(Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        set_always_on_top_authoritative(app, &window, next)?;
    }
    Ok(())
}

fn log_tray_error(app: &AppHandle, context: &str, error: &impl std::fmt::Display) {
    app.state::<AppState>().logger.write_best_effort(
        LogLevel::Error,
        "backend.tray",
        &format!("{context}：{error}"),
    );
}

pub(crate) fn load_app_icon() -> tauri::Result<Image<'static>> {
    // 托盘和开发期窗口图标复用同一份资源，避免打包图标与运行时图标不一致。
    Ok(Image::from_bytes(include_bytes!("../icons/icon.png"))?.to_owned())
}
