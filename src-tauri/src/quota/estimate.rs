use std::env;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde_json::Value;

use super::types::{CycleQuotaEstimate, EstimateStatus, QuotaEstimate};

mod cache;

use cache::EstimateCache;

const PRICE_TABLE_AS_OF: &str = "2026-09-05";
const WEEKLY_WINDOW_MINS: i64 = 10_080;
const LOOKBACK_SECONDS: i64 = 16 * 24 * 60 * 60;
const MAX_RESET_DISTANCE_SECONDS: i64 = 8 * 24 * 60 * 60;
const RESET_CLUSTER_SECONDS: i64 = 30 * 60;
const CURRENT_RESET_MATCH_SECONDS: i64 = 2 * 60 * 60;
const MIN_SAMPLE_COUNT: usize = 3;
const MIN_PERCENT_SPAN: f64 = 2.0;
const ACTIVITY_GAP_SECONDS: i64 = 15 * 60;
const LONG_CONTEXT_INPUT_TOKENS: u64 = 272_000;

#[derive(Debug, Clone, Copy)]
struct ModelPrice {
    input: f64,
    cached_input: f64,
    output: f64,
    cache_write_multiplier: Option<f64>,
}

#[derive(Debug, Clone, Copy, Default, Hash, PartialEq, Eq)]
struct TokenUsage {
    input: u64,
    cached_input: u64,
    cache_write_input: u64,
    output: u64,
    reasoning_output: u64,
    total: u64,
}

#[derive(Debug, Clone, PartialEq)]
struct UsageEvent {
    timestamp: i64,
    reset_at: i64,
    used_percent: f64,
    cost_usd: Option<f64>,
}

#[derive(Debug, Clone)]
struct EstimateCandidate {
    full_quota_usd: f64,
    delta_percent: f64,
    percent_interval: (f64, f64),
}

#[derive(Debug)]
struct CycleCluster {
    min_reset_at: i64,
    events: Vec<UsageEvent>,
}

#[derive(Debug, Default)]
pub(crate) struct QuotaEstimator {
    cache: Arc<Mutex<EstimateCache>>,
}

impl QuotaEstimator {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) async fn estimate_weekly_quota(
        &self,
        current_reset_at: &str,
    ) -> Result<QuotaEstimate> {
        let current_reset_at = DateTime::parse_from_rfc3339(current_reset_at)
            .context("周额度重置时间格式无效")?
            .timestamp();
        let codex_home = resolve_codex_home()?;
        self.estimate_from_codex_home(codex_home, current_reset_at, Utc::now().timestamp())
            .await
    }

    async fn estimate_from_codex_home(
        &self,
        codex_home: PathBuf,
        current_reset_at: i64,
        now: i64,
    ) -> Result<QuotaEstimate> {
        let cache = Arc::clone(&self.cache);
        tokio::task::spawn_blocking(move || {
            let mut cache = cache
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            estimate_from_codex_home(&codex_home, current_reset_at, now, &mut cache)
        })
        .await
        .context("额度估算后台任务异常结束")?
    }
}

fn resolve_codex_home() -> Result<PathBuf> {
    if let Some(path) = non_empty_env("CODEX_HOME") {
        return Ok(PathBuf::from(path));
    }

    #[cfg(windows)]
    {
        if let Some(profile) = non_empty_env("USERPROFILE") {
            return Ok(PathBuf::from(profile).join(".codex"));
        }
        if let (Some(drive), Some(home_path)) =
            (non_empty_env("HOMEDRIVE"), non_empty_env("HOMEPATH"))
        {
            return Ok(PathBuf::from(format!("{drive}{home_path}")).join(".codex"));
        }
    }

    #[cfg(not(windows))]
    if let Some(home) = non_empty_env("HOME") {
        return Ok(PathBuf::from(home).join(".codex"));
    }

    Err(anyhow!("无法解析 Codex 数据目录。"))
}

fn non_empty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn estimate_from_codex_home(
    codex_home: &Path,
    current_reset_at: i64,
    now: i64,
    cache: &mut EstimateCache,
) -> Result<QuotaEstimate> {
    let cutoff = now.saturating_sub(LOOKBACK_SECONDS);
    let collected = cache.collect_events(codex_home, cutoff, now)?;
    let _stats = collected.stats;
    Ok(estimate_from_events(collected.events, current_reset_at))
}

fn parse_usage_event(record: &Value, model: Option<&str>) -> Option<UsageEvent> {
    let timestamp = record
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())?
        .timestamp();
    let rate_limits = record.pointer("/payload/rate_limits")?;
    let weekly = [rate_limits.get("primary"), rate_limits.get("secondary")]
        .into_iter()
        .flatten()
        .find(|window| {
            read_i64(window, &["window_minutes", "windowMinutes"]) == Some(WEEKLY_WINDOW_MINS)
        })?;
    let used_percent = read_f64(weekly, &["used_percent", "usedPercent"])?;
    let reset_at = read_i64(weekly, &["resets_at", "resetsAt"])?;
    let reset_distance = reset_at.saturating_sub(timestamp);
    if !used_percent.is_finite()
        || !(0..=MAX_RESET_DISTANCE_SECONDS).contains(&reset_distance)
        || reset_distance == 0
    {
        return None;
    }

    let usage = record
        .pointer("/payload/info/last_token_usage")
        .and_then(read_token_usage);
    let cost_usd = usage.and_then(|usage| price_token_usage(model?, usage));
    Some(UsageEvent {
        timestamp,
        reset_at,
        used_percent: used_percent.clamp(0.0, 100.0),
        cost_usd,
    })
}

fn read_token_usage(value: &Value) -> Option<TokenUsage> {
    if !value.is_object() {
        return None;
    }
    let input = read_u64(value, &["input_tokens", "inputTokens"]);
    let cached_input = read_u64(value, &["cached_input_tokens", "cachedInputTokens"]);
    let cache_write_input = read_u64(
        value,
        &["cache_write_input_tokens", "cacheWriteInputTokens"],
    );
    let output = read_u64(value, &["output_tokens", "outputTokens"]);
    let reasoning_output = read_u64(value, &["reasoning_output_tokens", "reasoningOutputTokens"]);
    let total = read_u64(value, &["total_tokens", "totalTokens"]);
    if [
        input,
        cached_input,
        cache_write_input,
        output,
        reasoning_output,
        total,
    ]
    .iter()
    .all(Option::is_none)
    {
        return None;
    }

    Some(TokenUsage {
        input: input.unwrap_or(0),
        cached_input: cached_input.unwrap_or(0),
        cache_write_input: cache_write_input.unwrap_or(0),
        output: output.unwrap_or(0),
        reasoning_output: reasoning_output.unwrap_or(0),
        total: total.unwrap_or(0),
    })
}

fn read_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| match value.get(key) {
        Some(Value::Number(number)) => number.as_u64(),
        Some(Value::String(text)) => text.parse().ok(),
        _ => None,
    })
}

fn read_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| match value.get(key) {
        Some(Value::Number(number)) => number.as_i64(),
        Some(Value::String(text)) => text.parse().ok(),
        _ => None,
    })
}

fn read_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| match value.get(key) {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.parse().ok(),
        _ => None,
    })
}

fn price_token_usage(model: &str, usage: TokenUsage) -> Option<f64> {
    let price = model_price(model)?;
    if usage.cache_write_input > 0 && price.cache_write_multiplier.is_none() {
        return None;
    }

    let accounted_input = usage.cached_input.saturating_add(usage.cache_write_input);
    let uncached_input = usage.input.saturating_sub(accounted_input);
    let input_multiplier = if usage.input > LONG_CONTEXT_INPUT_TOKENS {
        2.0
    } else {
        1.0
    };
    let output_multiplier = if usage.input > LONG_CONTEXT_INPUT_TOKENS {
        1.5
    } else {
        1.0
    };
    let cache_write_price = price.input * price.cache_write_multiplier.unwrap_or(0.0);
    let input_cost = (uncached_input as f64 * price.input
        + usage.cached_input as f64 * price.cached_input
        + usage.cache_write_input as f64 * cache_write_price)
        * input_multiplier;
    let output_cost = usage.output as f64 * price.output * output_multiplier;
    let cost = (input_cost + output_cost) / 1_000_000.0;
    cost.is_finite().then_some(cost)
}

fn model_price(model: &str) -> Option<ModelPrice> {
    let gpt_56 = |input, cached_input, output| ModelPrice {
        input,
        cached_input,
        output,
        cache_write_multiplier: Some(1.25),
    };
    let gpt_54 = || ModelPrice {
        input: 2.5,
        cached_input: 0.25,
        output: 15.0,
        // GPT-5.4 没有独立缓存写入费率，写入仍按未命中的普通输入估算。
        cache_write_multiplier: Some(1.0),
    };

    match model {
        "gpt-6-astra" => Some(ModelPrice {
            input: 10.0,
            cached_input: 1.0,
            output: 50.0,
            cache_write_multiplier: Some(1.25),
        }),
        "gpt-5.6" | "gpt-5.6-sol" => Some(gpt_56(4.0, 0.4, 20.0)),
        "gpt-5.6-terra" => Some(gpt_56(2.0, 0.2, 12.0)),
        "gpt-5.6-luna" => Some(gpt_56(0.2, 0.02, 1.2)),
        "gpt-5.4" | "gpt-5.4-2026-03-05" | "codex-auto-review" => Some(gpt_54()),
        "gpt-5.5" | "gpt-5.5-2026-04-23" => Some(ModelPrice {
            input: 5.0,
            cached_input: 0.5,
            output: 30.0,
            cache_write_multiplier: None,
        }),
        _ if model.starts_with("gpt-5.6-sol-") => Some(gpt_56(4.0, 0.4, 20.0)),
        _ if model.starts_with("gpt-5.6-terra-") => Some(gpt_56(2.0, 0.2, 12.0)),
        _ if model.starts_with("gpt-5.6-luna-") => Some(gpt_56(0.2, 0.02, 1.2)),
        _ => None,
    }
}

fn estimate_from_events(events: Vec<UsageEvent>, current_reset_at: i64) -> QuotaEstimate {
    let clusters = cluster_events(events);
    let current_index = clusters
        .iter()
        .enumerate()
        .filter_map(|(index, cluster)| {
            let distance = cluster.representative_reset_at().abs_diff(current_reset_at);
            (distance <= CURRENT_RESET_MATCH_SECONDS as u64).then_some((index, distance))
        })
        .min_by_key(|(_, distance)| *distance)
        .map(|(index, _)| index);

    let Some(current_index) = current_index else {
        return QuotaEstimate {
            price_table_as_of: PRICE_TABLE_AS_OF.to_string(),
            previous: None,
            current: None,
        };
    };

    let current = &clusters[current_index];
    let current_first_event = current.first_event_at();
    let current_reset = current.representative_reset_at();
    let previous = clusters
        .iter()
        .enumerate()
        .filter(|(index, cluster)| {
            *index != current_index
                && cluster.representative_reset_at() < current_reset.saturating_sub(60 * 60)
                && cluster.last_event_at() < current_first_event
        })
        .max_by_key(|(_, cluster)| cluster.last_event_at())
        .map(|(_, cluster)| analyze_cluster(cluster, cluster.representative_reset_at()));

    QuotaEstimate {
        price_table_as_of: PRICE_TABLE_AS_OF.to_string(),
        previous,
        current: Some(analyze_cluster(current, current_reset_at)),
    }
}

fn cluster_events(mut events: Vec<UsageEvent>) -> Vec<CycleCluster> {
    events.sort_by_key(|event| event.reset_at);
    let mut clusters: Vec<CycleCluster> = Vec::new();
    for event in events {
        if let Some(cluster) = clusters.last_mut() {
            if event.reset_at.saturating_sub(cluster.min_reset_at) <= RESET_CLUSTER_SECONDS {
                cluster.events.push(event);
                continue;
            }
        }
        clusters.push(CycleCluster {
            min_reset_at: event.reset_at,
            events: vec![event],
        });
    }
    clusters
}

impl CycleCluster {
    fn representative_reset_at(&self) -> i64 {
        let mut resets = self
            .events
            .iter()
            .map(|event| event.reset_at)
            .collect::<Vec<_>>();
        resets.sort_unstable();
        resets[resets.len() / 2]
    }

    fn first_event_at(&self) -> i64 {
        self.events
            .iter()
            .map(|event| event.timestamp)
            .min()
            .unwrap_or_default()
    }

    fn last_event_at(&self) -> i64 {
        self.events
            .iter()
            .map(|event| event.timestamp)
            .max()
            .unwrap_or_default()
    }
}

fn analyze_cluster(cluster: &CycleCluster, cycle_ends_at: i64) -> CycleQuotaEstimate {
    let mut events = cluster.events.iter().collect::<Vec<_>>();
    events.sort_by_key(|event| event.timestamp);

    let mut candidates = Vec::new();
    let mut last_percent = None;
    let mut last_timestamp = None;
    let mut interval_cost = 0.0;
    let mut priced_event_count = 0_usize;
    let mut unpriced_event_count = 0_u32;
    let mut suspected_remote_interval_count = 0_u32;
    let mut initial_interval_excluded = false;

    for event in events {
        let Some(cost) = event
            .cost_usd
            .filter(|value| value.is_finite() && *value >= 0.0)
        else {
            unpriced_event_count = unpriced_event_count.saturating_add(1);
            last_percent = None;
            last_timestamp = None;
            interval_cost = 0.0;
            continue;
        };
        priced_event_count += 1;

        let Some(previous_percent) = last_percent else {
            last_percent = Some(event.used_percent);
            last_timestamp = Some(event.timestamp);
            continue;
        };

        if event.used_percent + f64::EPSILON < previous_percent {
            last_percent = Some(event.used_percent);
            last_timestamp = Some(event.timestamp);
            interval_cost = 0.0;
            continue;
        }

        interval_cost += cost;
        if event.used_percent > previous_percent + f64::EPSILON {
            let delta_percent = event.used_percent - previous_percent;
            let candidate = estimate_candidate(
                interval_cost,
                delta_percent,
                (previous_percent, event.used_percent),
            );
            let activity_gap = last_timestamp.is_some_and(|timestamp| {
                event.timestamp.saturating_sub(timestamp) >= ACTIVITY_GAP_SECONDS
            });

            if candidate.is_none() {
                unpriced_event_count = unpriced_event_count.saturating_add(1);
            } else if !initial_interval_excluded {
                // 周期首个区间缺少完整费用基线，统一按未计价处理，且优先于跨设备推断。
                initial_interval_excluded = true;
                unpriced_event_count = unpriced_event_count.saturating_add(1);
            } else if activity_gap {
                // 仅依据本机活动空档推断跨设备使用；候选金额高低不参与判断。
                suspected_remote_interval_count = suspected_remote_interval_count.saturating_add(1);
            } else if let Some(candidate) = candidate {
                candidates.push(candidate);
            }
            last_percent = Some(event.used_percent);
            interval_cost = 0.0;
        }
        last_timestamp = Some(event.timestamp);
    }

    candidates.sort_by(|left, right| left.full_quota_usd.total_cmp(&right.full_quota_usd));
    let covered_percent_intervals = candidates
        .iter()
        .map(|candidate| candidate.percent_interval)
        .collect::<Vec<_>>();
    let percent_span = unique_percent_span(&covered_percent_intervals);
    let full_quota_usd = weighted_median_estimate(&candidates);
    let ready = candidates.len() >= MIN_SAMPLE_COUNT
        && percent_span >= MIN_PERCENT_SPAN
        && full_quota_usd.is_some();
    let status = if ready {
        EstimateStatus::Ready
    } else if priced_event_count == 0 {
        EstimateStatus::Unavailable
    } else {
        EstimateStatus::Collecting
    };

    CycleQuotaEstimate {
        cycle_ends_at: Utc
            .timestamp_opt(cycle_ends_at, 0)
            .single()
            .map(|value| value.to_rfc3339_opts(SecondsFormat::Millis, true))
            .unwrap_or_default(),
        status,
        full_quota_usd: ready.then_some(full_quota_usd).flatten(),
        sample_count: u32::try_from(candidates.len()).unwrap_or(u32::MAX),
        percent_span: percent_span.round().clamp(0.0, 100.0) as u8,
        unpriced_event_count,
        suspected_remote_interval_count,
    }
}

fn estimate_candidate(
    interval_cost: f64,
    delta_percent: f64,
    percent_interval: (f64, f64),
) -> Option<EstimateCandidate> {
    if !interval_cost.is_finite()
        || interval_cost <= 0.0
        || !delta_percent.is_finite()
        || delta_percent <= 0.0
    {
        return None;
    }
    let full_quota_usd = 100.0 * interval_cost / delta_percent;
    (full_quota_usd.is_finite() && full_quota_usd > 0.0).then_some(EstimateCandidate {
        full_quota_usd,
        delta_percent,
        percent_interval,
    })
}

fn weighted_median_estimate(candidates: &[EstimateCandidate]) -> Option<f64> {
    let total_weight = candidates
        .iter()
        .map(|candidate| candidate.delta_percent)
        .sum::<f64>();
    if !total_weight.is_finite() || total_weight <= 0.0 {
        return None;
    }

    let midpoint = total_weight / 2.0;
    let mut cumulative_weight = 0.0;
    for candidate in candidates {
        cumulative_weight += candidate.delta_percent;
        if cumulative_weight + f64::EPSILON >= midpoint {
            return Some(candidate.full_quota_usd);
        }
    }
    candidates.last().map(|candidate| candidate.full_quota_usd)
}

fn unique_percent_span(intervals: &[(f64, f64)]) -> f64 {
    let mut normalized = intervals
        .iter()
        .filter_map(|&(start, end)| {
            if !start.is_finite() || !end.is_finite() {
                return None;
            }
            let start = start.clamp(0.0, 100.0);
            let end = end.clamp(0.0, 100.0);
            (end > start).then_some((start, end))
        })
        .collect::<Vec<_>>();
    normalized.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.total_cmp(&right.1))
    });

    let Some((mut current_start, mut current_end)) = normalized.first().copied() else {
        return 0.0;
    };
    let mut total = 0.0;
    for &(start, end) in normalized.iter().skip(1) {
        if start <= current_end + f64::EPSILON {
            current_end = current_end.max(end);
            continue;
        }
        // 合并区间后再求长度，避免百分比回退后重复累计已覆盖范围。
        total += current_end - current_start;
        current_start = start;
        current_end = end;
    }
    (total + current_end - current_start).clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs::{self, File};
    use std::io::Write;

    fn usage(input: u64, cached: u64, cache_write: u64, output: u64) -> TokenUsage {
        TokenUsage {
            input,
            cached_input: cached,
            cache_write_input: cache_write,
            output,
            reasoning_output: output / 2,
            total: input + output,
        }
    }

    fn estimate_from_home(
        codex_home: &Path,
        current_reset_at: i64,
        now: i64,
    ) -> Result<QuotaEstimate> {
        estimate_from_codex_home(
            codex_home,
            current_reset_at,
            now,
            &mut EstimateCache::default(),
        )
    }

    #[test]
    fn 标准计价不会重复计算缓存和推理输出() {
        let cost =
            price_token_usage("gpt-5.6-sol", usage(200_000, 80_000, 20_000, 20_000)).unwrap();

        assert!((cost - 0.932).abs() < 0.000_001);
    }

    #[test]
    fn gpt_6_astra混合计价不会重复计算缓存和推理输出() {
        let cost =
            price_token_usage("gpt-6-astra", usage(200_000, 80_000, 20_000, 20_000)).unwrap();

        assert!((cost - 2.33).abs() < 0.000_001);
    }

    #[test]
    fn gpt_6_astra长上下文对输入缓存和输出应用倍率() {
        let cost =
            price_token_usage("gpt-6-astra", usage(300_000, 80_000, 20_000, 10_000)).unwrap();

        assert!((cost - 5.41).abs() < 0.000_001);
    }

    #[test]
    fn gpt_6_astra仅在超过长上下文阈值时应用倍率() {
        for (input, expected) in [(272_000, 3.22), (272_001, 6.190_02)] {
            let cost = price_token_usage("gpt-6-astra", usage(input, 0, 0, 10_000)).unwrap();

            assert!((cost - expected).abs() < 0.000_001, "input={input}");
        }
    }

    #[test]
    fn gpt_6_astra仅识别正式模型名() {
        assert!(model_price("gpt-6-astra").is_some());
        for model in [
            "gpt6",
            "gpt-6",
            "gpt-6-astra-pro",
            "gpt-6-astra-fast",
            "gpt-6-astra-2026-09-05",
        ] {
            assert_eq!(price_token_usage(model, usage(1000, 0, 0, 100)), None);
        }
    }

    #[test]
    fn 长上下文应用输入和输出倍率() {
        let cost = price_token_usage("gpt-5.5", usage(300_000, 0, 0, 10_000)).unwrap();

        assert!((cost - 3.45).abs() < 0.000_001);
    }

    #[test]
    fn 未知模型和未公开缓存写入价格不猜价() {
        assert_eq!(price_token_usage("unknown", usage(10, 0, 0, 0)), None);
        assert_eq!(price_token_usage("gpt-5.5", usage(10, 0, 1, 0)), None);
    }

    #[test]
    fn codex_auto_review按_gpt_5_4_计价() {
        let token_usage = usage(200_000, 80_000, 20_000, 20_000);
        let gpt_54_cost = price_token_usage("gpt-5.4", token_usage).unwrap();
        let auto_review_cost = price_token_usage("codex-auto-review", token_usage).unwrap();

        assert!((gpt_54_cost - 0.62).abs() < 0.000_001);
        assert!((auto_review_cost - gpt_54_cost).abs() < 0.000_001);
    }

    #[test]
    fn gpt_5_4_缓存写入按普通输入价并应用长上下文倍率() {
        let cost = price_token_usage("gpt-5.4-2026-03-05", usage(300_000, 80_000, 20_000, 10_000))
            .unwrap();

        assert!((cost - 1.365).abs() < 0.000_001);
    }

    #[test]
    fn 支持已知模型别名和快照() {
        assert!(model_price("gpt-5.6").is_some());
        assert!(model_price("gpt-5.6-sol-2026-08-24").is_some());
        assert!(model_price("gpt-5.5-2026-04-23").is_some());
        assert!(model_price("gpt-5.4").is_some());
        assert!(model_price("gpt-5.4-2026-03-05").is_some());
        assert!(model_price("codex-auto-review").is_some());
        assert!(model_price("gpt-5.5-pro").is_none());
    }

    #[test]
    fn 活动和归档日志共同生成上下周期估值() {
        let codex_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let current_reset = now + 3 * 24 * 60 * 60;
        let previous_reset = current_reset - 7 * 24 * 60 * 60;
        write_rollout_file(
            codex_home.path(),
            "sessions",
            "rollout-current.jsonl",
            now - 300,
            current_reset,
        );
        write_rollout_file(
            codex_home.path(),
            "archived_sessions",
            "rollout-previous.jsonl",
            previous_reset - 300,
            previous_reset,
        );

        let estimate = estimate_from_home(codex_home.path(), current_reset, now).unwrap();
        let previous = estimate.previous.unwrap();
        let current = estimate.current.unwrap();

        assert_eq!(previous.status, EstimateStatus::Ready);
        assert_eq!(current.status, EstimateStatus::Ready);
        assert!((previous.full_quota_usd.unwrap() - 40.0).abs() < 0.000_001);
        assert!((current.full_quota_usd.unwrap() - 40.0).abs() < 0.000_001);
    }

    #[test]
    fn 任一会话目录存在时都能独立估算() {
        for directory in ["sessions", "archived_sessions"] {
            let codex_home = tempfile::tempdir().unwrap();
            let now = Utc::now().timestamp();
            let current_reset = now + 3 * 24 * 60 * 60;
            write_rollout_file(
                codex_home.path(),
                directory,
                "rollout-current.jsonl",
                now - 300,
                current_reset,
            );

            let estimate = estimate_from_home(codex_home.path(), current_reset, now).unwrap();

            assert_eq!(estimate.current.unwrap().status, EstimateStatus::Ready);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn 并发估算共享缓存且结果一致() {
        let codex_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let current_reset = now + 3 * 24 * 60 * 60;
        write_rollout_file(
            codex_home.path(),
            "sessions",
            "rollout-concurrent.jsonl",
            now - 300,
            current_reset,
        );
        let estimator = QuotaEstimator::new();
        let first_home = codex_home.path().to_path_buf();
        let second_home = first_home.clone();

        let (first, second) = tokio::join!(
            estimator.estimate_from_codex_home(first_home, current_reset, now),
            estimator.estimate_from_codex_home(second_home, current_reset, now)
        );

        assert_eq!(first.unwrap(), second.unwrap());
    }

    #[test]
    fn 活动和归档目录都不存在时返回错误() {
        let codex_home = tempfile::tempdir().unwrap();
        let error = estimate_from_home(codex_home.path(), 10_000, 1_000)
            .unwrap_err()
            .to_string();

        assert!(error.contains("活动及归档会话目录均不存在"));
    }

    #[test]
    fn 同时兼容两个周窗口字段() {
        let base = json!({
            "timestamp": "2026-08-24T00:00:00Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": { "last_token_usage": { "input_tokens": 1000 } },
                "rate_limits": {
                    "secondary": {
                        "used_percent": 5,
                        "window_minutes": 10080,
                        "resets_at": 1788134400_i64
                    }
                }
            }
        });

        let event = parse_usage_event(&base, Some("gpt-5.6-sol")).unwrap();
        assert_eq!(event.used_percent, 5.0);
    }

    #[test]
    fn 过期和超出八天的重置记录会跳过() {
        let record = json!({
            "timestamp": "2026-08-24T00:00:00Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "rate_limits": {
                    "primary": {
                        "used_percent": 5,
                        "window_minutes": 10080,
                        "resets_at": 1786924800_i64
                    }
                }
            }
        });

        assert!(parse_usage_event(&record, Some("gpt-5.6-sol")).is_none());
    }

    #[test]
    fn 重置时间漂移会归入同一周期() {
        let events = vec![
            test_event(100, 1_000, 0.0, Some(1.0)),
            test_event(200, 1_500, 1.0, Some(1.0)),
            test_event(300, 3_000, 2.0, Some(1.0)),
        ];

        let clusters = cluster_events(events);
        assert_eq!(clusters.len(), 2);
        assert_eq!(clusters[0].events.len(), 2);
    }

    #[test]
    fn 稳定样本排除周期首段后恢复满额估值() {
        let reset_at = 10_000;
        let mut events = Vec::new();
        for percent in 0..=12 {
            events.push(test_event(
                1_000 + i64::from(percent),
                reset_at,
                f64::from(percent),
                Some(if percent == 0 { 0.0 } else { 1.0 }),
            ));
        }

        let result = estimate_from_events(events, reset_at);
        assert_eq!(result.price_table_as_of, "2026-09-05");
        let current = result.current.unwrap();
        assert_eq!(current.status, EstimateStatus::Ready);
        assert!((current.full_quota_usd.unwrap() - 100.0).abs() < 0.000_001);
        assert_eq!(current.sample_count, 11);
        assert_eq!(current.percent_span, 11);
        assert_eq!(current.unpriced_event_count, 1);
        assert_eq!(current.suspected_remote_interval_count, 0);
    }

    #[test]
    fn 周期首个有效候选优先于空闲跨设备判断() {
        let reset_at = 10_000;
        let events = vec![
            test_event(1_000, reset_at, 0.0, Some(0.0)),
            test_event(1_900, reset_at, 1.0, Some(1.0)),
            test_event(1_901, reset_at, 2.0, Some(1.0)),
            test_event(1_902, reset_at, 3.0, Some(1.0)),
            test_event(1_903, reset_at, 4.0, Some(1.0)),
        ];

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.status, EstimateStatus::Ready);
        assert!((current.full_quota_usd.unwrap() - 100.0).abs() < 0.000_001);
        assert_eq!(current.sample_count, 3);
        assert_eq!(current.percent_span, 3);
        assert_eq!(current.unpriced_event_count, 1);
        assert_eq!(current.suspected_remote_interval_count, 0);
    }

    #[test]
    fn 首段后的十五分钟空闲边界会被隔离() {
        let reset_at = 10_000;
        let events = vec![
            test_event(1_000, reset_at, 0.0, Some(0.0)),
            test_event(1_001, reset_at, 1.0, Some(1.0)),
            test_event(1_002, reset_at, 2.0, Some(1.0)),
            test_event(1_902, reset_at, 22.0, Some(1.0)),
            test_event(1_903, reset_at, 23.0, Some(1.0)),
            test_event(1_904, reset_at, 24.0, Some(1.0)),
        ];

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.status, EstimateStatus::Ready);
        assert!((current.full_quota_usd.unwrap() - 100.0).abs() < 0.000_001);
        assert_eq!(current.sample_count, 3);
        assert_eq!(current.percent_span, 3);
        assert_eq!(current.unpriced_event_count, 1);
        assert_eq!(current.suspected_remote_interval_count, 1);
    }

    #[test]
    fn 高低成本短时突发和模型切换全部进入估值() {
        let reset_at = 10_000;
        let sol_cost = price_token_usage("gpt-5.6-sol", usage(100_000, 0, 0, 0)).unwrap();
        let luna_cost = price_token_usage("gpt-5.6-luna", usage(100_000, 0, 0, 0)).unwrap();
        let costs = [0.0, sol_cost, sol_cost, luna_cost, 5.0, 0.01, luna_cost];
        let events = costs
            .into_iter()
            .enumerate()
            .map(|(index, cost)| {
                test_event(
                    1_000 + i64::try_from(index).unwrap(),
                    reset_at,
                    index as f64,
                    Some(cost),
                )
            })
            .collect();

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.status, EstimateStatus::Ready);
        assert_eq!(current.sample_count, 5);
        assert_eq!(current.percent_span, 5);
        assert_eq!(current.unpriced_event_count, 1);
        assert_eq!(current.suspected_remote_interval_count, 0);
    }

    #[test]
    fn 无效候选计入未计价且不占用首个有效候选() {
        let reset_at = 10_000;
        let events = vec![
            test_event(1_000, reset_at, 0.0, Some(0.0)),
            test_event(1_900, reset_at, 1.0, Some(0.0)),
            test_event(1_901, reset_at, 2.0, Some(1.0)),
            test_event(1_902, reset_at, 3.0, Some(1.0)),
            test_event(1_903, reset_at, 4.0, Some(1.0)),
            test_event(1_904, reset_at, 5.0, Some(1.0)),
        ];

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.status, EstimateStatus::Ready);
        assert_eq!(current.sample_count, 3);
        assert_eq!(current.percent_span, 3);
        assert_eq!(current.unpriced_event_count, 2);
        assert_eq!(current.suspected_remote_interval_count, 0);
    }

    #[test]
    fn 固定本周样本取消成本离群后得到预期估值() {
        let reset_at = 10_000;
        let full_quota_values = [
            44.602, 166.919, 161.708, 138.49, 79.2, 90.501, 95.0, 96.0, 97.1092, 98.56, 100.0,
        ];
        let mut events = vec![test_event(1_000, reset_at, 0.0, Some(0.0))];
        events.extend(
            full_quota_values
                .into_iter()
                .enumerate()
                .map(|(index, full_quota_usd)| {
                    test_event(
                        1_001 + i64::try_from(index).unwrap(),
                        reset_at,
                        (index + 1) as f64,
                        Some(full_quota_usd / 100.0),
                    )
                }),
        );

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.status, EstimateStatus::Ready);
        assert!((current.full_quota_usd.unwrap() - 97.1092).abs() < 0.000_001);
        assert_eq!(current.sample_count, 10);
        assert_eq!(current.percent_span, 10);
        assert_eq!(current.unpriced_event_count, 1);
        assert_eq!(current.suspected_remote_interval_count, 0);
    }

    #[test]
    fn 非线性样本满足基础门槛即可展示估值() {
        let reset_at = 10_000;
        let percentages = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 15.0];
        let events = percentages
            .into_iter()
            .enumerate()
            .map(|(index, percent)| {
                test_event(
                    1_000 + i64::try_from(index).unwrap(),
                    reset_at,
                    percent,
                    Some(1.0),
                )
            })
            .collect();

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.status, EstimateStatus::Ready);
        assert!(current.full_quota_usd.is_some());
    }

    #[test]
    fn 样本和跨度恰好达到门槛时展示估值() {
        let reset_at = 10_000;
        let events = [(0.0, 0.0), (0.5, 0.5), (1.0, 0.5), (1.5, 0.5), (2.5, 1.0)]
            .into_iter()
            .enumerate()
            .map(|(index, (percent, cost))| {
                test_event(
                    1_000 + i64::try_from(index).unwrap(),
                    reset_at,
                    percent,
                    Some(cost),
                )
            })
            .collect();

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.sample_count, 3);
        assert_eq!(current.percent_span, 2);
        assert_eq!(current.status, EstimateStatus::Ready);
        assert!(current.full_quota_usd.is_some());
    }

    #[test]
    fn 唯一跨度不足时不返回金额() {
        let reset_at = 10_000;
        let events = [0.0, 0.3, 0.6, 1.0]
            .into_iter()
            .enumerate()
            .map(|(index, percent)| {
                test_event(
                    1_000 + i64::try_from(index).unwrap(),
                    reset_at,
                    percent,
                    Some(if index == 0 { 0.0 } else { 1.0 }),
                )
            })
            .collect();

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.sample_count, 2);
        assert_eq!(current.percent_span, 1);
        assert_eq!(current.unpriced_event_count, 1);
        assert_eq!(current.status, EstimateStatus::Collecting);
        assert_eq!(current.full_quota_usd, None);
    }

    #[test]
    fn 样本不足时不返回金额() {
        let reset_at = 10_000;
        let events = (0..=2)
            .map(|percent| {
                test_event(
                    1_000 + i64::from(percent),
                    reset_at,
                    f64::from(percent),
                    Some(1.0),
                )
            })
            .collect();

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.sample_count, 1);
        assert_eq!(current.percent_span, 1);
        assert_eq!(current.unpriced_event_count, 1);
        assert_eq!(current.status, EstimateStatus::Collecting);
        assert_eq!(current.full_quota_usd, None);
    }

    #[test]
    fn 未计价事件会切断估算样本段() {
        let reset_at = 10_000;
        let mut events = (0..6)
            .map(|percent| {
                test_event(
                    1_000 + i64::from(percent),
                    reset_at,
                    f64::from(percent),
                    Some(1.0),
                )
            })
            .collect::<Vec<_>>();
        events.push(test_event(1_006, reset_at, 6.0, None));
        events.extend((7..=12).map(|percent| {
            test_event(
                1_000 + i64::from(percent),
                reset_at,
                f64::from(percent),
                Some(1.0),
            )
        }));

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.unpriced_event_count, 2);
        assert_eq!(current.sample_count, 9);
        assert_eq!(current.percent_span, 9);
    }

    #[test]
    fn 重叠样本段只计算唯一覆盖跨度() {
        let reset_at = 10_000;
        let events = vec![
            test_event(1_000, reset_at, 0.0, Some(0.0)),
            test_event(1_001, reset_at, 55.0, Some(55.0)),
            test_event(1_002, reset_at, 33.0, Some(0.0)),
            test_event(1_003, reset_at, 60.0, Some(27.0)),
        ];

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.sample_count, 1);
        assert_eq!(current.percent_span, 27);
        assert_eq!(current.unpriced_event_count, 1);
    }

    #[test]
    fn 分离样本段不会填补未观察区间() {
        let reset_at = 10_000;
        let events = vec![
            test_event(1_000, reset_at, 10.0, Some(0.0)),
            test_event(1_001, reset_at, 20.0, Some(10.0)),
            test_event(1_002, reset_at, 25.0, None),
            test_event(1_003, reset_at, 30.0, Some(0.0)),
            test_event(1_004, reset_at, 35.0, Some(5.0)),
        ];

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.percent_span, 5);
        assert_eq!(current.unpriced_event_count, 2);
    }

    #[test]
    fn 估算序列化不包含_r_平方字段() {
        let current = estimate_from_events(vec![test_event(1_000, 10_000, 1.0, Some(0.0))], 10_000)
            .current
            .unwrap();
        let serialized = serde_json::to_value(current).unwrap();

        assert!(serialized.get("rSquared").is_none());
        assert_eq!(
            serialized.get("suspectedRemoteIntervalCount"),
            Some(&json!(0))
        );
    }

    #[test]
    fn gpt_6_astra含缓存写入的日志用量可生成周额度估值() {
        let reset_at = 10_000;
        let events = (0..=4)
            .map(|percent| {
                let timestamp = Utc
                    .timestamp_opt(1_000 + i64::from(percent), 0)
                    .single()
                    .unwrap()
                    .to_rfc3339_opts(SecondsFormat::Secs, true);
                let record = json!({
                    "timestamp": timestamp,
                    "type": "event_msg",
                    "payload": {
                        "type": "token_count",
                        "info": {
                            "last_token_usage": {
                                "input_tokens": 200_000,
                                "cached_input_tokens": 80_000,
                                "cache_write_input_tokens": 20_000,
                                "output_tokens": 20_000,
                                "reasoning_output_tokens": 10_000,
                                "total_tokens": 220_000
                            }
                        },
                        "rate_limits": {
                            "secondary": {
                                "used_percent": percent,
                                "window_minutes": WEEKLY_WINDOW_MINS,
                                "resets_at": reset_at
                            }
                        }
                    }
                });
                parse_usage_event(&record, Some("gpt-6-astra")).unwrap()
            })
            .collect();

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.status, EstimateStatus::Ready);
        assert_eq!(current.sample_count, 3);
        assert_eq!(current.percent_span, 3);
        // 仅保留原有周期首段排除，缓存写入事件均正常计价。
        assert_eq!(current.unpriced_event_count, 1);
        assert!((current.full_quota_usd.unwrap() - 233.0).abs() < 0.000_001);
    }

    #[test]
    fn codex_auto_review缓存写入不会切断估算样本段() {
        let reset_at = 10_000;
        let event_cost =
            price_token_usage("codex-auto-review", usage(1_000, 200, 100, 100)).unwrap();
        let events = (0..=12)
            .map(|percent| {
                test_event(
                    1_000 + i64::from(percent),
                    reset_at,
                    f64::from(percent),
                    Some(if percent == 0 { 0.0 } else { event_cost }),
                )
            })
            .collect();

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.unpriced_event_count, 1);
        assert_eq!(current.sample_count, 11);
        assert_eq!(current.status, EstimateStatus::Ready);
    }

    #[test]
    fn 会选择当前和紧邻上个周期() {
        let previous_reset = 20_000;
        let current_reset = 30_000;
        let mut events = Vec::new();
        for percent in 0..=10 {
            events.push(test_event(
                1_000 + i64::from(percent),
                previous_reset,
                f64::from(percent),
                Some(1.0),
            ));
            events.push(test_event(
                21_000 + i64::from(percent),
                current_reset,
                f64::from(percent),
                Some(1.0),
            ));
        }

        let result = estimate_from_events(events, current_reset + 60);
        assert!(result.previous.is_some());
        assert!(result.current.is_some());
        assert!(result.current.unwrap().cycle_ends_at.contains("1970-01-01"));
    }

    fn write_rollout_file(
        codex_home: &Path,
        directory: &str,
        file_name: &str,
        start_at: i64,
        reset_at: i64,
    ) -> PathBuf {
        let directory = codex_home.join(directory);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(file_name);
        let mut file = File::create(&path).unwrap();
        let start_timestamp = Utc
            .timestamp_opt(start_at, 0)
            .single()
            .unwrap()
            .to_rfc3339_opts(SecondsFormat::Secs, true);
        writeln!(
            file,
            "{}",
            json!({
                "timestamp": start_timestamp,
                "type": "turn_context",
                "payload": { "model": "gpt-5.6-sol" }
            })
        )
        .unwrap();

        for (index, used_percent) in [0.0, 1.0, 2.0, 3.0, 4.0].into_iter().enumerate() {
            let timestamp = Utc
                .timestamp_opt(start_at + i64::try_from(index).unwrap(), 0)
                .single()
                .unwrap()
                .to_rfc3339_opts(SecondsFormat::Secs, true);
            let last_input_tokens = if index == 0 { 0 } else { 100_000 };
            let total_input_tokens = u64::try_from(index).unwrap() * 100_000;
            writeln!(
                file,
                "{}",
                json!({
                    "timestamp": timestamp,
                    "type": "event_msg",
                    "payload": {
                        "type": "token_count",
                        "info": {
                            "last_token_usage": {
                                "input_tokens": last_input_tokens,
                                "output_tokens": 0,
                                "total_tokens": last_input_tokens
                            },
                            "total_token_usage": {
                                "input_tokens": total_input_tokens,
                                "output_tokens": 0,
                                "total_tokens": total_input_tokens
                            }
                        },
                        "rate_limits": {
                            "primary": {
                                "used_percent": used_percent,
                                "window_minutes": WEEKLY_WINDOW_MINS,
                                "resets_at": reset_at
                            }
                        }
                    }
                })
            )
            .unwrap();
        }

        path
    }

    fn test_event(
        timestamp: i64,
        reset_at: i64,
        used_percent: f64,
        cost_usd: Option<f64>,
    ) -> UsageEvent {
        UsageEvent {
            timestamp,
            reset_at,
            used_percent,
            cost_usd,
        }
    }
}
