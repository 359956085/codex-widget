import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { availableMonitors, currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";

export function createTauriService() {
  return {
    isAvailable,
    commands: {
      closeApp: () => invoke("close_app"),
      getAlwaysOnTop: () => invoke("get_always_on_top"),
      getQuota: () => invoke("get_quota"),
      getSettings: () => invoke("get_settings"),
      hideWindow: () => invoke("hide_window"),
      saveSettings: (settings) => invoke("save_settings", { settings }),
      setAlwaysOnTop: (value) => invoke("set_always_on_top", { value }),
      writeFrontendLog: (level, message, context) => invoke("write_frontend_log", { level, message, context })
    },
    dialog: {
      chooseCodexPath: () =>
        openDialog({
          multiple: false,
          directory: false
        })
    },
    updater: {
      check: (options) => check(options)
    },
    events: {
      listen
    },
    window: {
      availableMonitors,
      currentMonitor,
      onMoved: (handler) => getCurrentWindow().onMoved(handler),
      outerPosition: () => getCurrentWindow().outerPosition(),
      outerSize: () => getCurrentWindow().outerSize(),
      scaleFactor: () => getCurrentWindow().scaleFactor(),
      setPosition: (position) => getCurrentWindow().setPosition(new PhysicalPosition(position.x, position.y)),
      setSize: (size) => getCurrentWindow().setSize(new LogicalSize(size.width, size.height)),
      startDragging: () => getCurrentWindow().startDragging()
    }
  };
}

function isAvailable() {
  return Boolean(window.__TAURI_INTERNALS__);
}
