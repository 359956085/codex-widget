use std::collections::HashSet;
use std::env;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde_json::Value;

use super::types::{CycleQuotaEstimate, EstimateStatus, QuotaEstimate};

const PRICE_TABLE_AS_OF: &str = "2026-08-25";
const WEEKLY_WINDOW_MINS: i64 = 10_080;
const LOOKBACK_SECONDS: i64 = 16 * 24 * 60 * 60;
const MAX_RESET_DISTANCE_SECONDS: i64 = 8 * 24 * 60 * 60;
const RESET_CLUSTER_SECONDS: i64 = 30 * 60;
const CURRENT_RESET_MATCH_SECONDS: i64 = 2 * 60 * 60;
const MAX_FILE_COUNT: usize = 5_000;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_DIRECTORY_DEPTH: usize = 8;
const MIN_SAMPLE_COUNT: usize = 3;
const MIN_PERCENT_SPAN: f64 = 2.0;
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

#[derive(Debug, Clone)]
struct UsageEvent {
    timestamp: i64,
    reset_at: i64,
    used_percent: f64,
    cost_usd: Option<f64>,
}

#[derive(Debug)]
struct CycleCluster {
    min_reset_at: i64,
    events: Vec<UsageEvent>,
}

#[derive(Debug)]
struct FileCandidate {
    path: PathBuf,
    size: u64,
    modified: u64,
}

enum BoundedLine {
    Eof,
    Line,
    Oversized,
}

pub async fn estimate_weekly_quota(current_reset_at: &str) -> Result<QuotaEstimate> {
    let current_reset_at = DateTime::parse_from_rfc3339(current_reset_at)
        .context("周额度重置时间格式无效")?
        .timestamp();
    let sessions_dir = resolve_codex_home()?.join("sessions");

    tokio::task::spawn_blocking(move || {
        estimate_from_sessions(&sessions_dir, current_reset_at, Utc::now().timestamp())
    })
    .await
    .context("额度估算后台任务异常结束")?
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

fn estimate_from_sessions(
    sessions_dir: &Path,
    current_reset_at: i64,
    now: i64,
) -> Result<QuotaEstimate> {
    let cutoff = now.saturating_sub(LOOKBACK_SECONDS);
    let files = collect_rollout_files(sessions_dir, cutoff)?;
    let mut events = Vec::new();

    for file in files {
        read_rollout_events(&file, cutoff, now, &mut events);
    }

    Ok(estimate_from_events(events, current_reset_at))
}

fn collect_rollout_files(sessions_dir: &Path, cutoff: i64) -> Result<Vec<PathBuf>> {
    if !sessions_dir.is_dir() {
        return Err(anyhow!("Codex 会话目录不存在：{}", sessions_dir.display()));
    }

    let mut candidates = Vec::new();
    collect_directory_files(sessions_dir, 0, cutoff, &mut candidates)?;
    candidates.sort_by(|left, right| {
        right
            .modified
            .cmp(&left.modified)
            .then_with(|| left.path.cmp(&right.path))
    });

    let mut total_bytes = 0_u64;
    let mut selected = Vec::new();
    for candidate in candidates.into_iter().take(MAX_FILE_COUNT) {
        let next_total = total_bytes.saturating_add(candidate.size);
        if next_total > MAX_TOTAL_BYTES {
            continue;
        }
        total_bytes = next_total;
        selected.push(candidate.path);
    }
    Ok(selected)
}

fn collect_directory_files(
    directory: &Path,
    depth: usize,
    cutoff: i64,
    candidates: &mut Vec<FileCandidate>,
) -> Result<()> {
    if depth > MAX_DIRECTORY_DEPTH {
        return Ok(());
    }

    let entries = fs::read_dir(directory)
        .with_context(|| format!("无法读取 Codex 会话目录：{}", directory.display()))?;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            // 不跟随符号链接，避免会话目录把扫描范围引向外部路径。
            let _ = collect_directory_files(&path, depth + 1, cutoff, candidates);
            continue;
        }
        let file_name = path.file_name().and_then(|value| value.to_str());
        if !file_type.is_file()
            || path.extension().and_then(|value| value.to_str()) != Some("jsonl")
            || !file_name.is_some_and(|value| value.starts_with("rollout-"))
        {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified = system_time_seconds(metadata.modified().unwrap_or(UNIX_EPOCH));
        if modified < cutoff.max(0) as u64 {
            continue;
        }
        candidates.push(FileCandidate {
            path,
            size: metadata.len(),
            modified,
        });
    }
    Ok(())
}

fn system_time_seconds(value: SystemTime) -> u64 {
    value
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn read_rollout_events(path: &Path, cutoff: i64, now: i64, events: &mut Vec<UsageEvent>) {
    let Ok(file) = File::open(path) else {
        return;
    };
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    let mut model = None;
    let mut total_usage_fingerprints = HashSet::new();

    loop {
        match read_bounded_line(&mut reader, &mut line) {
            Ok(BoundedLine::Eof) | Err(_) => break,
            Ok(BoundedLine::Oversized) => continue,
            Ok(BoundedLine::Line) => {}
        }

        let Ok(text) = std::str::from_utf8(&line) else {
            continue;
        };
        // 先按记录类型过滤，避免把提示词和工具输出反序列化进内存。
        if !text.contains("\"turn_context\"") && !text.contains("\"token_count\"") {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(text) else {
            if text.contains("\"turn_context\"") {
                // 损坏的上下文可能正好位于模型切换点；清空关联比沿用旧模型更保守。
                model = None;
            }
            continue;
        };

        if record.get("type").and_then(Value::as_str) == Some("turn_context") {
            model = record
                .pointer("/payload/model")
                .and_then(Value::as_str)
                .map(str::to_string);
            continue;
        }
        if record.get("type").and_then(Value::as_str) != Some("event_msg")
            || record.pointer("/payload/type").and_then(Value::as_str) != Some("token_count")
        {
            continue;
        }

        let total_usage = record
            .pointer("/payload/info/total_token_usage")
            .and_then(read_token_usage);
        if total_usage.is_some_and(|usage| !total_usage_fingerprints.insert(usage)) {
            continue;
        }

        if let Some(event) = parse_usage_event(&record, model.as_deref(), cutoff, now) {
            events.push(event);
        }
    }
}

fn read_bounded_line<R: BufRead>(reader: &mut R, output: &mut Vec<u8>) -> io::Result<BoundedLine> {
    output.clear();
    let mut oversized = false;
    let mut read_any = false;

    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if !read_any {
                Ok(BoundedLine::Eof)
            } else if oversized {
                Ok(BoundedLine::Oversized)
            } else {
                Ok(BoundedLine::Line)
            };
        }

        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |index| index + 1);
        if !oversized {
            if output.len().saturating_add(take) > MAX_LINE_BYTES {
                output.clear();
                oversized = true;
            } else {
                output.extend_from_slice(&available[..take]);
            }
        }
        reader.consume(take);
        read_any = true;

        if newline.is_some() {
            while matches!(output.last(), Some(b'\n' | b'\r')) {
                output.pop();
            }
            return if oversized {
                Ok(BoundedLine::Oversized)
            } else {
                Ok(BoundedLine::Line)
            };
        }
    }
}

fn parse_usage_event(
    record: &Value,
    model: Option<&str>,
    cutoff: i64,
    now: i64,
) -> Option<UsageEvent> {
    let timestamp = record
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())?
        .timestamp();
    if timestamp < cutoff || timestamp > now.saturating_add(5 * 60) {
        return None;
    }

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

    let mut points = Vec::new();
    let mut base_percent = None;
    let mut last_percent = None;
    let mut segment_cost = 0.0;
    let mut covered_percent_intervals = Vec::new();
    let mut priced_event_count = 0_usize;
    let mut unpriced_event_count = 0_u32;

    for event in events {
        let Some(cost) = event.cost_usd.filter(|value| value.is_finite()) else {
            unpriced_event_count = unpriced_event_count.saturating_add(1);
            base_percent = None;
            last_percent = None;
            segment_cost = 0.0;
            continue;
        };
        priced_event_count += 1;

        let Some(base) = base_percent else {
            base_percent = Some(event.used_percent);
            last_percent = Some(event.used_percent);
            continue;
        };
        let previous_percent = last_percent.unwrap_or(event.used_percent);
        segment_cost += cost;

        if event.used_percent + f64::EPSILON < previous_percent {
            base_percent = Some(event.used_percent);
            last_percent = Some(event.used_percent);
            segment_cost = 0.0;
            continue;
        }
        if event.used_percent > previous_percent + f64::EPSILON {
            let delta_percent = event.used_percent - base;
            if delta_percent > 0.0 && segment_cost > 0.0 {
                points.push((segment_cost, delta_percent));
                covered_percent_intervals.push((previous_percent, event.used_percent));
            }
            last_percent = Some(event.used_percent);
        }
    }

    let percent_span = unique_percent_span(&covered_percent_intervals);
    let sum_x_squared = points.iter().map(|(x, _)| x * x).sum::<f64>();
    let sum_xy = points.iter().map(|(x, y)| x * y).sum::<f64>();
    let slope = (sum_x_squared > 0.0).then(|| sum_xy / sum_x_squared);
    let full_quota_usd = slope
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| 100.0 / value)
        .filter(|value| value.is_finite() && *value > 0.0);
    let ready = points.len() >= MIN_SAMPLE_COUNT
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
        sample_count: u32::try_from(points.len()).unwrap_or(u32::MAX),
        percent_span: percent_span.round().clamp(0.0, 100.0) as u8,
        unpriced_event_count,
    }
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
    use std::io::Cursor;
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

    #[test]
    fn 标准计价不会重复计算缓存和推理输出() {
        let cost =
            price_token_usage("gpt-5.6-sol", usage(200_000, 80_000, 20_000, 20_000)).unwrap();

        assert!((cost - 0.932).abs() < 0.000_001);
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
    fn 日志解析关联模型并按累计用量去重() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(
            file,
            "{}",
            json!({
                "timestamp": "2026-08-24T00:00:00Z",
                "type": "turn_context",
                "payload": { "model": "gpt-5.6-sol" }
            })
        )
        .unwrap();
        writeln!(file, "损坏记录").unwrap();
        let event = json!({
            "timestamp": "2026-08-24T00:01:00Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "last_token_usage": { "input_tokens": 1000, "output_tokens": 100 },
                    "total_token_usage": { "input_tokens": 1000, "output_tokens": 100, "total_tokens": 1100 }
                },
                "rate_limits": {
                    "primary": { "used_percent": 1, "window_minutes": 10080, "resets_at": 1788134400_i64 }
                }
            }
        });
        writeln!(file, "{event}").unwrap();
        writeln!(file, "{event}").unwrap();

        let mut events = Vec::new();
        read_rollout_events(file.path(), 1_787_000_000, 1_788_000_000, &mut events);

        assert_eq!(events.len(), 1);
        assert!(events[0].cost_usd.is_some());
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

        let event =
            parse_usage_event(&base, Some("gpt-5.6-sol"), 1_787_000_000, 1_788_134_000).unwrap();
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

        assert!(
            parse_usage_event(&record, Some("gpt-5.6-sol"), 1_787_000_000, 1_788_134_000,)
                .is_none()
        );
    }

    #[test]
    fn 超长行被消费且下一行仍可读取() {
        let mut input = vec![b'x'; MAX_LINE_BYTES + 1];
        input.extend_from_slice(b"\nok\n");
        let mut reader = Cursor::new(input);
        let mut output = Vec::new();

        assert!(matches!(
            read_bounded_line(&mut reader, &mut output).unwrap(),
            BoundedLine::Oversized
        ));
        assert!(matches!(
            read_bounded_line(&mut reader, &mut output).unwrap(),
            BoundedLine::Line
        ));
        assert_eq!(output, b"ok");
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
    fn 稳定样本恢复满额估值() {
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
        assert_eq!(result.price_table_as_of, "2026-08-25");
        let current = result.current.unwrap();
        assert_eq!(current.status, EstimateStatus::Ready);
        assert!((current.full_quota_usd.unwrap() - 100.0).abs() < 0.000_001);
        assert_eq!(current.percent_span, 12);
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
        let events = [0.0, 0.5, 1.0, 2.0]
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
        assert_eq!(current.sample_count, 3);
        assert_eq!(current.percent_span, 1);
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
        assert_eq!(current.sample_count, 2);
        assert_eq!(current.percent_span, 2);
        assert_eq!(current.status, EstimateStatus::Collecting);
        assert_eq!(current.full_quota_usd, None);
    }

    #[test]
    fn 未计价事件会切断回归样本段() {
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
        assert_eq!(current.unpriced_event_count, 1);
        assert_eq!(current.sample_count, 10);
        assert_eq!(current.percent_span, 10);
    }

    #[test]
    fn 重叠样本段只计算唯一覆盖跨度() {
        let reset_at = 10_000;
        let events = vec![
            test_event(1_000, reset_at, 0.0, Some(0.0)),
            test_event(1_001, reset_at, 55.0, Some(1.0)),
            test_event(1_002, reset_at, 33.0, Some(1.0)),
            test_event(1_003, reset_at, 60.0, Some(1.0)),
        ];

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.percent_span, 60);
    }

    #[test]
    fn 分离样本段不会填补未观察区间() {
        let reset_at = 10_000;
        let events = vec![
            test_event(1_000, reset_at, 10.0, Some(0.0)),
            test_event(1_001, reset_at, 20.0, Some(1.0)),
            test_event(1_002, reset_at, 25.0, None),
            test_event(1_003, reset_at, 30.0, Some(0.0)),
            test_event(1_004, reset_at, 35.0, Some(1.0)),
        ];

        let current = estimate_from_events(events, reset_at).current.unwrap();
        assert_eq!(current.percent_span, 15);
        assert_eq!(current.unpriced_event_count, 1);
    }

    #[test]
    fn 估算序列化不包含_r_平方字段() {
        let current = estimate_from_events(vec![test_event(1_000, 10_000, 1.0, Some(0.0))], 10_000)
            .current
            .unwrap();
        let serialized = serde_json::to_value(current).unwrap();

        assert!(serialized.get("rSquared").is_none());
    }

    #[test]
    fn codex_auto_review缓存写入不会切断回归样本段() {
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
        assert_eq!(current.unpriced_event_count, 0);
        assert_eq!(current.sample_count, 12);
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
