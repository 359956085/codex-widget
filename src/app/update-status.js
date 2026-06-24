export function formatUpdateStatus(text, status) {
  if (!status) return "";
  if (status.type === "checking") return text.checkingUpdate;
  if (status.type === "available") {
    return status.version ? `${text.updateAvailable} ${status.version}` : text.updateAvailable;
  }
  if (status.type === "downloading") {
    return typeof status.percent === "number" ? `${text.updateDownloading} ${status.percent}%` : text.updateDownloading;
  }
  if (status.type === "installing") return text.updateInstalling;
  if (status.type === "ready") return text.updateReady;
  if (status.type === "failed") return text.updateFailed;
  if (status.type === "latest") return text.updateLatest;
  if (status.type === "saved") return text.settingsSaved;
  return "";
}
