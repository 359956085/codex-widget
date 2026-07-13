import { mount as mountDefaultMeter } from "./default-meter.js";
import { mount as mountBasic1Meter } from "./basic1-meter.js";
import { mount as mountBasic2Meter } from "./basic2-meter.js";
import { mount as mountBasic3Meter } from "./basic3-meter.js";

const METER_FACTORIES = {
  default: mountDefaultMeter,
  basic1: mountBasic1Meter,
  basic2: mountBasic2Meter,
  basic3: mountBasic3Meter
};

export function createMeterController(root) {
  let activeTheme = null;
  let activeMeter = null;

  function update({ theme, ...payload }) {
    if (!root) return;

    const nextTheme = Object.hasOwn(METER_FACTORIES, theme) ? theme : "default";
    if (activeTheme !== nextTheme) {
      // 主题 SVG 的结构和渐变 ID 完全独立，切换时必须重建，避免残留旧主题节点。
      activeMeter?.destroy();
      root.replaceChildren();
      activeMeter = METER_FACTORIES[nextTheme](root);
      activeTheme = nextTheme;
    }

    activeMeter.update(payload);
  }

  function destroy() {
    activeMeter?.destroy();
    root?.replaceChildren();
    activeMeter = null;
    activeTheme = null;
  }

  return { update, destroy };
}
