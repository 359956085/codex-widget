const SVG_NS = "http://www.w3.org/2000/svg";
const MARK_TRANSFORM = "translate(63 60) scale(0.65) translate(-65 -65)";
const DOCK_GAUGE_SCALE = 0.82;
const DOCK_GAUGE_OFFSET = 10;
const DOCK_GAUGE_CENTER_SHIFT = 5;

export function updateGauge({ root, percent, level, label, mode = "panel", dock = "none" }) {
  if (!root) return;

  const gauge = ensureGauge(root);
  const value = typeof percent === "number" ? clamp(percent, 0, 100) : null;
  const displayText = value === null ? "--%" : `${Math.round(value)}%`;
  const progress = value === null ? 0 : value;
  const gaugeMode = mode === "ball" ? "ball" : "panel";
  const gaugeDock = dock === "left" || dock === "right" ? dock : "none";

  setDatasetValue(root, "level", level || "unknown");
  setDatasetValue(root, "gaugeMode", gaugeMode);
  setDatasetValue(root, "gaugeDock", gaugeDock);
  setStyleValue(gauge.outerProgress, "strokeDashoffset", String(100 - progress));
  setStyleValue(gauge.progress, "strokeDashoffset", String(100 - progress));
  setText(gauge.percent, displayText);
  setText(gauge.label, label || "");
  applyGaugeLayoutIfNeeded(gauge, gaugeMode, gaugeDock);
  setAttribute(gauge.svg, "aria-label", `${label || "Quota"} ${displayText}`);
}

function ensureGauge(root) {
  if (root.__gauge) return root.__gauge;

  const svg = svgElement("svg", {
    class: "basic-gauge",
    viewBox: "0 0 130 130",
    role: "img",
    "aria-hidden": "false"
  });
  const progress = svgElement("circle", {
    class: "gauge-progress",
    cx: 65,
    cy: 65,
    r: 43,
    pathLength: 100,
    transform: "rotate(-90 65 65)"
  });
  const outerTrack = svgElement("circle", {
    class: "gauge-outer-track",
    cx: 65,
    cy: 65,
    r: 51,
    pathLength: 100,
    fill: "none",
    stroke: "none"
  });
  const outerProgress = svgElement("circle", {
    class: "gauge-outer-progress",
    cx: 65,
    cy: 65,
    r: 51,
    pathLength: 100,
    fill: "none",
    stroke: "none",
    transform: "rotate(-90 65 65)"
  });
  const inner = svgElement("g", { class: "gauge-inner" });
  const mark = svgElement("path", {
    class: "gauge-mark",
    transform: MARK_TRANSFORM,
    d: "M69.2 41C67.2 39.8 64.8 39.8 62.8 41L49.5 48.7C47.5 49.8 46.3 52 46.3 54.3V75.7C46.3 78 47.5 80.2 49.5 81.3L62.8 89C64.8 90.2 67.2 90.2 69.2 89L83.7 80.6C86.2 79.2 87.1 76 85.6 73.6C84.2 71.2 81.1 70.4 78.7 71.8L66 79.1L57.4 74.1V55.9L66 50.9L78.7 58.2C81.1 59.6 84.2 58.8 85.6 56.4C87.1 54 86.2 50.8 83.7 49.4L69.2 41Z"
  });
  const percent = svgElement("text", { class: "gauge-percent", x: 65, y: 96, "text-anchor": "middle" });
  const label = svgElement("text", { class: "gauge-label", x: 65, y: 111, "text-anchor": "middle" });
  inner.append(
    svgElement("circle", { class: "gauge-track", cx: 65, cy: 65, r: 43, pathLength: 100 }),
    progress,
    mark,
    percent,
    label
  );

  svg.append(
    createDefs(),
    svgElement("circle", { class: "gauge-glow", cx: 65, cy: 65, r: 58 }),
    svgElement("circle", { class: "gauge-sphere", cx: 65, cy: 65, r: 56 }),
    svgElement("path", { class: "gauge-glass-sheen", d: "M24 59c4-22 20-38 43-42 17-3 31 2 41 11-13-3-30-2-47 6-17 8-29 18-37 25Z" }),
    outerTrack,
    outerProgress,
    inner
  );

  root.replaceChildren(svg);
  root.__gauge = { svg, inner, outerProgress, progress, mark, percent, label, layoutKey: "" };
  return root.__gauge;
}

function applyGaugeLayoutIfNeeded(gauge, mode, dock) {
  const layoutKey = `${mode}:${dock}`;
  if (gauge.layoutKey === layoutKey) return;
  gauge.layoutKey = layoutKey;
  applyGaugeLayout(gauge, mode, dock);
}

function applyGaugeLayout(gauge, mode, dock) {
  setAttribute(gauge.inner, "transform", innerTransform(mode, dock));
  setAttribute(gauge.mark, "transform", MARK_TRANSFORM);
  setAttribute(gauge.percent, "x", "65");
  setAttribute(gauge.percent, "text-anchor", "middle");
  setAttribute(gauge.label, "x", "65");
  setAttribute(gauge.label, "text-anchor", "middle");

  if (mode === "panel") {
    setStyleValue(gauge.mark, "display", "none");
    setAttribute(gauge.percent, "y", "75");
    setAttribute(gauge.label, "y", "96");
    setStyleValue(gauge.label, "display", "");
    return;
  }

  setStyleValue(gauge.mark, "display", "");
  setAttribute(gauge.percent, "y", "96");
  setAttribute(gauge.label, "y", "111");
  setStyleValue(gauge.label, "display", "none");
}

function innerTransform(mode, dock) {
  if (mode !== "ball" || dock === "none") return "";
  const direction = dock === "right" ? 1 : -1;
  const offsetX = -direction * DOCK_GAUGE_OFFSET;
  const centerX = 65 + direction * DOCK_GAUGE_CENTER_SHIFT;
  return `translate(65 65) translate(${offsetX} 0) scale(${DOCK_GAUGE_SCALE}) translate(-${centerX} -65)`;
}

function createDefs() {
  const defs = svgElement("defs");

  const sphere = svgElement("radialGradient", { id: "basicGaugeSphere", cx: "25%", cy: "0%", r: "92%" });
  sphere.append(
    svgElement("stop", { offset: "0%", class: "gauge-sphere-stop-a" }),
    svgElement("stop", { offset: "44%", class: "gauge-sphere-stop-b" }),
    svgElement("stop", { offset: "100%", class: "gauge-sphere-stop-c" })
  );

  const accent = svgElement("linearGradient", { id: "basicGaugeAccent", x1: "22", y1: "18", x2: "108", y2: "112" });
  accent.append(
    svgElement("stop", { offset: "0%", class: "gauge-accent-stop-a" }),
    svgElement("stop", { offset: "100%", class: "gauge-accent-stop-b" })
  );

  defs.append(sphere, accent);
  return defs;
}

function svgElement(tagName, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  Object.entries(attrs).forEach(([name, value]) => {
    element.setAttribute(name, String(value));
  });
  return element;
}

function setDatasetValue(element, key, value) {
  if (element.dataset[key] !== value) {
    element.dataset[key] = value;
  }
}

function setText(element, value) {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function setStyleValue(element, property, value) {
  if (element.style[property] !== value) {
    element.style[property] = value;
  }
}

function setAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
