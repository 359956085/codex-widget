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
    pub expiries: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResetCreditExpiries {
    pub expiries: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EstimateStatus {
    Ready,
    Collecting,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CycleQuotaEstimate {
    pub cycle_ends_at: String,
    pub status: EstimateStatus,
    pub full_quota_usd: Option<f64>,
    pub sample_count: u32,
    pub percent_span: u8,
    pub unpriced_event_count: u32,
    pub suspected_remote_interval_count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaEstimate {
    pub price_table_as_of: String,
    pub previous: Option<CycleQuotaEstimate>,
    pub current: Option<CycleQuotaEstimate>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_estimate: Option<QuotaEstimate>,
}
