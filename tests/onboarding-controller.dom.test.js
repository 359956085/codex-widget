// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { i18n } from "../src/app/constants.js";
import { createElements } from "../src/app/dom.js";
import { createOnboardingController } from "../src/app/onboarding-controller.js";
import { createAppState } from "../src/app/state.js";
import { loadApplicationMarkup } from "./dom-test-utils.js";

describe("功能引导键盘交互", () => {
  it("打开后聚焦，Escape 关闭并恢复焦点", async () => {
    loadApplicationMarkup();
    const els = createElements();
    const state = createAppState();
    const saveCurrentSettings = vi.fn().mockResolvedValue(undefined);
    const applyNormalizedSettings = vi.fn((settings) => {
      state.settings = settings;
    });
    const controller = createOnboardingController({
      els,
      state,
      renderLocale: () => "zh",
      renderTheme: () => "default",
      applyNormalizedSettings,
      saveCurrentSettings,
      i18n
    });
    controller.bindEvents();
    els.modeBtn.focus();

    await controller.runInitialOnboarding();
    expect(els.onboardingOverlay.hidden).toBe(false);
    expect(document.activeElement).toBe(els.onboardingNextBtn);

    els.onboardingNextBtn.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true
    }));
    await vi.waitFor(() => expect(saveCurrentSettings).toHaveBeenCalledOnce());

    expect(els.onboardingOverlay.hidden).toBe(true);
    expect(document.activeElement).toBe(els.modeBtn);
    expect(applyNormalizedSettings).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingSeen: true }),
      { syncDraft: true }
    );
  });
});
