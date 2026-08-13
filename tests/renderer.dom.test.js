// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createElements } from "../src/app/dom.js";
import { createRenderer } from "../src/app/render.js";
import { createAppState } from "../src/app/state.js";
import { loadApplicationMarkup } from "./dom-test-utils.js";

describe("界面渲染", () => {
  let els;
  let state;
  let renderer;

  beforeEach(() => {
    loadApplicationMarkup();
    els = createElements();
    state = createAppState();
    renderer = createRenderer({
      els,
      state,
      getLocale: () => "zh",
      getTheme: () => state.settings.theme,
      onVersionClick: vi.fn(),
      settingsView: { renderSettingsPanel: vi.fn() }
    });
  });

  it("按设置、窗口、额度顺序展示错误", () => {
    state.errors.settings = "设置错误";
    state.errors.window = "窗口错误";
    state.errors.quota = "额度错误";
    renderer.render();
    expect(els.statusText.textContent).toBe("设置错误");

    state.errors.settings = "";
    renderer.render();
    expect(els.statusText.textContent).toBe("窗口错误");

    state.errors.window = "";
    renderer.render();
    expect(els.statusText.textContent).toBe("额度错误");
  });

  it("只在悬浮球模式提供按钮语义和键盘焦点", () => {
    state.widgetMode = "ball";
    renderer.render();
    expect(els.widget.getAttribute("role")).toBe("button");
    expect(els.widget.tabIndex).toBe(0);

    state.widgetMode = "panel";
    renderer.render();
    expect(els.widget.hasAttribute("role")).toBe(false);
    expect(els.widget.hasAttribute("tabindex")).toBe(false);
  });
});
