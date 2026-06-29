use std::env;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::{fs, time::SystemTime};

use tokio::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CODEX_COMMAND_NAME: &str = "codex.exe";
#[cfg(not(windows))]
const CODEX_COMMAND_NAME: &str = "codex";

pub fn resolve_codex_command(codex_cli_path: Option<&Path>) -> PathBuf {
    if let Some(path) = codex_cli_path {
        return path.to_path_buf();
    }

    let mut candidates = Vec::new();
    push_env_path_candidate(&mut candidates);
    push_command_lookup_candidates(&mut candidates);

    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from(CODEX_COMMAND_NAME)
}

pub fn configure_process_path_for_codex() {
    configure_platform_process_path_for_codex();
}

fn push_env_path_candidate(candidates: &mut Vec<PathBuf>) {
    if let Ok(path) = env::var("CODEX_CLI_PATH") {
        let path = path.trim();
        if !path.is_empty() {
            candidates.push(PathBuf::from(path));
        }
    }
}

#[cfg(windows)]
fn push_platform_candidates(candidates: &mut Vec<PathBuf>) {
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        let codex_bin = PathBuf::from(local_app_data)
            .join("OpenAI")
            .join("Codex")
            .join("bin");
        candidates.push(codex_bin.join(CODEX_COMMAND_NAME));

        if let Some(command) = find_codex_command_in_version_dirs(&codex_bin) {
            candidates.push(command);
        }
    }
}

#[cfg(target_os = "macos")]
fn push_platform_candidates(candidates: &mut Vec<PathBuf>) {
    for path in macos_common_codex_paths() {
        candidates.push(path);
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn push_platform_candidates(_candidates: &mut Vec<PathBuf>) {}

#[cfg(windows)]
fn push_command_lookup_candidates(candidates: &mut Vec<PathBuf>) {
    push_platform_candidates(candidates);
    if let Some(command) = find_command_in_path(CODEX_COMMAND_NAME) {
        candidates.push(command);
    }
}

#[cfg(target_os = "macos")]
fn push_command_lookup_candidates(candidates: &mut Vec<PathBuf>) {
    if let Some(command) = find_command_in_path(CODEX_COMMAND_NAME) {
        candidates.push(command);
    }
    push_platform_candidates(candidates);
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn push_command_lookup_candidates(candidates: &mut Vec<PathBuf>) {
    if let Some(command) = find_command_in_path(CODEX_COMMAND_NAME) {
        candidates.push(command);
    }
    push_platform_candidates(candidates);
}

#[cfg(windows)]
fn find_codex_command_in_version_dirs(codex_bin: &PathBuf) -> Option<PathBuf> {
    // Codex CLI Windows 版会把可执行文件放在 bin 下的哈希子目录中，不能只检查固定文件名。
    let entries = fs::read_dir(codex_bin).ok()?;
    let mut newest: Option<(SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let candidate = entry.path().join(CODEX_COMMAND_NAME);
        if !candidate.exists() {
            continue;
        }

        let modified_at = candidate
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        match &newest {
            Some((current_time, _)) if modified_at <= *current_time => {}
            _ => newest = Some((modified_at, candidate)),
        }
    }

    newest.map(|(_, path)| path)
}

fn find_command_in_path(command_name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(command_name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn macos_common_codex_paths() -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
        PathBuf::from("/usr/bin/codex"),
    ];
    if let Some(home) = env::var_os("HOME") {
        paths.push(PathBuf::from(home).join(".local").join("bin").join("codex"));
    }
    paths
}

#[cfg(target_os = "macos")]
fn configure_platform_process_path_for_codex() {
    let mut paths = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    for dir in macos_common_command_dirs() {
        if !paths.iter().any(|path| path == &dir) {
            paths.push(dir);
        }
    }
    if let Ok(joined) = env::join_paths(paths) {
        // macOS 从 Finder 启动 .app 时通常拿不到 shell PATH，这里补充常见命令目录。
        env::set_var("PATH", joined);
    }
}

#[cfg(target_os = "macos")]
fn macos_common_command_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
        PathBuf::from("/usr/sbin"),
        PathBuf::from("/sbin"),
    ];
    if let Some(home) = env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".local").join("bin"));
    }
    dirs
}

#[cfg(not(target_os = "macos"))]
fn configure_platform_process_path_for_codex() {}

#[cfg(windows)]
pub(super) fn hide_background_process_window(command: &mut Command) {
    // 后台额度读取只通过 stdio 通信，不需要让 Codex CLI 创建可见控制台窗口。
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(super) fn hide_background_process_window(_command: &mut Command) {}
