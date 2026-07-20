use tauri::{LogicalSize, PhysicalPosition, Position, Size, WebviewWindow};

use crate::settings::{AppSettings, BallDock, WidgetMode, WindowPosition};

const PANEL_WIDTH: f64 = 390.0;
const PANEL_HEIGHT: f64 = 236.0;
const BALL_SIZE: f64 = 88.0;
const SNAP_DISTANCE: i32 = 24;

#[derive(Clone, Copy, PartialEq, Eq)]
struct WorkAreaBounds {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

pub(crate) fn apply_startup_window_state(
    window: &WebviewWindow,
    settings: &AppSettings,
) -> tauri::Result<()> {
    window.set_size(Size::Logical(window_size_for_mode(settings.widget_mode)))?;
    if restore_saved_window_position(window, settings)? {
        return Ok(());
    }
    place_window_top_right(window)
}

fn window_size_for_mode(mode: WidgetMode) -> LogicalSize<f64> {
    match mode {
        WidgetMode::Panel => LogicalSize {
            width: PANEL_WIDTH,
            height: PANEL_HEIGHT,
        },
        WidgetMode::Ball => LogicalSize {
            width: BALL_SIZE,
            height: BALL_SIZE,
        },
    }
}

fn restore_saved_window_position(
    window: &WebviewWindow,
    settings: &AppSettings,
) -> tauri::Result<bool> {
    let Some(position) = saved_position_for_mode(settings) else {
        return Ok(false);
    };

    let size = window.outer_size()?;
    let window_width = size.width as i32;
    let window_height = size.height as i32;
    let monitors = window.available_monitors()?;
    let mut work_areas: Vec<WorkAreaBounds> = monitors
        .iter()
        .map(|monitor| work_area_bounds(monitor.work_area()))
        .collect();
    for area in &work_areas {
        if !position_belongs_to_area(position, window_width, window_height, *area) {
            continue;
        }
        if is_ball_at_internal_work_area_edge(
            settings,
            position,
            window_width,
            window_height,
            *area,
            &work_areas,
        ) {
            set_exact_position(window, position)?;
        } else {
            set_position_in_work_area(
                window,
                position,
                window_width,
                window_height,
                *area,
                safe_startup_ball_dock(
                    settings,
                    *area,
                    &work_areas,
                    window_width,
                    window_height,
                    position,
                ),
            )?;
        }
        return Ok(true);
    }

    if let Some(monitor) = window.primary_monitor()? {
        let area = work_area_bounds(monitor.work_area());
        if !work_areas.contains(&area) {
            work_areas.push(area);
        }
        if is_ball_at_internal_work_area_edge(
            settings,
            position,
            window_width,
            window_height,
            area,
            &work_areas,
        ) {
            set_exact_position(window, position)?;
        } else {
            set_position_in_work_area(
                window,
                position,
                window_width,
                window_height,
                area,
                safe_startup_ball_dock(
                    settings,
                    area,
                    &work_areas,
                    window_width,
                    window_height,
                    position,
                ),
            )?;
        }
        return Ok(true);
    }

    Ok(false)
}

fn set_exact_position(window: &WebviewWindow, position: WindowPosition) -> tauri::Result<()> {
    window.set_position(Position::Physical(PhysicalPosition {
        x: position.x,
        y: position.y,
    }))
}

fn saved_position_for_mode(settings: &AppSettings) -> Option<WindowPosition> {
    match settings.widget_mode {
        WidgetMode::Panel => settings.panel_position,
        WidgetMode::Ball => settings.ball_position,
    }
}

fn startup_ball_dock(settings: &AppSettings) -> Option<BallDock> {
    if settings.widget_mode == WidgetMode::Ball {
        settings.ball_dock
    } else {
        None
    }
}

fn position_belongs_to_area(
    position: WindowPosition,
    window_width: i32,
    window_height: i32,
    area: WorkAreaBounds,
) -> bool {
    let center_x = position.x + window_width / 2;
    let center_y = position.y + window_height / 2;
    center_x >= area.left
        && center_x <= area.right
        && center_y >= area.top
        && center_y <= area.bottom
}

fn set_position_in_work_area(
    window: &WebviewWindow,
    position: WindowPosition,
    window_width: i32,
    window_height: i32,
    area: WorkAreaBounds,
    ball_dock: Option<BallDock>,
) -> tauri::Result<()> {
    let mut x = position.x.clamp(
        area.left,
        area.left.max(area.right.saturating_sub(window_width)),
    );
    let y = position.y.clamp(
        area.top,
        area.top.max(area.bottom.saturating_sub(window_height)),
    );

    if let Some(dock) = ball_dock {
        x = match dock {
            BallDock::Left => area.left - window_width / 2,
            BallDock::Right => area.right - window_width / 2,
        };
    }

    window.set_position(Position::Physical(PhysicalPosition { x, y }))
}

fn safe_startup_ball_dock(
    settings: &AppSettings,
    area: WorkAreaBounds,
    work_areas: &[WorkAreaBounds],
    window_width: i32,
    window_height: i32,
    position: WindowPosition,
) -> Option<BallDock> {
    let dock = startup_ball_dock(settings)?;
    let y = position.y.clamp(
        area.top,
        area.top.max(area.bottom.saturating_sub(window_height)),
    );

    // 多屏内部边界不能半隐藏，否则隐藏半边会显示到相邻屏幕。
    if edge_has_adjacent_work_area(area, dock, work_areas, window_width, window_height, y) {
        None
    } else {
        Some(dock)
    }
}

fn is_ball_at_internal_work_area_edge(
    settings: &AppSettings,
    position: WindowPosition,
    window_width: i32,
    window_height: i32,
    area: WorkAreaBounds,
    work_areas: &[WorkAreaBounds],
) -> bool {
    if settings.widget_mode != WidgetMode::Ball || work_areas.len() <= 1 {
        return false;
    }

    let Some(dock) = resolve_ball_dock(position, window_width, area) else {
        return false;
    };

    let max_y = area.top.max(area.bottom.saturating_sub(window_height));
    if position.y < area.top || position.y > max_y {
        return false;
    }

    let window_rect = WorkAreaBounds {
        left: position.x,
        top: position.y,
        right: position.x + window_width,
        bottom: position.y + window_height,
    };

    edge_has_adjacent_work_area(
        area,
        dock,
        work_areas,
        window_width,
        window_height,
        position.y,
    ) && work_areas
        .iter()
        .any(|other| *other != area && rects_intersect(window_rect, *other))
}

fn resolve_ball_dock(
    position: WindowPosition,
    window_width: i32,
    area: WorkAreaBounds,
) -> Option<BallDock> {
    let left_edge = position.x;
    let right_edge = position.x + window_width;
    let center_x = position.x + window_width / 2;
    let hits_left_dock = left_edge <= area.left + SNAP_DISTANCE;
    let hits_right_dock = right_edge >= area.right - SNAP_DISTANCE;

    if hits_left_dock && hits_right_dock {
        let area_center_x = area.left + (area.right - area.left) / 2;
        return if center_x <= area_center_x {
            Some(BallDock::Left)
        } else {
            Some(BallDock::Right)
        };
    }
    if hits_left_dock {
        return Some(BallDock::Left);
    }
    if hits_right_dock {
        return Some(BallDock::Right);
    }
    None
}

fn edge_has_adjacent_work_area(
    area: WorkAreaBounds,
    dock: BallDock,
    work_areas: &[WorkAreaBounds],
    window_width: i32,
    window_height: i32,
    y: i32,
) -> bool {
    let hidden_width = window_width / 2;
    let hidden_rect = match dock {
        BallDock::Left => WorkAreaBounds {
            left: area.left - hidden_width,
            top: y,
            right: area.left,
            bottom: y + window_height,
        },
        BallDock::Right => WorkAreaBounds {
            left: area.right,
            top: y,
            right: area.right + hidden_width,
            bottom: y + window_height,
        },
    };

    work_areas
        .iter()
        .any(|other| *other != area && rects_intersect(hidden_rect, *other))
}

fn rects_intersect(first: WorkAreaBounds, second: WorkAreaBounds) -> bool {
    first.left < second.right
        && first.right > second.left
        && first.top < second.bottom
        && first.bottom > second.top
}

fn work_area_bounds(work_area: &tauri::PhysicalRect<i32, u32>) -> WorkAreaBounds {
    let left = work_area.position.x;
    let top = work_area.position.y;
    WorkAreaBounds {
        left,
        top,
        right: left + work_area.size.width as i32,
        bottom: top + work_area.size.height as i32,
    }
}

fn place_window_top_right(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let work_area = monitor.work_area();
        let size = window.outer_size()?;
        let x =
            work_area.position.x + work_area.size.width as i32 - size.width as i32 - SNAP_DISTANCE;
        let y = work_area.position.y + SNAP_DISTANCE;
        window.set_position(Position::Physical(PhysicalPosition { x, y }))?;
    }
    Ok(())
}
