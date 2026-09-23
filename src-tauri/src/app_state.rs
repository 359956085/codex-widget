use std::sync::atomic::AtomicBool;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::logging::AppLogger;
use crate::quota::{QuotaEstimator, QuotaService, QuotaSnapshot, QuotaWindowsSnapshot};

pub struct AppState {
    pub(crate) quota_service: Mutex<QuotaService>,
    pub(crate) quota_windows: Mutex<Option<QuotaWindowsSnapshot>>,
    pub(crate) quota_estimator: QuotaEstimator,
    pub(crate) settings_lock: Mutex<()>,
    pub(crate) always_on_top: AtomicBool,
    pub(crate) logger: AppLogger,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            quota_service: Mutex::new(QuotaService::new()),
            quota_windows: Mutex::new(None),
            quota_estimator: QuotaEstimator::new(),
            settings_lock: Mutex::new(()),
            always_on_top: AtomicBool::new(true),
            logger: AppLogger::new(),
        }
    }

    pub(crate) async fn publish_quota_windows(
        &self,
        app: &AppHandle,
        snapshot: &QuotaSnapshot,
        partial: bool,
    ) {
        let next = QuotaWindowsSnapshot::from(snapshot);
        let mut cache = self.quota_windows.lock().await;
        let Some(next) = accept_window_update(&mut cache, next, partial) else {
            return;
        };
        drop(cache);
        let _ = app.emit("quota:windows-updated", next);
    }
}

fn accept_window_update(
    cache: &mut Option<QuotaWindowsSnapshot>,
    mut next: QuotaWindowsSnapshot,
    partial: bool,
) -> Option<QuotaWindowsSnapshot> {
    if cache
        .as_ref()
        .is_some_and(|current| current.revision >= next.revision)
    {
        return None;
    }
    if partial {
        if let Some(previous) = cache.as_ref() {
            next.primary = next.primary.or_else(|| previous.primary.clone());
            next.secondary = next.secondary.or_else(|| previous.secondary.clone());
            let active = next.primary.as_ref().or(next.secondary.as_ref());
            next.remaining_percent = active.map(|window| window.remaining_percent);
            next.used_percent = active.map(|window| window.used_percent);
            next.resets_at = active.and_then(|window| window.resets_at.clone());
        }
    }
    *cache = Some(next.clone());
    Some(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quota::types::QuotaWindow;

    fn windows(revision: u64, primary: Option<u8>, secondary: Option<u8>) -> QuotaWindowsSnapshot {
        let window = |remaining_percent| QuotaWindow {
            used_percent: 100 - remaining_percent,
            remaining_percent,
            window_duration_mins: None,
            resets_at: None,
        };
        QuotaWindowsSnapshot {
            revision,
            primary: primary.map(window),
            secondary: secondary.map(window),
            remaining_percent: primary.or(secondary),
            used_percent: primary.or(secondary).map(|value| 100 - value),
            resets_at: None,
            fetched_at: String::new(),
        }
    }

    #[test]
    fn 旧会话或乱序事件不能覆盖新版缓存() {
        let mut cache = Some(windows(5, Some(80), Some(70)));
        assert!(accept_window_update(&mut cache, windows(4, Some(90), None), false).is_none());
        assert_eq!(cache.unwrap().primary.unwrap().remaining_percent, 80);
    }

    #[test]
    fn 部分通知只更新收到的窗口() {
        let mut cache = Some(windows(5, Some(80), Some(70)));
        let next = accept_window_update(&mut cache, windows(6, None, Some(60)), true).unwrap();
        assert_eq!(next.primary.unwrap().remaining_percent, 80);
        assert_eq!(next.secondary.unwrap().remaining_percent, 60);
        assert_eq!(next.remaining_percent, Some(80));
    }
}
