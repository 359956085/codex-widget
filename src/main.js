import { normalizeError } from "./app/errors.js";
import "./styles.css";
import "./themes.css";

import { createApp } from "./app/app.js";
import { bootstrapApplication } from "./app/startup.js";

let application;
let disposed = false;
void bootstrapApplication(() => {
  application = createApp();
  return application;
}, renderFatalStartupError);

const destroy = () => {
  disposed = true;
  application?.destroy();
};
window.addEventListener("pagehide", destroy, { once: true });
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("pagehide", destroy);
    destroy();
  });
}

function renderFatalStartupError(error) {
  if (disposed) return;
  const message = normalizeError(error);
  console.error("应用启动失败", error);
  if (document.body) {
    document.body.dataset.state = "error";
  }

  const stateText = document.getElementById("stateText");
  const statusText = document.getElementById("statusText");
  if (stateText) stateText.textContent = "启动失败";
  if (statusText) statusText.textContent = `应用启动失败：${message}`;
}
