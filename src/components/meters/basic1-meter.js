const SVG_NS = "http://www.w3.org/2000/svg";
const MARK_PATH = "M69.2 41C67.2 39.8 64.8 39.8 62.8 41L49.5 48.7C47.5 49.8 46.3 52 46.3 54.3V75.7C46.3 78 47.5 80.2 49.5 81.3L62.8 89C64.8 90.2 67.2 90.2 69.2 89L83.7 80.6C86.2 79.2 87.1 76 85.6 73.6C84.2 71.2 81.1 70.4 78.7 71.8L66 79.1L57.4 74.1V55.9L66 50.9L78.7 58.2C81.1 59.6 84.2 58.8 85.6 56.4C87.1 54 86.2 50.8 83.7 49.4L69.2 41Z";
const MARK_TRANSFORM = "translate(63 60) scale(0.72) translate(-65 -65)";

export function mount(root) {
  const meter = document.createElement("div");
  meter.className = "basic1-meter";
  const svg = svgElement("svg", { class: "basic1-gauge", viewBox: "0 0 130 130", role: "img" });
  const defs = createDefs();
  // 光晕、玻璃和折射分层绘制，避免叠加阴影产生多条同心霓虹线。
  const glow = svgElement("circle", { class: "basic1-gauge-glow", cx: 65, cy: 65, r: 60 });
  const sphere = svgElement("circle", { class: "basic1-gauge-sphere", cx: 65, cy: 65, r: 58.5 });
  const refraction = svgElement("circle", { class: "basic1-gauge-refraction", cx: 65, cy: 65, r: 57.2 });
  const inner = svgElement("g", { class: "basic1-gauge-inner" });
  const track = svgElement("circle", { class: "basic1-gauge-track", cx: 65, cy: 65, r: 47, pathLength: 100 });
  const progress = svgElement("circle", {
    class: "basic1-gauge-progress",
    cx: 65,
    cy: 65,
    r: 47,
    pathLength: 100,
    transform: "rotate(-90 65 65)"
  });
  const mark = svgElement("path", { class: "basic1-gauge-mark", transform: MARK_TRANSFORM, d: MARK_PATH });
  const percent = svgElement("text", { class: "basic1-gauge-percent", x: 65, y: 78, "text-anchor": "middle" });
  const label = svgElement("text", { class: "basic1-gauge-label", x: 65, y: 98, "text-anchor": "middle" });
  inner.append(track, progress, mark, percent, label);
  svg.append(defs, glow, sphere, refraction, inner);
  meter.append(svg);
  root.replaceChildren(meter);
  let layoutKey = "";

  function update({ percent: nextPercent, level, label: nextLabel, mode = "panel", dock = "none" }) {
    const value = typeof nextPercent === "number" ? clamp(nextPercent, 0, 100) : null;
    const displayText = value === null ? "--%" : `${Math.round(value)}%`;
    const gaugeMode = mode === "ball" ? "ball" : "panel";
    const gaugeDock = dock === "left" || dock === "right" ? dock : "none";
    meter.dataset.level = level || "unknown";
    meter.dataset.mode = gaugeMode;
    meter.dataset.dock = gaugeDock;
    progress.style.strokeDashoffset = String(100 - (value === null ? 0 : value));
    setText(percent, displayText);
    setText(label, nextLabel || "");
    const nextLayoutKey = `${gaugeMode}:${gaugeDock}`;
    if (layoutKey !== nextLayoutKey) {
      layoutKey = nextLayoutKey;
      applyLayout({ inner, mark, percent, label }, gaugeMode, gaugeDock);
    }
    svg.setAttribute("aria-label", `${nextLabel || "Quota"} ${displayText}`);
  }

  function destroy() {
    if (meter.parentNode === root) root.replaceChildren();
  }

  return { update, destroy };
}

function applyLayout(gauge, mode, dock) {
  gauge.inner.setAttribute("transform", innerTransform(mode, dock));
  gauge.mark.setAttribute("transform", MARK_TRANSFORM);
  if (mode === "panel") {
    gauge.mark.style.display = "none";
    gauge.percent.setAttribute("y", "78");
    gauge.label.setAttribute("y", "98");
    gauge.label.style.display = "";
    return;
  }
  gauge.mark.style.display = "";
  gauge.percent.setAttribute("y", "99");
  gauge.label.style.display = "none";
}

function innerTransform(mode, dock) {
  if (mode !== "ball" || dock === "none") return "";
  // 球体保持在窗口中心，只移动内部信息，让吸附后的可视半圆仍能读到额度。
  const direction = dock === "right" ? 1 : -1;
  const offsetX = -direction * 13;
  const centerX = 65 + direction * 5;
  return `translate(65 65) translate(${offsetX} 0) scale(0.82) translate(-${centerX} -65)`;
}

function createDefs() {
  const defs = svgElement("defs");
  const sphere = svgElement("radialGradient", {
    id: "basic1GaugeSphere",
    gradientUnits: "userSpaceOnUse",
    cx: 34,
    cy: 4,
    r: 128,
    fx: -24,
    fy: -22
  });
  sphere.append(
    svgElement("stop", { offset: "0%", class: "basic1-gauge-sphere-stop-a" }),
    svgElement("stop", { offset: "25%", class: "basic1-gauge-sphere-stop-b" }),
    svgElement("stop", { offset: "60%", class: "basic1-gauge-sphere-stop-c" }),
    svgElement("stop", { offset: "90%", class: "basic1-gauge-sphere-stop-d" })
  );
  const refraction = svgElement("radialGradient", {
    id: "basic1GaugeRefraction",
    gradientUnits: "userSpaceOnUse",
    cx: 99,
    cy: 100,
    r: 68,
    fx: 104,
    fy: 104
  });
  refraction.append(
    svgElement("stop", { offset: "0%", class: "basic1-gauge-refraction-stop-a" }),
    svgElement("stop", { offset: "48%", class: "basic1-gauge-refraction-stop-b" }),
    svgElement("stop", { offset: "100%", class: "basic1-gauge-refraction-stop-c" })
  );
  const accent = svgElement("linearGradient", {
    id: "basic1GaugeAccent",
    gradientUnits: "userSpaceOnUse",
    x1: 25,
    y1: 17,
    x2: 108,
    y2: 112
  });
  accent.append(
    svgElement("stop", { offset: "0%", class: "basic1-gauge-accent-stop-a" }),
    svgElement("stop", { offset: "100%", class: "basic1-gauge-accent-stop-b" })
  );
  const outerGlow = svgElement("filter", {
    id: "basic1GaugeOuterGlow",
    filterUnits: "userSpaceOnUse",
    x: -10,
    y: -10,
    width: 150,
    height: 150
  });
  outerGlow.append(svgElement("feGaussianBlur", { stdDeviation: 5.2 }));
  defs.append(sphere, refraction, accent, outerGlow);
  return defs;
}

function svgElement(tagName, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
