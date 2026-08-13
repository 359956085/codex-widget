import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadApplicationMarkup() {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  document.open();
  document.write(html);
  document.close();
}
