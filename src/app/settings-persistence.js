export function createSettingsPersistence({ state, service, applyNormalizedSettings, render }) {
  let saveQueue = Promise.resolve();

  function persistSettings(updateSettings, { syncDraft } = {}) {
    const operation = saveQueue.then(async () => {
      // 更新函数在真正写入前执行，确保窗口位置总是合并到最新设置，而不是旧快照。
      if (typeof updateSettings !== "function") {
        throw new TypeError("设置更新必须是函数。");
      }
      const candidate = updateSettings(state.settings);
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new TypeError("设置更新必须返回对象。");
      }

      const saved = service.isAvailable()
        ? await service.commands.saveSettings(candidate)
        : candidate;
      applyNormalizedSettings(saved, {
        syncDraft: syncDraft ?? !state.settingsOpen
      });
      render();
      return saved;
    });

    // 单次失败不能阻塞后续保存。
    saveQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  return { persistSettings };
}
