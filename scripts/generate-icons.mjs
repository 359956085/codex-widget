import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const iconDir = join("src-tauri", "icons");
mkdirSync(iconDir, { recursive: true });

const size = 16;
const pixelCount = size * size;
const xorBytes = pixelCount * 4;
const andBytes = size * 4;
const bitmapHeaderBytes = 40;
const imageBytes = bitmapHeaderBytes + xorBytes + andBytes;
const fileBytes = 6 + 16 + imageBytes;
const buffer = Buffer.alloc(fileBytes);

let offset = 0;
buffer.writeUInt16LE(0, offset);
offset += 2;
buffer.writeUInt16LE(1, offset);
offset += 2;
buffer.writeUInt16LE(1, offset);
offset += 2;

buffer.writeUInt8(size, offset++);
buffer.writeUInt8(size, offset++);
buffer.writeUInt8(0, offset++);
buffer.writeUInt8(0, offset++);
buffer.writeUInt16LE(1, offset);
offset += 2;
buffer.writeUInt16LE(32, offset);
offset += 2;
buffer.writeUInt32LE(imageBytes, offset);
offset += 4;
buffer.writeUInt32LE(22, offset);
offset += 4;

buffer.writeUInt32LE(bitmapHeaderBytes, offset);
offset += 4;
buffer.writeInt32LE(size, offset);
offset += 4;
buffer.writeInt32LE(size * 2, offset);
offset += 4;
buffer.writeUInt16LE(1, offset);
offset += 2;
buffer.writeUInt16LE(32, offset);
offset += 2;
buffer.writeUInt32LE(0, offset);
offset += 4;
buffer.writeUInt32LE(xorBytes, offset);
offset += 4;
buffer.writeInt32LE(0, offset);
offset += 4;
buffer.writeInt32LE(0, offset);
offset += 4;
buffer.writeUInt32LE(0, offset);
offset += 4;
buffer.writeUInt32LE(0, offset);
offset += 4;

for (let y = size - 1; y >= 0; y -= 1) {
  for (let x = 0; x < size; x += 1) {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const alpha = distance <= 7 ? 255 : 0;
    // ICO 内部像素使用 BGRA 顺序。
    buffer.writeUInt8(133, offset++);
    buffer.writeUInt8(232, offset++);
    buffer.writeUInt8(46, offset++);
    buffer.writeUInt8(alpha, offset++);
  }
}

writeFileSync(join(iconDir, "icon.ico"), buffer);
