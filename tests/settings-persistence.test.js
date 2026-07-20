import { describe, expect, it, vi } from "vitest";

import { createSettingsPersistence } from "../src/app/settings-persistence.js";

describe("设置保存队列", () => {
  it("串行保存并把后续位置合并到最新设置", async () => {
    const firstWrite = deferred();
    const payloads = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const state = {
      settings: { theme: "default", panelPosition: null },
      settingsOpen: false
    };
    const service = createService(async (settings) => {
      payloads.push(structuredClone(settings));
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      if (payloads.length === 1) await firstWrite.promise;
      activeWrites -= 1;
      return settings;
    });
    const persistence = createPersistence(state, service);

    const first = persistence.persistSettings((current) => ({ ...current, theme: "basic1" }));
    const second = persistence.persistSettings((current) => ({
      ...current,
      panelPosition: { x: 120, y: 80 }
    }));

    await vi.waitFor(() => expect(payloads).toHaveLength(1));
    expect(service.commands.saveSettings).toHaveBeenCalledTimes(1);
    firstWrite.resolve();
    await Promise.all([first, second]);

    expect(maxActiveWrites).toBe(1);
    expect(payloads[1]).toEqual({
      theme: "basic1",
      panelPosition: { x: 120, y: 80 }
    });
    expect(state.settings).toEqual(payloads[1]);
  });

  it("单次失败不会阻断后续保存", async () => {
    const state = { settings: { theme: "default" }, settingsOpen: false };
    const service = createService();
    service.commands.saveSettings
      .mockRejectedValueOnce(new Error("磁盘写入失败"))
      .mockImplementationOnce(async (settings) => settings);
    const persistence = createPersistence(state, service);

    const failed = persistence.persistSettings((current) => ({ ...current, theme: "basic1" }));
    const succeeded = persistence.persistSettings((current) => ({ ...current, theme: "basic2" }));

    await expect(failed).rejects.toThrow("磁盘写入失败");
    await expect(succeeded).resolves.toEqual({ theme: "basic2" });
    expect(service.commands.saveSettings).toHaveBeenCalledTimes(2);
    expect(state.settings.theme).toBe("basic2");
  });

  it("设置面板打开时不覆盖草稿", async () => {
    const state = { settings: { theme: "default" }, settingsOpen: true };
    const service = createService();
    const applyNormalizedSettings = vi.fn((settings) => {
      state.settings = settings;
    });
    const persistence = createSettingsPersistence({
      state,
      service,
      applyNormalizedSettings,
      render: vi.fn()
    });

    await persistence.persistSettings(() => ({ theme: "basic3" }));

    expect(applyNormalizedSettings).toHaveBeenCalledWith(
      { theme: "basic3" },
      { syncDraft: false }
    );
  });
});

function createService(saveSettings = async (settings) => settings) {
  return {
    isAvailable: () => true,
    commands: {
      saveSettings: vi.fn(saveSettings)
    }
  };
}

function createPersistence(state, service) {
  return createSettingsPersistence({
    state,
    service,
    applyNormalizedSettings(settings) {
      state.settings = settings;
    },
    render: vi.fn()
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
