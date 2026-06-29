import fs from "node:fs";
import path from "node:path";

const iconDir = path.join("src-tauri", "icons");
const sourcePngPath = path.join(iconDir, "icon.png");
const targetIcnsPath = path.join(iconDir, "icon.icns");
const sourcePng = fs.readFileSync(sourcePngPath);

if (sourcePng.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
  throw new Error("icon.png 不是有效 PNG 文件。");
}

const entryLength = 8 + sourcePng.length;
const totalLength = 8 + entryLength;
const output = Buffer.alloc(totalLength);
let offset = 0;
output.write("icns", offset, "ascii");
offset += 4;
output.writeUInt32BE(totalLength, offset);
offset += 4;
// ic08 表示 256x256 PNG 图标，当前源图正好是 256px。
output.write("ic08", offset, "ascii");
offset += 4;
output.writeUInt32BE(entryLength, offset);
offset += 4;
sourcePng.copy(output, offset);

fs.writeFileSync(targetIcnsPath, output);
console.log(`已生成 ${targetIcnsPath}`);
