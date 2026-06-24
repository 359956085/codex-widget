use std::path::{Path, PathBuf};
use std::{fs, time::SystemTime};

use tokio::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn resolve_codex_command(codex_cli_path: Option<&Path>) -> PathBuf {
    if let Some(path) = codex_cli_path {
        return path.to_path_buf();
    }

    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("CODEX_CLI_PATH") {
        if !path.trim().is_empty() {
            candidates.push(PathBuf::from(path));
        }
    }

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let codex_bin = PathBuf::from(local_app_data)
            .join("OpenAI")
            .join("Codex")
            .join("bin");
        candidates.push(codex_bin.join("codex.exe"));

        if let Some(command) = find_codex_command_in_version_dirs(&codex_bin) {
            candidates.push(command);
        }
    }

    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from("codex.exe")
}

fn find_codex_command_in_version_dirs(codex_bin: &PathBuf) -> Option<PathBuf> {
    // Codex CLI Windows 版会把可执行文件放在 bin 下的哈希子目录中，不能只检查固定文件名。
    let entries = fs::read_dir(codex_bin).ok()?;
    let mut newest: Option<(SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let candidate = entry.path().join("codex.exe");
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

#[cfg(windows)]
pub(super) fn hide_background_process_window(command: &mut Command) {
    // 后台额度读取只通过 stdio 通信，不需要让 Codex CLI 创建可见控制台窗口。
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(super) fn hide_background_process_window(_command: &mut Command) {}
