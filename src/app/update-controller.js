import { UPDATE_CHECK_INTERVAL_MS } from "./constants.js";

export function createUpdateController({ state, service, render }) {
  function scheduleUpdateChecks() {
    if (state.updateTimer) window.clearInterval(state.updateTimer);
    state.updateTimer = null;
    if (!state.settings.autoUpdateEnabled) {
      clearUpdateStatus();
      return;
    }

    checkForUpdates();
    state.updateTimer = window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
  }

  async function checkForUpdates({ manual = false } = {}) {
    if (!service.isAvailable() || state.updateChecking || (!manual && !state.settings.autoUpdateEnabled)) return;

    state.updateChecking = true;
    setUpdateStatus({ type: "checking" });

    try {
      const update = await service.updater.check(updateCheckOptions());
      if (!update) {
        if (manual) {
          setUpdateStatus({ type: "latest" });
        } else {
          clearUpdateStatus();
        }
        return;
      }

      setUpdateStatus({ type: "available", version: update.version });
      await downloadAndInstallUpdate(update);
      setUpdateStatus({ type: "ready" });
    } catch (error) {
      console.error("自动更新失败", error);
      setUpdateStatus({ type: "failed" });
    } finally {
      state.updateChecking = false;
      render();
    }
  }

  async function downloadAndInstallUpdate(update) {
    let downloadedBytes = 0;
    let totalBytes = 0;

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        downloadedBytes = 0;
        totalBytes = event.data?.contentLength || 0;
        setUpdateStatus({ type: "downloading", percent: null });
        return;
      }

      if (event.event === "Progress") {
        downloadedBytes += event.data?.chunkLength || 0;
        const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null;
        setUpdateStatus({ type: "downloading", percent });
        return;
      }

      if (event.event === "Finished") {
        setUpdateStatus({ type: "installing" });
      }
    });
  }

  function setUpdateStatus(nextStatus) {
    if (nextStatus?.type !== "latest") {
      clearLatestStatusTimer();
    }
    state.updateStatus = nextStatus;
    render();
    if (nextStatus?.type === "latest") {
      scheduleLatestStatusClear();
    }
  }

  function clearUpdateStatus() {
    clearLatestStatusTimer();
    state.updateStatus = null;
    render();
  }

  function scheduleLatestStatusClear() {
    clearLatestStatusTimer();
    state.latestStatusTimer = window.setTimeout(() => {
      state.latestStatusTimer = null;
      if (state.updateStatus?.type === "latest") {
        clearUpdateStatus();
      }
    }, 1800);
  }

  function clearLatestStatusTimer() {
    if (!state.latestStatusTimer) return;
    window.clearTimeout(state.latestStatusTimer);
    state.latestStatusTimer = null;
  }

  function updateCheckOptions() {
    const proxy = state.settings.updateProxy?.trim();
    return proxy ? { proxy } : undefined;
  }

  return {
    checkForUpdates,
    scheduleUpdateChecks,
    setUpdateStatus
  };
}
