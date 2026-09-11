import fs from "node:fs";
import path from "node:path";

export function newestFile(dir, predicate, fileSystem = fs) {
  if (!fileSystem.existsSync(dir)) return null;
  const candidates = fileSystem.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      return { filePath, modified: fileSystem.statSync(filePath).mtimeMs };
    });
  // 稳定排序保留同一修改时间下的原始目录顺序。
  candidates.sort((left, right) => right.modified - left.modified);
  return candidates[0]?.filePath ?? null;
}
