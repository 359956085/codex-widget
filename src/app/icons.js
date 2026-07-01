import {
  CalendarDays,
  CircleDot,
  Clock3,
  createElement as createLucideElement,
  FolderOpen,
  Minus,
  Pin,
  PinOff,
  RefreshCw,
  Settings,
  X
} from "lucide";

const RESET_CREDIT_ICON = [
  "svg",
  {
    xmlns: "http://www.w3.org/2000/svg",
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  },
  [
    ["path", { d: "M4.7 14.6a7.8 7.8 0 0 1 13.1-6.9" }],
    ["path", { d: "M18 4.6v3.2h-3.2" }],
    ["path", { d: "M19.3 9.4a7.8 7.8 0 0 1-13.1 6.9" }],
    ["path", { d: "M6 19.4v-3.2h3.2" }],
    ["path", { d: "M12 8.4l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" }],
    ["path", { d: "M5.6 8.4h.01" }]
  ]
];

const ACTION_ICONS = {
  "calendar-days": CalendarDays,
  "circle-dot": CircleDot,
  "clock-3": Clock3,
  "reset-credit": RESET_CREDIT_ICON,
  "folder-open": FolderOpen,
  minus: Minus,
  pin: Pin,
  "pin-off": PinOff,
  "refresh-cw": RefreshCw,
  settings: Settings,
  x: X
};

export function initializeActionIcons(els, logger) {
  [
    [els.modeBtn, "circle-dot"],
    [els.settingsBtn, "settings"],
    [els.pinBtn, "pin"],
    [els.refreshBtn, "refresh-cw"],
    [els.minimizeBtn, "minus"],
    [els.closeBtn, "x"],
    [els.settingsCloseBtn, "x"],
    [els.chooseCodexBtn, "folder-open"],
    [els.statusIcon, "refresh-cw"],
    [document.querySelector('[data-quota-icon="primary"]'), "clock-3"],
    [document.querySelector('[data-quota-icon="secondary"]'), "calendar-days"],
    [document.querySelector('[data-quota-icon="plan"]'), "reset-credit"]
  ].forEach(([button, iconName]) => {
    setActionButtonIcon(button, iconName, logger);
  });
}

export function updateActionButton(button, iconName, label, active = false) {
  button.dataset.tooltip = label;
  button.removeAttribute("title");
  button.setAttribute("aria-label", label);
  button.classList.toggle("active", active);

  // 图标 DOM 初始化后保持稳定，只在置顶状态切换时替换对应图标，避免每次刷新重建按钮。
  if (button.dataset.iconName === iconName) return;
  setActionButtonIcon(button, iconName);
}

function setActionButtonIcon(button, iconName, logger) {
  if (!button) return;
  button.dataset.iconName = iconName;
  button.replaceChildren(createActionIcon(iconName, logger));
}

export function createActionIcon(iconName, logger) {
  const iconNode = ACTION_ICONS[iconName];
  if (!iconNode) {
    logger?.error("未知按钮图标", iconName, "frontend.icons");
    console.error("未知按钮图标", iconName);
    return document.createElement("span");
  }

  const [tag, attrs, children] = iconNode;
  return createLucideElement([
    tag,
    {
      ...attrs,
      "aria-hidden": "true",
      "data-lucide": iconName,
      class: `lucide lucide-${iconName}`
    },
    children
  ]);
}
