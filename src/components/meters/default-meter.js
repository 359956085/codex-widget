export function mount(root) {
  const meter = document.createElement("div");
  meter.className = "default-meter";

  // 底部环境光晕层（位于球体外侧，不受圆球裁剪限制）
  const glow = document.createElement("div");
  glow.className = "default-meter-glow";

  // 核心圆球容器（必须具有 border-radius: 50% 和 overflow: hidden，确保内部液体绝不溢出成方角）
  const body = document.createElement("div");
  body.className = "default-meter-body";

  // 3D 玻璃球底壳与纵深阴影
  const sphere = document.createElement("div");
  sphere.className = "default-meter-sphere";

  // 一体化 SVG 矢量流体水体（水面与水体物理一体，彻底消除分离脱节）
  const svgNS = "http://www.w3.org/2000/svg";
  const fluidSvg = document.createElementNS(svgNS, "svg");
  fluidSvg.setAttribute("class", "default-meter-fluid-svg");
  fluidSvg.setAttribute("viewBox", "0 0 100 100");
  fluidSvg.setAttribute("preserveAspectRatio", "none");

  // SVG 渐变定义
  const defs = document.createElementNS(svgNS, "defs");

  // 主翡翠水体渐变 (#0dad5c -> #089b50 -> #068c47 -> #036834)
  const gradId = `def-meter-grad-${Math.random().toString(36).slice(2, 7)}`;
  const grad = document.createElementNS(svgNS, "linearGradient");
  grad.setAttribute("id", gradId);
  grad.setAttribute("x1", "0");
  grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0");
  grad.setAttribute("y2", "1");
  const s1 = document.createElementNS(svgNS, "stop"); s1.setAttribute("offset", "0%"); s1.setAttribute("stop-color", "#0dad5c");
  const s2 = document.createElementNS(svgNS, "stop"); s2.setAttribute("offset", "28%"); s2.setAttribute("stop-color", "#089b50");
  const s3 = document.createElementNS(svgNS, "stop"); s3.setAttribute("offset", "62%"); s3.setAttribute("stop-color", "#068c47");
  const s4 = document.createElementNS(svgNS, "stop"); s4.setAttribute("offset", "100%"); s4.setAttribute("stop-color", "#036834");
  grad.append(s1, s2, s3, s4);

  // 后浪半透深波渐变
  const backGradId = `def-meter-back-grad-${Math.random().toString(36).slice(2, 7)}`;
  const backGrad = document.createElementNS(svgNS, "linearGradient");
  backGrad.setAttribute("id", backGradId);
  backGrad.setAttribute("x1", "0");
  backGrad.setAttribute("y1", "0");
  backGrad.setAttribute("x2", "0");
  backGrad.setAttribute("y2", "1");
  const bs1 = document.createElementNS(svgNS, "stop"); bs1.setAttribute("offset", "0%"); bs1.setAttribute("stop-color", "rgba(13, 173, 92, 0.45)");
  const bs2 = document.createElementNS(svgNS, "stop"); bs2.setAttribute("offset", "100%"); bs2.setAttribute("stop-color", "rgba(3, 104, 52, 0.65)");
  backGrad.append(bs1, bs2);

  defs.append(grad, backGrad);

  // 后浪组
  const waveTwoGroup = document.createElementNS(svgNS, "g");
  waveTwoGroup.setAttribute("class", "default-meter-wave-group default-meter-wave-two-group");
  const backWaveBody = document.createElementNS(svgNS, "path");
  backWaveBody.setAttribute("class", "default-meter-back-wave-body");
  backWaveBody.setAttribute("fill", `url(#${backGradId})`);
  const backWaveStroke = document.createElementNS(svgNS, "path");
  backWaveStroke.setAttribute("class", "default-meter-back-wave-stroke");
  backWaveStroke.setAttribute("fill", "none");
  backWaveStroke.setAttribute("stroke", "rgba(160, 255, 215, 0.65)");
  backWaveStroke.setAttribute("stroke-width", "1");
  waveTwoGroup.append(backWaveBody, backWaveStroke);

  // 前浪组
  const waveOneGroup = document.createElementNS(svgNS, "g");
  waveOneGroup.setAttribute("class", "default-meter-wave-group default-meter-wave-one-group");
  const frontWaveBody = document.createElementNS(svgNS, "path");
  frontWaveBody.setAttribute("class", "default-meter-front-wave-body");
  frontWaveBody.setAttribute("fill", `url(#${gradId})`);
  const frontWaveStroke = document.createElementNS(svgNS, "path");
  frontWaveStroke.setAttribute("class", "default-meter-front-wave-stroke");
  frontWaveStroke.setAttribute("fill", "none");
  frontWaveStroke.setAttribute("stroke", "rgba(230, 255, 245, 0.95)");
  frontWaveStroke.setAttribute("stroke-width", "1.3");
  frontWaveStroke.setAttribute("stroke-linecap", "round");
  waveOneGroup.append(frontWaveBody, frontWaveStroke);

  fluidSvg.append(defs, waveTwoGroup, waveOneGroup);

  // 悬浮微粒/光斑
  const particles = document.createElement("div");
  particles.className = "default-meter-particles";

  // 顶部镜面高光弧
  const shine = document.createElement("div");
  shine.className = "default-meter-shine";

  // 底部次级内反光弧（水晶球透光与焦散反射）
  const bottomShine = document.createElement("div");
  bottomShine.className = "default-meter-bottom-shine";

  // 球体边缘微光外环
  const rim = document.createElement("div");
  rim.className = "default-meter-rim";

  body.append(sphere, fluidSvg, particles, shine, bottomShine, rim);

  // 贴边吸附装饰条
  const dockBar = document.createElement("div");
  dockBar.className = "default-meter-dock-bar";

  // 居中文本（百分比与标签）
  const copy = document.createElement("div");
  copy.className = "default-meter-copy";
  const percent = document.createElement("strong");
  const label = document.createElement("span");
  copy.append(percent, label);

  meter.append(glow, body, dockBar, copy);
  root.replaceChildren(meter);

  function update({ percent: nextPercent, level, label: nextLabel, mode = "panel", dock = "none" }) {
    const value = Number.isFinite(nextPercent) ? clamp(nextPercent, 0, 100) : null;
    const displayText = value === null ? "--%" : `${Math.round(value)}%`;
    meter.dataset.level = level || "unknown";
    meter.dataset.mode = mode === "ball" ? "ball" : "panel";
    meter.dataset.dock = dock === "left" || dock === "right" ? dock : "none";

    if (value === null || value <= 0) {
      frontWaveBody.setAttribute("d", "");
      frontWaveStroke.setAttribute("d", "");
      backWaveBody.setAttribute("d", "");
      backWaveStroke.setAttribute("d", "");
    } else if (value >= 98.5) {
      frontWaveBody.setAttribute("d", "M 0 0 L 200 0 L 200 105 L 0 105 Z");
      frontWaveStroke.setAttribute("d", "");
      backWaveBody.setAttribute("d", "");
      backWaveStroke.setAttribute("d", "");
    } else {
      const waterY = 100 - value;
      const amp = 2.2;
      const frontBodyD = `M 0 ${waterY} Q 25 ${waterY - amp}, 50 ${waterY} T 100 ${waterY} T 150 ${waterY} T 200 ${waterY} L 200 105 L 0 105 Z`;
      const frontStrokeD = `M 0 ${waterY} Q 25 ${waterY - amp}, 50 ${waterY} T 100 ${waterY} T 150 ${waterY} T 200 ${waterY}`;
      frontWaveBody.setAttribute("d", frontBodyD);
      frontWaveStroke.setAttribute("d", frontStrokeD);

      const backY = waterY + 1.2;
      const backAmp = 1.8;
      const backBodyD = `M 0 ${backY} Q 25 ${backY + backAmp}, 50 ${backY} T 100 ${backY} T 150 ${backY} T 200 ${backY} L 200 105 L 0 105 Z`;
      const backStrokeD = `M 0 ${backY} Q 25 ${backY + backAmp}, 50 ${backY} T 100 ${backY} T 150 ${backY} T 200 ${backY}`;
      backWaveBody.setAttribute("d", backBodyD);
      backWaveStroke.setAttribute("d", backStrokeD);
    }

    meter.dataset.percent = value === null ? "0" : `${Math.round(value)}`;
    setText(percent, displayText);
    setText(label, nextLabel || "");
    label.hidden = false;
    meter.setAttribute("role", "img");
    meter.setAttribute("aria-label", `${nextLabel || "Quota"} ${displayText}`);
  }

  function destroy() {
    if (meter.parentNode === root) root.replaceChildren();
  }

  return { update, destroy };
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
