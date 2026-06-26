use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub used_percent: u8,
    pub remaining_percent: u8,
    pub window_duration_mins: Option<u64>,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResetCredits {
    pub available_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    pub limit_id: String,
    pub limit_name: String,
    pub plan_type: String,
    pub reached_type: Option<String>,
    pub credits: Option<Value>,
    pub reset_credits: Option<ResetCredits>,
    pub primary: Option<QuotaWindow>,
    pub secondary: Option<QuotaWindow>,
    pub remaining_percent: Option<u8>,
    pub used_percent: Option<u8>,
    pub resets_at: Option<String>,
    pub fetched_at: String,
}
