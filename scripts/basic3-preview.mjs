import "../src/styles.css";
import "../src/themes.css";
import applicationMarkup from "../index.html?raw";
import { createElements } from "../src/app/dom.js";
import { initializeActionIcons } from "../src/app/icons.js";
import { createRenderer } from "../src/app/render.js";
import { createSettingsController } from "../src/app/settings-controller.js";
import { createSettingsPersistence } from "../src/app/settings-persistence.js";
import { createWindowController } from "../src/app/window-controller.js";
import { createTooltipController } from "../src/app/tooltip-controller.js";
import { createAppState, applyNormalizedSettings, renderLocale, renderTheme } from "../src/app/state.js";

const params = new URLSearchParams(location.search);
if (params.has("frame")) {
  mountPreview();
} else {
  mountGallery();
}

function mountGallery() {
  const style = document.createElement("style");
  style.textContent = `
    html, body { height: auto; overflow: auto; background: #fceff4; color: #711231; }
    body { padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 28px; text-align: center; }
    p { margin: 0 0 20px; font-size: 13px; text-align: center; color: #99506b; }
    .gallery-controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; margin: 20px 0; font-size: 12px; }
    .gallery-controls select { margin-left: 6px; background: white; color: #711231; border: 1px solid #d69bb3; border-radius: 5px; }
    .preview-grid { display: grid; grid-template-columns: repeat(2, max-content); gap: 20px 26px; justify-content: center; }
    .preview-item { margin: 0; }
    .preview-item figcaption { margin: 0 0 6px 8px; font-size: 12px; }
    iframe { display: block; border: 0; background: transparent; }
    .preview-item iframe { border-radius: 13px; box-shadow: 0 5px 9px #91113c35, 0 0 9px #ff87bb40; }
    .preview-balls { display: flex; justify-content: space-evenly; margin: 24px auto 0; padding: 16px; border: 1px solid #edc0d2; border-radius: 12px; max-width: 1000px; }
    .preview-ball { text-align: center; font-size: 12px; }
    .preview-ball iframe { margin: 0 auto 6px; }
  `;
  document.head.append(style);
  document.body.innerHTML = `
    <h1>基础主题3 · 霓虹粉玻璃</h1>
    <p>真实组件 · 面板 390×236 · 悬浮球 88×88 · 保留全部数据项</p>
    <div class="gallery-controls">
      <label>缩放<select id="previewScale"><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></label>
      <label>语言<select id="previewLocale"><option value="zh">中文</option><option value="en">English</option></select></label>
      <label>数据栏<select id="previewData"><option value="resetCredits">窗口与重置次数</option><option value="quotaEstimate">窗口与额度估算</option></select></label>
      <label>场景<select id="previewScenario"><option value="normal">四档额度</option><option value="edge">边界与异常</option><option value="dock">左右贴边</option></select></label>
    </div>
    <div class="preview-grid"></div><div class="preview-balls"></div>
  `;
  const update = () => {
    const scale = Number(document.getElementById("previewScale").value);
    const locale = document.getElementById("previewLocale").value;
    const data = document.getElementById("previewData").value;
    const scenario = document.getElementById("previewScenario").value;
    const values = scenario === "edge" ? ["0", "10", "unknown", "error"] : ["100", "90", "60", "30"];
    const grid = document.querySelector(".preview-grid");
    const balls = document.querySelector(".preview-balls");
    grid.replaceChildren();
    balls.replaceChildren();
    values.forEach((percent, index) => {
      const createFrame = (mode) => {
        const frame = document.createElement("iframe");
        const query = new URLSearchParams({ frame: mode, percent, locale, data, scale });
        if (scenario === "dock" && mode === "ball") query.set("dock", index % 2 ? "right" : "left");
        frame.src = `./basic3-preview.html?${query}`;
        frame.title = `${mode === "ball" ? "悬浮球" : "面板"} ${percent}`;
        frame.width = (mode === "ball" ? 88 : 390) * scale;
        frame.height = (mode === "ball" ? 88 : 236) * scale;
        return frame;
      };
      const item = document.createElement("figure");
      item.className = "preview-item";
      const caption = document.createElement("figcaption");
      caption.textContent = `${index + 1}. ${percent.match(/^\d+$/) ? percent + "% 剩余" : percent === "error" ? "读取失败" : "无数据"}`;
      item.append(caption, createFrame("panel"));
      grid.append(item);
      const ball = document.createElement("div");
      ball.className = "preview-ball";
      ball.append(createFrame("ball"), caption.cloneNode(true));
      balls.append(ball);
    });
  };
  document.querySelectorAll("select").forEach((select) => select.addEventListener("change", update));
  update();
}

function mountPreview() {
  // 仅在独立验收页面注入夹具，生产入口和真实账户数据保持原样。
  const markup = new DOMParser().parseFromString(applicationMarkup, "text/html");
  markup.querySelectorAll("script").forEach((script) => script.remove());
  document.body.replaceChildren(...markup.body.childNodes);
  document.body.style.zoom = String(Number(params.get("scale")) || 1);
  const state = createAppState();
  applyNormalizedSettings(state, {
    ...state.settings, theme: "basic3", locale: params.get("locale") || "zh",
    widgetMode: params.get("frame") === "ball" ? "ball" : "panel",
    meterWindow: "primary", dataBars: ["fiveHour", "weekly", params.get("data") || "resetCredits"]
  });
  state.ballDock = params.get("dock") || null;
  const value = Number(params.get("percent"));
  state.quota = Number.isFinite(value) ? {
    planType: "plus", fetchedAt: "2026-09-07T03:09:00Z",
    primary: { remainingPercent: value, windowDurationMins: 300, resetsAt: "2026-09-07T06:01:00Z" },
    secondary: { remainingPercent: value, windowDurationMins: 10080, resetsAt: "2026-09-10T00:28:00Z" },
    resetCredits: { availableCount: 3 },
    quotaEstimate: { previous: { status: "ready", fullQuotaUsd: 125 }, current: { status: "ready", fullQuotaUsd: 148 } }
  } : null;
  if (params.get("percent") === "error") state.errors.quota = "无法读取额度，请重试";
  if (params.get("percent") === "loading") state.loading = true;
  const els = createElements();
  // 验收页面模拟屏幕裁切，检查可见半球中的文字，不改变真实吸附行为。
  const dockStyle = document.createElement("style");
  dockStyle.textContent = 'body[data-widget-mode="ball"][data-ball-dock="left"] .widget { clip-path: inset(0 0 0 50%); } body[data-widget-mode="ball"][data-ball-dock="right"] .widget { clip-path: inset(0 50% 0 0); }';
  document.head.append(dockStyle);
  initializeActionIcons(els);
  const service = {
    isAvailable: () => false,
    commands: { hideWindow: async () => {}, closeApp: async () => {} }
  };
  let renderer;
  const render = () => renderer.render();
  const { persistSettings } = createSettingsPersistence({
    state, service, render,
    applyNormalizedSettings: (settings, options) => applyNormalizedSettings(state, settings, options)
  });
  const windows = createWindowController({ els, state, service, render, persistSettings });
  const settings = createSettingsController({
    els, state, service, render, persistSettings, renderLocale: () => renderLocale(state),
    normalizeError: (error) => String(error), readCurrentWindowPosition: windows.readCurrentWindowPosition,
    mergeWindowPosition: windows.mergeWindowPosition, clearPanelClick: windows.clearPanelClick,
    setUpdateStatus: () => {}, scheduleAutoRefresh: () => {}, refreshQuota: () => {}, scheduleUpdateChecks: () => {}
  });
  renderer = createRenderer({
    els, state, getLocale: () => renderLocale(state), getTheme: () => renderTheme(state),
    onVersionClick: () => {}, settingsView: settings
  });
  settings.bindEvents();
  windows.bindEvents();
  createTooltipController({ root: els.body }).bindEvents();
  els.pinBtn.addEventListener("click", () => { state.alwaysOnTop = !state.alwaysOnTop; render(); });
  render();
}
