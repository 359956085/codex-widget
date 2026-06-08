mod quota;

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, State, WebviewWindow};
use tokio::sync::Mutex;

use quota::QuotaSnapshot;

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main-tray";

pub struct AppState {
    quota_lock: Mutex<()>,
    always_on_top: AtomicBool,
}

impl AppState {
    fn new() -> Self {
        Self {
            quota_lock: Mutex::new(()),
            always_on_top: AtomicBool::new(true),
        }
    }
}

#[tauri::command]
async fn get_quota(state: State<'_, AppState>) -> Result<QuotaSnapshot, String> {
    // Codex app-server 启动成本较高，用互斥锁避免多次刷新并发拉起多个子进程。
    let _guard = state.quota_lock.lock().await;
    quota::get_quota().await.map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_always_on_top(state: State<'_, AppState>) -> bool {
    state.always_on_top.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_always_on_top(
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
fn open_codex() -> Result<(), String> {
    let command = quota::resolve_codex_command();
    Command::new(&command)
        .spawn()
        .map_err(|error| format!("无法打开 Codex：{}，{}", command.display(), error))?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .setup(|app| {
            let window = app
                .get_webview_window(MAIN_WINDOW_LABEL)
                .expect("主窗口不存在");
            // Windows 的无边框原生阴影会附带 1px 白边，圆角加大后会在透明角落露出虚框。
            window.set_shadow(false)?;
            window.set_icon(load_app_icon()?)?;
            place_window_top_right(&window)?;
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
            open_codex
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}

fn place_window_top_right(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let work_area = monitor.work_area();
        let size = window.outer_size()?;
        let x = work_area.position.x + work_area.size.width as i32 - size.width as i32 - 24;
        let y = work_area.position.y + 24;
        window.set_position(Position::Physical(PhysicalPosition { x, y }))?;
    }
    Ok(())
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app, true)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(load_app_icon()?)
        .tooltip("Codex 额度小组件")
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

fn rebuild_tray_menu(app: &AppHandle, always_on_top: bool) -> tauri::Result<()> {
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

fn load_app_icon() -> tauri::Result<Image<'static>> {
    // 托盘和开发期窗口图标复用同一份资源，避免打包图标与运行时图标不一致。
    Ok(Image::from_bytes(include_bytes!("../icons/icon.png"))?.to_owned())
}
