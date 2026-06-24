use std::sync::atomic::Ordering;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::app_state::AppState;
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
                let _ = toggle_always_on_top_from_tray(app);
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
                let _ = toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn build_tray_menu(app: &AppHandle, always_on_top: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let toggle = MenuItem::with_id(app, "toggle-window", "显示/隐藏", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh-quota", "刷新额度", true, None::<&str>)?;
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
        window.set_always_on_top(next)?;
    }
    state.always_on_top.store(next, Ordering::SeqCst);
    rebuild_tray_menu(app, next)?;
    app.emit("window:always-on-top-changed", next)?;
    Ok(())
}

pub(crate) fn load_app_icon() -> tauri::Result<Image<'static>> {
    // 托盘和开发期窗口图标复用同一份资源，避免打包图标与运行时图标不一致。
    Ok(Image::from_bytes(include_bytes!("../icons/icon.png"))?.to_owned())
}
