const SVG_NS = "http://www.w3.org/2000/svg";
const MARK_TRANSFORM = "translate(63 60) scale(0.65) translate(-65 -65)";
const MARK_PATH = "M69.2 41C67.2 39.8 64.8 39.8 62.8 41L49.5 48.7C47.5 49.8 46.3 52 46.3 54.3V75.7C46.3 78 47.5 80.2 49.5 81.3L62.8 89C64.8 90.2 67.2 90.2 69.2 89L83.7 80.6C86.2 79.2 87.1 76 85.6 73.6C84.2 71.2 81.1 70.4 78.7 71.8L66 79.1L57.4 74.1V55.9L66 50.9L78.7 58.2C81.1 59.6 84.2 58.8 85.6 56.4C87.1 54 86.2 50.8 83.7 49.4L69.2 41Z";

export function mount(root) {
  const meter = document.createElement("div");
  meter.className = "basic3-meter";
  const svg = svgElement("svg", { class: "basic3-gauge", viewBox: "0 0 130 130", role: "img" });
  const progress = svgElement("circle", {
    class: "basic3-gauge-progress",
    cx: 65,
    cy: 65,
    r: 43,
    pathLength: 100,
    transform: "rotate(-90 65 65)"
  });
  const outerProgress = svgElement("circle", {
    class: "basic3-gauge-outer-progress",
    cx: 65,
    cy: 65,
    r: 51,
    pathLength: 100,
    transform: "rotate(-90 65 65)"
  });
  const inner = svgElement("g", { class: "basic3-gauge-inner" });
  const mark = svgElement("path", { class: "basic3-gauge-mark", transform: MARK_TRANSFORM, d: MARK_PATH });
  const percent = svgElement("text", { class: "basic3-gauge-percent", x: 65, y: 96, "text-anchor": "middle" });
  const label = svgElement("text", { class: "basic3-gauge-label", x: 65, y: 111, "text-anchor": "middle" });
  inner.append(
    svgElement("circle", { class: "basic3-gauge-track", cx: 65, cy: 65, r: 43, pathLength: 100 }),
    progress,
    mark,
    percent,
    label
  );
  svg.append(
    createDefs(),
    svgElement("circle", { class: "basic3-gauge-glow", cx: 65, cy: 65, r: 58 }),
    svgElement("circle", { class: "basic3-gauge-sphere", cx: 65, cy: 65, r: 56 }),
    svgElement("path", { class: "basic3-gauge-sheen", d: "M24 59c4-22 20-38 43-42 17-3 31 2 41 11-13-3-30-2-47 6-17 8-29 18-37 25Z" }),
    svgElement("circle", { class: "basic3-gauge-outer-track", cx: 65, cy: 65, r: 51, pathLength: 100 }),
    outerProgress,
    inner
  );
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
    const dashOffset = String(100 - (value === null ? 0 : value));
    outerProgress.style.strokeDashoffset = dashOffset;
    progress.style.strokeDashoffset = dashOffset;
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
    gauge.percent.setAttribute("y", "75");
    gauge.label.setAttribute("y", "96");
    gauge.label.style.display = "";
    return;
  }
  gauge.mark.style.display = "";
  gauge.percent.setAttribute("y", "96");
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
  const sphere = svgElement("radialGradient", { id: "basic3GaugeSphere", cx: "25%", cy: "0%", r: "92%" });
  sphere.append(
    svgElement("stop", { offset: "0%", class: "basic3-gauge-sphere-stop-a" }),
    svgElement("stop", { offset: "44%", class: "basic3-gauge-sphere-stop-b" }),
    svgElement("stop", { offset: "100%", class: "basic3-gauge-sphere-stop-c" })
  );
  const accent = svgElement("linearGradient", { id: "basic3GaugeAccent", x1: "22", y1: "18", x2: "108", y2: "112" });
  accent.append(
    svgElement("stop", { offset: "0%", class: "basic3-gauge-accent-stop-a" }),
    svgElement("stop", { offset: "100%", class: "basic3-gauge-accent-stop-b" })
  );
  defs.append(sphere, accent);
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
