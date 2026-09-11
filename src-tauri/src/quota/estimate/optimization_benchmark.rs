use super::*;
use std::hint::black_box;
use std::io::Write;
use std::time::Instant;

// 仅使用固定合成数据；耗时不设通过阈值，避免把机器负载波动当作功能回归。
#[test]
#[ignore = "手动记录固定样本的估算耗时与缓存读取量"]
fn optimization_benchmark() {
    let reset = 2_000_000;
    let events = (0..40_000)
        .map(|index| UsageEvent {
            timestamp: Utc.timestamp_opt(1_000_000 + index, 0).unwrap(),
            reset_at: reset - (index / 10_000) * 604_800 + index % 100,
            used_percent: (index % 100) as f64,
            cost_usd: Some(1.0),
        })
        .collect::<Vec<_>>();
    let expected = estimate_from_events(events.clone(), reset);
    let started = Instant::now();
    for _ in 0..100 {
        assert_eq!(
            black_box(estimate_from_events(events.clone(), reset)),
            expected
        );
    }
    println!("估算四万事件，一百轮：{:?}", started.elapsed());

    let directory = tempfile::tempdir().unwrap();
    let sessions = directory.path().join("sessions");
    std::fs::create_dir(&sessions).unwrap();
    let path = sessions.join("rollout-benchmark.jsonl");
    let mut file = std::fs::File::create(&path).unwrap();
    writeln!(
        file,
        "{}",
        serde_json::json!({"type":"turn_context","payload":{"model":"gpt-6-astra"}})
    )
    .unwrap();
    for index in 0..10_000 {
        writeln!(file, "{}", serde_json::json!({
            "timestamp": Utc.timestamp_opt(1_500_000 + index, 0).unwrap().to_rfc3339(),
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {"last_token_usage":{"input_tokens":100_000}},
                "rate_limits":{"primary":{"window_minutes":10080,"used_percent":index % 100,"resets_at":reset}}
            }
        })).unwrap();
    }
    drop(file);
    let mut cache = EstimateCache::default();
    let cold_start = Instant::now();
    let cold = cache.collect_events(directory.path(), 0, reset).unwrap();
    println!(
        "冷缓存：{:?}，{:?}，事件数 {}",
        cold_start.elapsed(),
        cold.stats,
        cold.events.len()
    );
    let warm_start = Instant::now();
    let warm = cache.collect_events(directory.path(), 0, reset).unwrap();
    println!("复用缓存：{:?}，{:?}", warm_start.elapsed(), warm.stats);
    assert_eq!(cold.events, warm.events);
    assert_eq!(cold.events.len(), 10_000);
    assert_eq!(warm.stats.bytes_read, 0);
}
