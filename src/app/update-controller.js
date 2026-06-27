import { UPDATE_CHECK_INTERVAL_MS } from "./constants.js";

const TRANSIENT_STATUS_DURATION_MS = 1800;
const TRANSIENT_STATUS_TYPES = new Set(["latest", "saved", "checkFailed", "updateFailed"]);

export function createUpdateController({ state, service, render, logger }) {
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
      const update = await readAvailableUpdate();
      if (!update) {
        if (manual) {
          setUpdateStatus({ type: "latest" });
        } else {
          clearUpdateStatus();
        }
        return;
      }

      setUpdateStatus({ type: "available", version: update.version });
      try {
        await downloadAndInstallUpdate(update);
      } catch (error) {
        logger?.error("更新失败", error, "frontend.update");
        setUpdateStatus({ type: "updateFailed" });
        return;
      }
      setUpdateStatus({ type: "ready" });
    } catch (error) {
      logger?.error("获取版本失败", error, "frontend.update");
      setUpdateStatus({ type: "checkFailed" });
    } finally {
      state.updateChecking = false;
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

  async function readAvailableUpdate() {
    return service.updater.check(updateCheckOptions());
  }

  function setUpdateStatus(nextStatus) {
    if (isSameUpdateStatus(state.updateStatus, nextStatus)) {
      if (isTransientStatus(nextStatus)) {
        scheduleTransientStatusClear(nextStatus.type);
      }
      return;
    }

    if (!isTransientStatus(nextStatus)) {
      clearTransientStatusTimer();
    }
    state.updateStatus = nextStatus;
    render();
    if (isTransientStatus(nextStatus)) {
      scheduleTransientStatusClear(nextStatus.type);
    }
  }

  function clearUpdateStatus() {
    clearTransientStatusTimer();
    if (state.updateStatus === null) return;
    state.updateStatus = null;
    render();
  }

  function isTransientStatus(status) {
    return TRANSIENT_STATUS_TYPES.has(status?.type);
  }

  function isSameUpdateStatus(currentStatus, nextStatus) {
    if (!currentStatus || !nextStatus) return currentStatus === nextStatus;
    return (
      currentStatus.type === nextStatus.type &&
      currentStatus.version === nextStatus.version &&
      currentStatus.percent === nextStatus.percent
    );
  }

  function scheduleTransientStatusClear(statusType) {
    clearTransientStatusTimer();
    state.transientStatusTimer = window.setTimeout(() => {
      state.transientStatusTimer = null;
      if (state.updateStatus?.type === statusType) {
        clearUpdateStatus();
      }
    }, TRANSIENT_STATUS_DURATION_MS);
  }

  function clearTransientStatusTimer() {
    if (!state.transientStatusTimer) return;
    window.clearTimeout(state.transientStatusTimer);
    state.transientStatusTimer = null;
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
