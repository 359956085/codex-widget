use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs::{self, File};
use std::hash::{DefaultHasher, Hasher};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use super::{parse_usage_event, read_token_usage, TokenUsage, UsageEvent};

const MAX_FILE_COUNT: usize = 5_000;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
pub(super) const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_DIRECTORY_DEPTH: usize = 8;

#[derive(Debug, Default)]
pub(super) struct EstimateCache {
    root: Option<PathBuf>,
    files: HashMap<OsString, CachedRollout>,
}

#[derive(Debug)]
struct CachedRollout {
    size: u64,
    modified: u128,
    append_safe: bool,
    content_fingerprint: u64,
    state: RolloutParserState,
    events: Vec<UsageEvent>,
}

#[derive(Debug, Clone, Default)]
struct RolloutParserState {
    model: Option<String>,
    total_usage_fingerprints: HashMap<TokenUsage, AcceptedUsage>,
}

#[derive(Debug, Clone)]
struct AcceptedUsage {
    priced: bool,
    reset_at: i64,
    used_percent: f64,
}

#[derive(Debug)]
pub(super) struct CollectedEvents {
    pub(super) events: Vec<UsageEvent>,
    pub(super) stats: CacheStats,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct CacheStats {
    pub(super) bytes_read: u64,
    pub(super) reused_files: usize,
    pub(super) appended_files: usize,
    pub(super) full_parse_files: usize,
}

#[derive(Debug)]
pub(super) struct FileCandidate {
    pub(super) file_name: OsString,
    pub(super) path: PathBuf,
    pub(super) size: u64,
    pub(super) modified: u128,
}

#[derive(Debug)]
struct ParsedChunk {
    events: Vec<UsageEvent>,
    state: RolloutParserState,
    append_safe: bool,
    content_fingerprint: u64,
}

enum RefreshMode {
    Reuse,
    Append {
        offset: u64,
        state: RolloutParserState,
        content_fingerprint: u64,
    },
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BoundedLine {
    Eof,
    Line { terminated: bool },
    Oversized { terminated: bool },
}

impl EstimateCache {
    pub(super) fn collect_events(
        &mut self,
        codex_home: &Path,
        cutoff: i64,
        now: i64,
    ) -> Result<CollectedEvents> {
        if self.root.as_deref() != Some(codex_home) {
            self.root = Some(codex_home.to_path_buf());
            self.files.clear();
        }

        let session_dirs = [
            codex_home.join("sessions"),
            codex_home.join("archived_sessions"),
        ];
        let candidates = collect_rollout_files(&session_dirs, cutoff)?;
        let mut selected_names = HashSet::with_capacity(candidates.len());
        let mut events = Vec::new();
        let mut stats = CacheStats::default();

        for candidate in candidates {
            let file_name = candidate.file_name.clone();
            selected_names.insert(file_name.clone());
            if !self.refresh_candidate(&candidate, &mut stats) {
                continue;
            }

            if let Some(cached) = self.files.get(&file_name) {
                events.extend(
                    cached
                        .events
                        .iter()
                        .filter(|event| {
                            event.timestamp.timestamp() >= cutoff
                                && event.timestamp.timestamp() <= now.saturating_add(5 * 60)
                        })
                        .cloned(),
                );
            }
        }

        self.files
            .retain(|file_name, _| selected_names.contains(file_name));
        Ok(CollectedEvents { events, stats })
    }

    fn refresh_candidate(&mut self, candidate: &FileCandidate, stats: &mut CacheStats) -> bool {
        let mode = match self.files.get(&candidate.file_name) {
            Some(cached)
                if cached.size == candidate.size && cached.modified == candidate.modified =>
            {
                RefreshMode::Reuse
            }
            Some(cached)
                if candidate.size > cached.size
                    && candidate.modified >= cached.modified
                    && cached.append_safe =>
            {
                RefreshMode::Append {
                    offset: cached.size,
                    state: cached.state.clone(),
                    content_fingerprint: cached.content_fingerprint,
                }
            }
            _ => RefreshMode::Full,
        };

        if matches!(mode, RefreshMode::Reuse) {
            stats.reused_files += 1;
            return true;
        }

        let mut file = match File::open(&candidate.path) {
            Ok(file) => file,
            Err(_) => return false,
        };
        let (offset, state, digest, is_append) = match mode {
            RefreshMode::Append {
                offset,
                state,
                content_fingerprint,
            } => {
                let digest = match fingerprint_prefix(&mut file, offset, stats) {
                    Ok(digest) => digest,
                    Err(_) => return false,
                };
                if digest.finish() == content_fingerprint {
                    (offset, state, digest, true)
                } else {
                    if file.seek(SeekFrom::Start(0)).is_err() {
                        return false;
                    }
                    (
                        0,
                        RolloutParserState::default(),
                        DefaultHasher::new(),
                        false,
                    )
                }
            }
            RefreshMode::Full => (
                0,
                RolloutParserState::default(),
                DefaultHasher::new(),
                false,
            ),
            RefreshMode::Reuse => unreachable!(),
        };
        let parsed =
            match parse_rollout_segment(&mut file, candidate.size - offset, state, digest, stats) {
                Ok(parsed) => parsed,
                Err(_) => return false,
            };

        if is_append {
            stats.appended_files += 1;
        } else {
            stats.full_parse_files += 1;
        }

        if is_append {
            let Some(cached) = self.files.get_mut(&candidate.file_name) else {
                return false;
            };
            cached.events.extend(parsed.events);
            cached.state = parsed.state;
            cached.size = candidate.size;
            cached.modified = candidate.modified;
            cached.append_safe = parsed.append_safe;
            cached.content_fingerprint = parsed.content_fingerprint;
        } else {
            self.files.insert(
                candidate.file_name.clone(),
                CachedRollout {
                    size: candidate.size,
                    modified: candidate.modified,
                    append_safe: parsed.append_safe,
                    content_fingerprint: parsed.content_fingerprint,
                    state: parsed.state,
                    events: parsed.events,
                },
            );
        }
        true
    }
}

fn collect_rollout_files(session_dirs: &[PathBuf], cutoff: i64) -> Result<Vec<FileCandidate>> {
    let existing_dirs = session_dirs
        .iter()
        .filter(|directory| directory.is_dir())
        .collect::<Vec<_>>();
    if existing_dirs.is_empty() {
        return Err(anyhow!("Codex 活动及归档会话目录均不存在。"));
    }

    let mut candidates = Vec::new();
    for directory in existing_dirs {
        collect_directory_files(directory, 0, cutoff, &mut candidates)?;
    }
    Ok(select_rollout_files(candidates))
}

pub(super) fn select_rollout_files(mut candidates: Vec<FileCandidate>) -> Vec<FileCandidate> {
    candidates.sort_by(|left, right| {
        right
            .modified
            .cmp(&left.modified)
            .then_with(|| left.path.cmp(&right.path))
    });

    let mut total_bytes = 0_u64;
    let mut seen_file_names = HashSet::new();
    let mut selected = Vec::new();
    for candidate in candidates {
        if !seen_file_names.insert(candidate.file_name.clone()) {
            continue;
        }
        if selected.len() >= MAX_FILE_COUNT {
            break;
        }
        let next_total = total_bytes.saturating_add(candidate.size);
        if next_total > MAX_TOTAL_BYTES {
            continue;
        }
        total_bytes = next_total;
        selected.push(candidate);
    }
    selected
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
        let Some(file_name) = path.file_name().map(ToOwned::to_owned) else {
            continue;
        };
        if !file_type.is_file()
            || path.extension().and_then(|value| value.to_str()) != Some("jsonl")
            || !file_name
                .to_str()
                .is_some_and(|value| value.starts_with("rollout-"))
        {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified = system_time_nanos(metadata.modified().unwrap_or(UNIX_EPOCH));
        let cutoff_nanos = u128::try_from(cutoff.max(0))
            .unwrap_or_default()
            .saturating_mul(1_000_000_000);
        if modified < cutoff_nanos {
            continue;
        }
        candidates.push(FileCandidate {
            file_name,
            path,
            size: metadata.len(),
            modified,
        });
    }
    Ok(())
}

fn system_time_nanos(value: SystemTime) -> u128 {
    value
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos())
}

// 摘要覆盖全部原始字节，包括被跳过的非计量记录和超长行。
struct FingerprintReader<R> {
    inner: R,
    digest: DefaultHasher,
}

impl<R: Read> Read for FingerprintReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(buffer)?;
        self.digest.write(&buffer[..count]);
        Ok(count)
    }
}

fn fingerprint_prefix(
    file: &mut File,
    size: u64,
    stats: &mut CacheStats,
) -> io::Result<DefaultHasher> {
    let mut reader = FingerprintReader {
        inner: file.take(size),
        digest: DefaultHasher::new(),
    };
    let result = io::copy(&mut reader, &mut io::sink());
    stats.bytes_read = stats.bytes_read.saturating_add(size - reader.inner.limit());
    result?;
    if reader.inner.limit() != 0 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "日志旧内容未读取完整",
        ));
    }
    Ok(reader.digest)
}

fn parse_rollout_segment(
    file: &mut File,
    segment_size: u64,
    mut state: RolloutParserState,
    digest: DefaultHasher,
    stats: &mut CacheStats,
) -> io::Result<ParsedChunk> {
    let mut reader = BufReader::new(FingerprintReader {
        inner: file.take(segment_size),
        digest,
    });
    let mut line = Vec::new();
    let mut events = Vec::new();
    let mut append_safe = true;

    let result = (|| -> io::Result<()> {
        loop {
            match read_bounded_line(&mut reader, &mut line)? {
                BoundedLine::Eof => break,
                BoundedLine::Oversized { terminated } => append_safe = terminated,
                BoundedLine::Line { terminated } => {
                    append_safe = terminated;
                    if let Some(event) = parse_rollout_line(&line, &mut state) {
                        events.push(event);
                    }
                }
            }
        }
        Ok(())
    })();

    let remaining = reader.get_ref().inner.limit();
    stats.bytes_read = stats.bytes_read.saturating_add(segment_size - remaining);
    result?;
    if remaining != 0 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "日志新增内容未读取完整",
        ));
    }
    Ok(ParsedChunk {
        events,
        state,
        append_safe,
        content_fingerprint: reader.get_ref().digest.finish(),
    })
}

fn parse_rollout_line(line: &[u8], state: &mut RolloutParserState) -> Option<UsageEvent> {
    let text = std::str::from_utf8(line).ok()?;
    // 先按记录类型过滤，避免把提示词和工具输出反序列化进内存。
    if !text.contains("\"turn_context\"") && !text.contains("\"token_count\"") {
        return None;
    }
    let record = match serde_json::from_str::<Value>(text) {
        Ok(record) => record,
        Err(_) => {
            if text.contains("\"turn_context\"") {
                // 损坏的上下文可能正好位于模型切换点；清空关联比沿用旧模型更保守。
                state.model = None;
            }
            return None;
        }
    };

    if record.get("type").and_then(Value::as_str) == Some("turn_context") {
        state.model = record
            .pointer("/payload/model")
            .and_then(Value::as_str)
            .map(str::to_string);
        return None;
    }
    if record.get("type").and_then(Value::as_str) != Some("event_msg")
        || record.pointer("/payload/type").and_then(Value::as_str) != Some("token_count")
    {
        return None;
    }

    let total_usage = record
        .pointer("/payload/info/total_token_usage")
        .and_then(read_token_usage);
    let mut event = parse_usage_event(&record, state.model.as_deref())?;
    if let Some(usage) = total_usage {
        if let Some(accepted) = state.total_usage_fingerprints.get_mut(&usage) {
            if accepted.reset_at == event.reset_at && accepted.used_percent == event.used_percent {
                return None;
            }
            // 额度快照可延后更新；保留观测，但同一用量只能计费一次。
            // 原费用未知时继续切断样本段，不能用零费用掩盖缺失数据。
            event.cost_usd = accepted.priced.then_some(0.0);
            accepted.reset_at = event.reset_at;
            accepted.used_percent = event.used_percent;
        } else {
            state.total_usage_fingerprints.insert(
                usage,
                AcceptedUsage {
                    priced: event.cost_usd.is_some(),
                    reset_at: event.reset_at,
                    used_percent: event.used_percent,
                },
            );
        }
    }
    Some(event)
}

pub(super) fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    output: &mut Vec<u8>,
) -> io::Result<BoundedLine> {
    output.clear();
    let mut oversized = false;
    let mut read_any = false;

    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return if !read_any {
                Ok(BoundedLine::Eof)
            } else if oversized {
                Ok(BoundedLine::Oversized { terminated: false })
            } else {
                Ok(BoundedLine::Line { terminated: false })
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
                Ok(BoundedLine::Oversized { terminated: true })
            } else {
                Ok(BoundedLine::Line { terminated: true })
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File, FileTimes, OpenOptions};
    use std::io::{Cursor, Write};
    use std::time::Duration;

    use chrono::{SecondsFormat, TimeZone, Utc};
    use serde_json::json;

    use super::*;

    #[test]
    fn 未变化日志第二次不读取正文() {
        let codex_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let reset_at = now + 3 * 24 * 60 * 60;
        write_rollout(
            codex_home.path(),
            "sessions",
            "rollout-cache.jsonl",
            now,
            reset_at,
            true,
        );
        let mut cache = EstimateCache::default();

        let first = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();
        let second = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();

        assert!(first.stats.bytes_read > 0);
        assert_eq!(second.stats.bytes_read, 0);
        assert_eq!(second.stats.reused_files, 1);
        assert_eq!(first.events, second.events);
    }

    #[test]
    fn 增长日志校验旧内容后只解析新增事件() {
        let codex_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let reset_at = now + 3 * 24 * 60 * 60;
        let path = write_rollout(
            codex_home.path(),
            "sessions",
            "rollout-append.jsonl",
            now,
            reset_at,
            true,
        );
        let mut cache = EstimateCache::default();
        let first = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();
        append_event(&path, now + 10, reset_at, 2.0, 200_000, true);
        let new_size = fs::metadata(&path).unwrap().len();

        let second = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now + 10)
            .unwrap();

        assert_eq!(second.stats.bytes_read, new_size);
        assert_eq!(second.stats.appended_files, 1);
        assert_eq!(second.events.len(), first.events.len() + 1);
        // 再次追加，确认保存的摘要覆盖旧内容和上次新增内容。
        append_event(&path, now + 20, reset_at, 3.0, 300_000, false);
        let third = cache
            .collect_events(codex_home.path(), now - 100, now + 20)
            .unwrap();
        let cold = EstimateCache::default()
            .collect_events(codex_home.path(), now - 100, now + 20)
            .unwrap();
        assert_eq!(third.stats.appended_files, 1);
        assert_eq!(third.events, cold.events);
    }

    #[test]
    fn 归档移动保持元数据时复用缓存() {
        let codex_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let reset_at = now + 3 * 24 * 60 * 60;
        let source = write_rollout(
            codex_home.path(),
            "sessions",
            "rollout-move.jsonl",
            now,
            reset_at,
            true,
        );
        let mut cache = EstimateCache::default();
        cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();
        let archive_dir = codex_home.path().join("archived_sessions");
        fs::create_dir_all(&archive_dir).unwrap();
        fs::rename(&source, archive_dir.join("rollout-move.jsonl")).unwrap();

        let second = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();

        assert_eq!(second.stats.bytes_read, 0);
        assert_eq!(second.stats.reused_files, 1);
    }

    #[test]
    fn 截断和同大小重写都会完整解析() {
        let codex_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let reset_at = now + 3 * 24 * 60 * 60;
        let path = write_rollout(
            codex_home.path(),
            "sessions",
            "rollout-rewrite.jsonl",
            now,
            reset_at,
            true,
        );
        let mut cache = EstimateCache::default();
        cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();

        let original = fs::read(&path).unwrap();
        fs::write(&path, &original[..original.len() / 2]).unwrap();
        let truncated = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();
        assert_eq!(
            truncated.stats.bytes_read,
            fs::metadata(&path).unwrap().len()
        );
        assert_eq!(truncated.stats.full_parse_files, 1);

        let same_size = fs::read(&path).unwrap();
        fs::write(&path, &same_size).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(SystemTime::now() + Duration::from_secs(2)))
            .unwrap();
        let rewritten = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();
        assert_eq!(
            rewritten.stats.bytes_read,
            fs::metadata(&path).unwrap().len()
        );
        assert_eq!(rewritten.stats.full_parse_files, 1);
    }

    #[test]
    fn 非换行尾部增长会完整解析() {
        let codex_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let reset_at = now + 3 * 24 * 60 * 60;
        let path = write_rollout(
            codex_home.path(),
            "sessions",
            "rollout-tail.jsonl",
            now,
            reset_at,
            false,
        );
        let mut cache = EstimateCache::default();
        cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();
        append_event(&path, now + 10, reset_at, 2.0, 200_000, true);

        let second = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now + 10)
            .unwrap();

        assert_eq!(second.stats.bytes_read, fs::metadata(&path).unwrap().len());
        assert_eq!(second.stats.full_parse_files, 1);
        assert_eq!(second.stats.appended_files, 0);
    }

    #[test]
    fn 数据目录变化会清空旧缓存() {
        let first_home = tempfile::tempdir().unwrap();
        let second_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let reset_at = now + 3 * 24 * 60 * 60;
        write_rollout(
            first_home.path(),
            "sessions",
            "rollout-root.jsonl",
            now,
            reset_at,
            true,
        );
        write_rollout(
            second_home.path(),
            "sessions",
            "rollout-root.jsonl",
            now,
            reset_at,
            true,
        );
        let mut cache = EstimateCache::default();
        cache
            .collect_events(first_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();

        let second = cache
            .collect_events(second_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();

        assert!(second.stats.bytes_read > 0);
        assert_eq!(second.stats.full_parse_files, 1);
    }

    #[test]
    fn 删除或不再入选的日志会清出缓存() {
        let codex_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let reset_at = now + 3 * 24 * 60 * 60;
        let path = write_rollout(
            codex_home.path(),
            "sessions",
            "rollout-evict.jsonl",
            now,
            reset_at,
            true,
        );
        let mut cache = EstimateCache::default();
        cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();
        assert_eq!(cache.files.len(), 1);
        fs::remove_file(path).unwrap();

        let second = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();

        assert!(second.events.is_empty());
        assert!(cache.files.is_empty());
    }

    #[test]
    fn 时间窗口变化会重新过滤缓存事件() {
        let codex_home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let reset_at = now + 3 * 24 * 60 * 60;
        let path = write_rollout(
            codex_home.path(),
            "sessions",
            "rollout-time-filter.jsonl",
            now,
            reset_at,
            true,
        );
        append_event(&path, now + 301, reset_at, 2.0, 200_000, false);
        let mut cache = EstimateCache::default();

        let first = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now)
            .unwrap();
        let second = cache
            .collect_events(codex_home.path(), now - 16 * 24 * 60 * 60, now + 1)
            .unwrap();

        assert_eq!(first.events.len(), 1);
        assert_eq!(second.events.len(), 2);
        assert_eq!(second.stats.bytes_read, 0);
    }

    #[test]
    fn 同名日志优先保留更新时间较新的副本() {
        let older = PathBuf::from("sessions").join("rollout-shared.jsonl");
        let newer = PathBuf::from("archived_sessions").join("rollout-shared.jsonl");
        let selected = select_rollout_files(vec![
            FileCandidate {
                file_name: OsString::from("rollout-shared.jsonl"),
                path: older,
                size: 10,
                modified: 1,
            },
            FileCandidate {
                file_name: OsString::from("rollout-shared.jsonl"),
                path: newer.clone(),
                size: 10,
                modified: 2,
            },
        ]);

        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].path, newer);
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
        let size = file.as_file().metadata().unwrap().len();

        let parsed = parse_rollout_segment(
            &mut File::open(file.path()).unwrap(),
            size,
            RolloutParserState::default(),
            DefaultHasher::new(),
            &mut CacheStats::default(),
        )
        .unwrap();

        assert_eq!(parsed.events.len(), 1);
        assert!(parsed.events[0].cost_usd.is_some());
    }

    #[test]
    fn 较大重写与旧内容中段修改都与冷缓存一致() {
        for middle_only in [false, true] {
            let home = tempfile::tempdir().unwrap();
            let now = Utc::now().timestamp();
            let reset = now + 10_000;
            let path = write_rollout(
                home.path(),
                "sessions",
                "rollout-rewrite.jsonl",
                now,
                reset,
                true,
            );
            for index in 2..=5 {
                append_event(
                    &path,
                    now + index,
                    reset,
                    index as f64,
                    index as u64 * 100_000,
                    false,
                );
            }
            // 足够长的头尾，确保中段变化不能仅靠头尾抽样检测。
            let original = fs::read_to_string(&path).unwrap();
            let padding = format!("{}\n", "x".repeat(MAX_LINE_BYTES + 1));
            fs::write(&path, format!("{padding}{original}{padding}")).unwrap();
            let mut cache = EstimateCache::default();
            cache
                .collect_events(home.path(), now - 100, now + 10)
                .unwrap();
            let old_size = fs::metadata(&path).unwrap().len();
            let replacement = if middle_only {
                original.replace("gpt-5.6-sol", "gpt-6-astra")
            } else {
                format!(
                    "{}\n{original}",
                    json!({"type": "turn_context", "payload": {"model": "unknown"}})
                )
                .replace("gpt-5.6-sol", "gpt-6-astra")
            };
            fs::write(&path, format!("{padding}{replacement}{padding}")).unwrap();
            append_event(&path, now + 6, reset, 6.0, 600_000, false);
            assert!(fs::metadata(&path).unwrap().len() > old_size);
            let warm = cache
                .collect_events(home.path(), now - 100, now + 10)
                .unwrap();
            let cold = EstimateCache::default()
                .collect_events(home.path(), now - 100, now + 10)
                .unwrap();
            assert_eq!(warm.stats.full_parse_files, 1);
            assert_eq!(warm.stats.appended_files, 0);
            assert_eq!(warm.events, cold.events);
            let estimate = super::super::estimate_from_events(warm.events, reset);
            assert_eq!(estimate.current.unwrap().full_quota_usd, Some(100.0));
        }
    }

    #[test]
    fn 额度缺失或时间无效不会提前消耗去重指纹() {
        for invalid_timestamp in [false, true] {
            let valid = quota_event(1_000, 10_000, 1.0, 100_000);
            let mut invalid = valid.clone();
            if invalid_timestamp {
                invalid["timestamp"] = json!("invalid");
            } else {
                invalid["payload"]["rate_limits"] = Value::Null;
            }
            let mut state = RolloutParserState {
                model: Some("gpt-6-astra".into()),
                ..Default::default()
            };
            assert!(parse_rollout_line(invalid.to_string().as_bytes(), &mut state).is_none());
            let event = parse_rollout_line(valid.to_string().as_bytes(), &mut state).unwrap();
            assert_eq!(event.cost_usd, Some(1.0));
            assert!(parse_rollout_line(valid.to_string().as_bytes(), &mut state).is_none());
        }
    }

    #[test]
    fn 重复用量保留额度变化且未知费用不会变为零() {
        for model in ["gpt-6-astra", "unknown"] {
            let mut state = RolloutParserState {
                model: Some(model.into()),
                ..Default::default()
            };
            let first = quota_event(1_000, 10_000, 1.0, 100_000);
            let original = parse_rollout_line(first.to_string().as_bytes(), &mut state).unwrap();
            assert_eq!(original.cost_usd, (model != "unknown").then_some(1.0));
            // 后续上下文不能把原先未知的用量重新归价。
            state.model = Some("gpt-6-astra".into());
            for (reset, percent) in [(10_000, 2.0), (10_001, 2.0)] {
                let updated = quota_event(1_001, reset, percent, 100_000);
                let event = parse_rollout_line(updated.to_string().as_bytes(), &mut state).unwrap();
                assert_eq!(event.used_percent, percent);
                assert_eq!(event.reset_at, reset);
                assert_eq!(event.cost_usd, (model != "unknown").then_some(0.0));
                assert!(parse_rollout_line(updated.to_string().as_bytes(), &mut state).is_none());
            }
        }
    }

    #[test]
    fn 后补额度跨增量读取仍只计费一次并生成正确估值() {
        let home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let reset = now + 10_000;
        let path = write_rollout(
            home.path(),
            "sessions",
            "rollout-quota.jsonl",
            now,
            reset,
            true,
        );
        let mut cache = EstimateCache::default();
        for index in 2..=5 {
            // 用量先到，百分比延迟到达；第二条必须携带零新增费用。
            append_event(
                &path,
                now + index * 2,
                reset,
                (index - 1) as f64,
                index as u64 * 100_000,
                false,
            );
            cache
                .collect_events(home.path(), now - 100, now + 20)
                .unwrap();
            append_event(
                &path,
                now + index * 2 + 1,
                reset,
                index as f64,
                index as u64 * 100_000,
                false,
            );
        }
        let warm = cache
            .collect_events(home.path(), now - 100, now + 20)
            .unwrap();
        let cold = EstimateCache::default()
            .collect_events(home.path(), now - 100, now + 20)
            .unwrap();
        assert_eq!(warm.events, cold.events);
        assert_eq!(warm.events.len(), 9);
        assert!(
            (warm
                .events
                .iter()
                .map(|event| event.cost_usd.unwrap())
                .sum::<f64>()
                - 2.0)
                .abs()
                < 1e-9
        );
        let current = super::super::estimate_from_events(warm.events, reset)
            .current
            .unwrap();
        assert_eq!(current.sample_count, 3);
        assert_eq!(current.full_quota_usd, Some(40.0));
    }

    #[test]
    fn 提前结束读取不提交部分缓存且下次可恢复() {
        let home = tempfile::tempdir().unwrap();
        let now = Utc::now().timestamp();
        let path = write_rollout(
            home.path(),
            "sessions",
            "rollout-short.jsonl",
            now,
            now + 10_000,
            true,
        );
        let metadata = fs::metadata(&path).unwrap();
        let mut candidate = FileCandidate {
            file_name: OsString::from("rollout-short.jsonl"),
            path: path.clone(),
            size: metadata.len() + 100,
            modified: system_time_nanos(metadata.modified().unwrap()),
        };
        let mut cache = EstimateCache::default();
        let mut stats = CacheStats::default();
        assert!(!cache.refresh_candidate(&candidate, &mut stats));
        assert!(cache.files.is_empty());
        candidate.size = metadata.len();
        assert!(cache.refresh_candidate(&candidate, &mut stats));
        let original = cache.files[&candidate.file_name].events.clone();
        candidate.size += 100;
        assert!(!cache.refresh_candidate(&candidate, &mut stats));
        assert_eq!(cache.files[&candidate.file_name].events, original);
        fs::write(&path, b"{}\n").unwrap();
        assert!(!cache.refresh_candidate(&candidate, &mut stats));
        assert_eq!(cache.files[&candidate.file_name].size, metadata.len());
        candidate.size = 3;
        assert!(cache.refresh_candidate(&candidate, &mut stats));
        assert!(cache.files[&candidate.file_name].events.is_empty());
    }

    #[test]
    fn 超长行被消费且下一行仍可读取() {
        let mut input = vec![b'x'; MAX_LINE_BYTES + 1];
        input.extend_from_slice(b"\nok\n");
        let mut reader = Cursor::new(input);
        let mut output = Vec::new();

        assert!(matches!(
            read_bounded_line(&mut reader, &mut output).unwrap(),
            BoundedLine::Oversized { terminated: true }
        ));
        assert!(matches!(
            read_bounded_line(&mut reader, &mut output).unwrap(),
            BoundedLine::Line { terminated: true }
        ));
        assert_eq!(output, b"ok");
    }

    #[test]
    fn 已删除文件不会污染缓存() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rollout-missing.jsonl");
        fs::write(&path, b"{}\n").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let candidate = FileCandidate {
            file_name: OsString::from("rollout-missing.jsonl"),
            path: path.clone(),
            size: metadata.len(),
            modified: system_time_nanos(metadata.modified().unwrap()),
        };
        fs::remove_file(path).unwrap();
        let mut cache = EstimateCache::default();
        let mut stats = CacheStats::default();

        assert!(!cache.refresh_candidate(&candidate, &mut stats));
        assert!(cache.files.is_empty());
        assert_eq!(stats.bytes_read, 0);
    }

    fn write_rollout(
        codex_home: &Path,
        directory: &str,
        file_name: &str,
        timestamp: i64,
        reset_at: i64,
        trailing_newline: bool,
    ) -> PathBuf {
        let directory = codex_home.join(directory);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(file_name);
        let context = json!({
            "timestamp": format_timestamp(timestamp),
            "type": "turn_context",
            "payload": { "model": "gpt-5.6-sol" }
        });
        let event = quota_event(timestamp + 1, reset_at, 1.0, 100_000);
        let ending = if trailing_newline { "\n" } else { "" };
        fs::write(&path, format!("{context}\n{event}{ending}")).unwrap();
        path
    }

    fn append_event(
        path: &Path,
        timestamp: i64,
        reset_at: i64,
        used_percent: f64,
        total_input_tokens: u64,
        leading_newline: bool,
    ) {
        let mut file = OpenOptions::new().append(true).open(path).unwrap();
        if leading_newline {
            writeln!(file).unwrap();
        }
        writeln!(
            file,
            "{}",
            quota_event(timestamp, reset_at, used_percent, total_input_tokens)
        )
        .unwrap();
    }

    fn quota_event(
        timestamp: i64,
        reset_at: i64,
        used_percent: f64,
        total_input_tokens: u64,
    ) -> Value {
        json!({
            "timestamp": format_timestamp(timestamp),
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "last_token_usage": {
                        "input_tokens": 100_000,
                        "output_tokens": 0,
                        "total_tokens": 100_000
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
                        "window_minutes": 10080,
                        "resets_at": reset_at
                    }
                }
            }
        })
    }

    fn format_timestamp(timestamp: i64) -> String {
        Utc.timestamp_opt(timestamp, 0)
            .single()
            .unwrap()
            .to_rfc3339_opts(SecondsFormat::Secs, true)
    }
}
