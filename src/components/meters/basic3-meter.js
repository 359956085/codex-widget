const SVG_NS = "http://www.w3.org/2000/svg";
let nextInstance = 0;

export function mount(root) {
  const id = `basic3-${++nextInstance}`;
  const paint = (name) => `url(#${id}-${name})`;
  const meter = document.createElement("div");
  meter.className = "basic3-meter";
  const svg = svgElement("svg", { class: "basic3-gauge", viewBox: "0 0 130 130", role: "img" });
  const liquid = svgElement("path", { class: "basic3-liquid", fill: paint("liquid") });
  const surface = svgElement("path", { class: "basic3-liquid-surface", fill: "none" });
  const rear = svgElement("path", { class: "basic3-liquid-rear", fill: "none" });
  const liquidClip = svgElement("g", { "clip-path": paint("clip") });
  liquidClip.append(liquid, rear, surface);
  const inner = svgElement("g", { class: "basic3-gauge-inner" });
  const mark = svgElement("g", { class: "basic3-gauge-mark", transform: "translate(65 58) scale(0.8) translate(-65 -58)" });
  const markPath = "M65 32 83 42 77 49 65 42 53 49 53 63 65 70 77 63 84 70 65 81 44 69 44 43Z";
  mark.append(
    svgElement("path", { d: markPath, fill: "#851443", stroke: "#ff72ae", "stroke-width": 0.7, transform: "translate(0 3)" }),
    svgElement("path", { d: markPath, fill: paint("mark"), stroke: "#ffe5f2", "stroke-width": 0.8 }),
    svgElement("path", { d: "M45 44 65 33 81 42 M45 44V68L65 80 M54 50V62L65 69", fill: "none", stroke: "#fff6fb", "stroke-width": 0.7, opacity: 0.8 })
  );
  const percent = svgElement("text", { class: "basic3-gauge-percent", x: 65, "text-anchor": "middle" });
  const label = svgElement("text", { class: "basic3-gauge-label", x: 65, y: 90, "text-anchor": "middle" });
  inner.append(mark, percent, label);
  svg.append(
    createDefs(id),
    circle(59, { class: "basic3-gauge-aura", stroke: "#ff3d8a", filter: paint("glow") }),
    circle(60.5, { class: "basic3-gauge-outline", stroke: "#ad4167" }),
    circle(57.5, { fill: "none", stroke: "#310f24", "stroke-width": 3.4 }),
    circle(56.8, { fill: "none", stroke: "#ff3f8c", "stroke-width": 0.7 }),
    circle(58.5, { class: "basic3-gauge-ticks", stroke: "#f7a0c5" }),
    circle(55.5, { class: "basic3-gauge-rim", stroke: paint("rim") }),
    circle(53, { fill: "none", stroke: "#451329", "stroke-width": 2.5 }),
    circle(53.7, { class: "basic3-gauge-outline", stroke: "#e16599" }),
    circle(50.5, { class: "basic3-gauge-bezel", stroke: paint("rim") }),
    circle(49, { class: "basic3-gauge-sphere", fill: paint("sphere") }),
    liquidClip,
    circle(48.5, { fill: paint("reflection"), "pointer-events": "none" }),
    circle(48.5, { class: "basic3-gauge-sheen", fill: paint("sheen") }),
    circle(48.5, { class: "basic3-gauge-refraction", stroke: "#ff9ec8" }),
    svgElement("path", { class: "basic3-gauge-highlight", d: "M67 14A51 51 0 0 1 99 27 M30 103A51 51 0 0 0 96 107", stroke: paint("glint") }),
    createSparkles(paint),
    inner
  );
  meter.append(svg);
  root.replaceChildren(meter);

  function update({ percent: nextPercent, level, label: nextLabel, mode = "panel", dock = "none" }) {
    const value = Number.isFinite(nextPercent) ? Math.max(0, Math.min(100, nextPercent)) : null;
    const displayText = value === null ? "--%" : `${Math.round(value)}%`;
    const gaugeMode = mode === "ball" ? "ball" : "panel";
    const gaugeDock = dock === "left" || dock === "right" ? dock : "none";
    meter.dataset.level = level || "unknown";
    meter.dataset.mode = gaugeMode;
    meter.dataset.dock = gaugeDock;
    meter.dataset.percent = value === null ? "unknown" : String(value);
    // 液体和前沿共用曲线；两端波幅收敛，裁切仍由内球承担。
    const y = 114 - (value ?? 0) * 0.98;
    const amplitude = 1.8 * Math.min(1, (value ?? 0) / 10, (100 - (value ?? 0)) / 10);
    const curve = `M 16 ${y} C 34 ${y - amplitude} 46 ${y + amplitude} 65 ${y} S 96 ${y - amplitude} 114 ${y}`;
    liquid.setAttribute("d", value === null || value === 0 ? "" : `${curve} V 115 H 16 Z`);
    surface.setAttribute("d", curve);
    surface.dataset.levelY = String(y);
    rear.setAttribute("d", curve);
    rear.setAttribute("transform", `translate(0 ${-amplitude * 0.9})`);
    surface.style.display = value === null || value === 0 || value === 100 ? "none" : "";
    rear.style.display = surface.style.display;
    percent.textContent = displayText;
    label.textContent = nextLabel || "";
    applyLayout({ inner, mark, percent, label }, gaugeMode, gaugeDock);
    svg.setAttribute("aria-label", `${nextLabel || "Quota"} ${displayText}`);
  }

  function destroy() {
    if (meter.parentNode === root) root.replaceChildren();
  }

  return { update, destroy };
}

function applyLayout(gauge, mode, dock) {
  // 仅移动文字与标识，保持贴边球体和液位居中。
  const direction = dock === "right" ? 1 : -1;
  gauge.inner.setAttribute("transform", mode !== "ball" || dock === "none" ? ""
    : `translate(65 65) translate(${-direction * 13} 0) scale(0.82) translate(-${65 + direction * 5} -65)`);
  gauge.mark.style.display = mode === "panel" ? "none" : "";
  gauge.percent.setAttribute("y", mode === "panel" ? "74" : "99");
  gauge.label.style.display = mode === "panel" ? "" : "none";
}

function createDefs(id) {
  const defs = svgElement("defs");
  const addGradient = (name, type, attrs, stops) => {
    const gradient = svgElement(type, { id: `${id}-${name}`, ...attrs });
    stops.forEach(([offset, color, opacity = 1]) => gradient.append(svgElement("stop", {
      offset, "stop-color": color, "stop-opacity": opacity
    })));
    defs.append(gradient);
  };
  addGradient("sphere", "radialGradient", { cx: "32%", cy: "17%", r: "90%" }, [
    ["0%", "#ba789b"], ["32%", "#66273f"], ["65%", "#2b1024"], ["90%", "#641630"], ["100%", "#ff4a97"]
  ]);
  addGradient("liquid", "linearGradient", { gradientUnits: "userSpaceOnUse", x1: 40, y1: 16, x2: 80, y2: 114 }, [
    ["0%", "#ffbedc"], ["23%", "#ff5ca7"], ["48%", "#c71460"], ["68%", "#940a40"], ["89%", "#ff267e"], ["100%", "#ff90c1"]
  ]);
  addGradient("rim", "linearGradient", { x1: "15%", y1: "5%", x2: "85%", y2: "95%" }, [
    ["0%", "#ff70ae"], ["18%", "#ffaccf"], ["34%", "#d6246a"], ["58%", "#76243f"], ["79%", "#ff4998"], ["93%", "#ffacd2"], ["100%", "#f92073"]
  ]);
  addGradient("reflection", "radialGradient", { cx: "50%", cy: "43%", r: "58%" }, [
    ["52%", "#ff6ead", 0], ["80%", "#ff6ead", 0.08], ["93%", "#ff80b7", 0.38], ["100%", "#ffc8e2", 0.65]
  ]);
  addGradient("sheen", "radialGradient", { cx: "37%", cy: "8%", r: "68%", gradientTransform: "translate(0 .03) scale(1 .72)" }, [
    ["0%", "#ffffff", 0.94], ["22%", "#fff2f9", 0.67], ["48%", "#ffd1e8", 0.22], ["78%", "#ffb2d5", 0.04], ["100%", "#ffafd2", 0]
  ]);
  addGradient("glint", "linearGradient", { x1: 0, y1: 0, x2: 1, y2: 1 }, [
    ["0%", "#fff9fd", 0.9], ["34%", "#ffdcf0", 0.7], ["55%", "#ff67a6", 0.12], ["100%", "#ffe1f2", 0.95]
  ]);
  addGradient("mark", "linearGradient", { x1: 0, y1: 0, x2: 0, y2: 1 }, [
    ["0%", "#ffffff"], ["40%", "#ffc5e1"], ["65%", "#ff76b7"], ["100%", "#ffe5f2"]
  ]);
  const clip = svgElement("clipPath", { id: `${id}-clip` });
  clip.append(circle(49));
  const glow = svgElement("filter", { id: `${id}-glow`, x: "-50%", y: "-50%", width: "200%", height: "200%" });
  glow.append(svgElement("feGaussianBlur", { stdDeviation: 1.6 }));
  defs.append(clip, glow);
  return defs;
}

function createSparkles(paint) {
  const group = svgElement("g", { class: "basic3-gauge-sparkles", "pointer-events": "none" });
  [[105, 106, 1], [12, 44, 0.65], [98, 15, 0.32], [65, 111, 0.22]].forEach(([x, y, scale]) => {
    const star = svgElement("g", { transform: `translate(${x} ${y}) scale(${scale})` });
    star.append(
      svgElement("circle", { r: 4.4, fill: "#ff78b4", opacity: 0.8, filter: paint("glow") }),
      svgElement("path", { d: "M-13 0 -.6-.3 0-10 .3-.4 15 0 .4.25 0 9 -.3.4Z", fill: "#ffe6f4", opacity: 0.9 }),
      svgElement("path", { d: "M-4-4 4 4 M-3 4 3-4", stroke: "#ffc5e3", "stroke-width": 0.3, opacity: 0.6 }),
      svgElement("circle", { r: 0.8, fill: "white" })
    );
    group.append(star);
  });
  [[23, 23], [110, 53], [104, 86], [31, 108], [71, 8], [11, 77], [88, 96], [39, 35]].forEach(([cx, cy], i) => {
    group.append(svgElement("circle", { cx, cy, r: i % 3 === 0 ? 0.8 : 0.45, fill: "#ffe1f0", opacity: 0.8 }));
  });
  return group;
}

function circle(r, attrs = {}) {
  return svgElement("circle", { cx: 65, cy: 65, r, ...attrs });
}

function svgElement(tagName, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tagName);
  Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}
