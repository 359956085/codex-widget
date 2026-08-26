use std::env;
#[cfg(target_os = "macos")]
use std::ffi::OsString;
use std::path::{Path, PathBuf};
#[cfg(any(windows, target_os = "macos"))]
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
        if is_usable_command_file(&candidate) {
            return candidate;
        }
    }

    PathBuf::from(CODEX_COMMAND_NAME)
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
    if let Some(path) = find_macos_nvm_codex_command() {
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
        if !is_usable_command_file(&candidate) {
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
        if is_usable_command_file(&candidate) {
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
fn find_macos_nvm_codex_command() -> Option<PathBuf> {
    let home = env::var_os("HOME")?;
    let versions_dir = PathBuf::from(home)
        .join(".nvm")
        .join("versions")
        .join("node");
    find_newest_macos_nvm_codex_command(&versions_dir)
}

#[cfg(target_os = "macos")]
fn find_newest_macos_nvm_codex_command(versions_dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(versions_dir).ok()?;
    let mut newest: Option<(SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let candidate = entry.path().join("bin").join(CODEX_COMMAND_NAME);
        if !is_usable_command_file(&candidate) {
            continue;
        }

        let modified_at = candidate
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let should_replace = match &newest {
            None => true,
            Some((current_time, current_path)) => {
                modified_at > *current_time
                    || (modified_at == *current_time && candidate < *current_path)
            }
        };
        if should_replace {
            newest = Some((modified_at, candidate));
        }
    }

    newest.map(|(_, path)| path)
}

#[cfg(target_os = "macos")]
fn codex_process_path(codex_command: &Path) -> Option<OsString> {
    let mut paths = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    if let Some(parent) = codex_command
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        // NVM 的 codex 通过 `/usr/bin/env node` 启动，必须先让它找到同目录的 Node。
        paths.retain(|path| path != parent);
        paths.insert(0, parent.to_path_buf());
    }
    for dir in macos_common_command_dirs() {
        if !paths.iter().any(|path| path == &dir) {
            paths.push(dir);
        }
    }
    env::join_paths(paths).ok()
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

#[cfg(target_os = "macos")]
pub(super) fn configure_codex_process_environment(command: &mut Command, codex_command: &Path) {
    if let Some(path) = codex_process_path(codex_command) {
        // 只修改 Codex 子进程环境，避免 Tauri 多线程运行期改写全局 PATH。
        command.env("PATH", path);
    }
}

#[cfg(not(target_os = "macos"))]
pub(super) fn configure_codex_process_environment(_command: &mut Command, _codex_command: &Path) {}

#[cfg(target_os = "macos")]
pub fn configure_open_codex_process_environment(
    command: &mut std::process::Command,
    codex_command: &Path,
) {
    if let Some(path) = codex_process_path(codex_command) {
        command.env("PATH", path);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn configure_open_codex_process_environment(
    _command: &mut std::process::Command,
    _codex_command: &Path,
) {
}

fn is_usable_command_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    is_executable_file(path)
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(_path: &Path) -> bool {
    true
}

#[cfg(windows)]
pub(super) fn hide_background_process_window(command: &mut Command) {
    // 后台额度读取只通过 stdio 通信，不需要让 Codex CLI 创建可见控制台窗口。
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(super) fn hide_background_process_window(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 目录不能作为_codex_命令() {
        let dir = tempfile::tempdir().unwrap();

        assert!(!is_usable_command_file(dir.path()));
    }

    #[cfg(unix)]
    #[test]
    fn unix_命令必须有可执行权限() {
        use std::fs;

        let dir = tempfile::tempdir().unwrap();
        let command = dir.path().join("codex");
        fs::write(&command, "").unwrap();

        assert!(!is_usable_command_file(&command));

        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&command).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&command, permissions).unwrap();
        assert!(is_usable_command_file(&command));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_nvm_选择修改时间最新的可执行命令() {
        use std::fs::{self, File, FileTimes};
        use std::os::unix::fs::PermissionsExt;
        use std::time::{Duration, SystemTime};

        let dir = tempfile::tempdir().unwrap();
        let old_command = create_nvm_codex_for_test(dir.path(), "v22.0.0");
        let new_command = create_nvm_codex_for_test(dir.path(), "v24.14.0");
        File::options()
            .write(true)
            .open(&old_command)
            .unwrap()
            .set_times(
                FileTimes::new().set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1)),
            )
            .unwrap();
        File::options()
            .write(true)
            .open(&new_command)
            .unwrap()
            .set_times(
                FileTimes::new().set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(2)),
            )
            .unwrap();

        let invalid = dir.path().join("v25.0.0").join("bin").join("codex");
        fs::create_dir_all(invalid.parent().unwrap()).unwrap();
        fs::write(&invalid, "#!/bin/sh\n").unwrap();
        let mut permissions = fs::metadata(&invalid).unwrap().permissions();
        permissions.set_mode(0o644);
        fs::set_permissions(&invalid, permissions).unwrap();
        fs::create_dir_all(dir.path().join("v26.0.0").join("bin").join("codex")).unwrap();

        assert_eq!(
            find_newest_macos_nvm_codex_command(dir.path()),
            Some(new_command)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_nvm_修改时间相同时按路径稳定选择() {
        use std::fs::{File, FileTimes};
        use std::time::{Duration, SystemTime};

        let dir = tempfile::tempdir().unwrap();
        let first = create_nvm_codex_for_test(dir.path(), "v22.0.0");
        let second = create_nvm_codex_for_test(dir.path(), "v24.0.0");
        let modified_at = SystemTime::UNIX_EPOCH + Duration::from_secs(1);
        for command in [&first, &second] {
            File::options()
                .write(true)
                .open(command)
                .unwrap()
                .set_times(FileTimes::new().set_modified(modified_at))
                .unwrap();
        }

        assert_eq!(find_newest_macos_nvm_codex_command(dir.path()), Some(first));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_子进程_path_优先包含命令父目录且不重复() {
        let command = PathBuf::from("/Users/test/.nvm/versions/node/v24/bin/codex");
        let path = codex_process_path(&command).unwrap();
        let paths = env::split_paths(&path).collect::<Vec<_>>();
        let parent = command.parent().unwrap();

        assert_eq!(paths.first().map(PathBuf::as_path), Some(parent));
        assert_eq!(
            paths.iter().filter(|path| path.as_path() == parent).count(),
            1
        );
        assert!(paths.contains(&PathBuf::from("/usr/bin")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_nvm_codex_可通过同目录_env_node_启动() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let codex = dir.path().join("codex");
        let node = dir.path().join("node");
        fs::write(&codex, "#!/usr/bin/env node\n").unwrap();
        fs::write(&node, "#!/bin/sh\nexit 0\n").unwrap();
        for path in [&codex, &node] {
            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).unwrap();
        }

        let mut command = std::process::Command::new(&codex);
        configure_open_codex_process_environment(&mut command, &codex);

        assert!(command.status().unwrap().success());
    }

    #[cfg(target_os = "macos")]
    fn create_nvm_codex_for_test(versions_dir: &Path, version: &str) -> PathBuf {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let command = versions_dir.join(version).join("bin").join("codex");
        fs::create_dir_all(command.parent().unwrap()).unwrap();
        fs::write(&command, "#!/bin/sh\n").unwrap();
        let mut permissions = fs::metadata(&command).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&command, permissions).unwrap();
        command
    }
}
