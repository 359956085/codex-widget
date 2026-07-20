use std::sync::atomic::AtomicBool;

use tokio::sync::Mutex;

use crate::logging::AppLogger;
use crate::quota::QuotaService;

pub struct AppState {
    pub(crate) quota_service: Mutex<QuotaService>,
    pub(crate) settings_lock: Mutex<()>,
    pub(crate) always_on_top: AtomicBool,
    pub(crate) logger: AppLogger,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            quota_service: Mutex::new(QuotaService::new()),
            settings_lock: Mutex::new(()),
            always_on_top: AtomicBool::new(true),
            logger: AppLogger::new(),
        }
    }
}
