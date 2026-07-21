import "./styles.css";
import "./themes.css";

import { createApp } from "./app/app.js";
import { bootstrapApplication } from "./app/startup.js";

void bootstrapApplication(createApp, renderFatalStartupError);

function renderFatalStartupError(error) {
  const message = normalizeStartupError(error);
  console.error("应用启动失败", error);
  if (document.body) {
    document.body.dataset.state = "error";
  }

  const stateText = document.getElementById("stateText");
  const statusText = document.getElementById("statusText");
  if (stateText) stateText.textContent = "启动失败";
  if (statusText) statusText.textContent = `应用启动失败：${message}`;
}

function normalizeStartupError(error) {
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  try {
    return JSON.stringify(error) || "未知错误";
  } catch {
    return String(error ?? "未知错误");
  }
}
