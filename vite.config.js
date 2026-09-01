import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      // Rust 会频繁重写 target 下的可执行文件；Windows 监听它们可能触发 EBUSY 并终止 Vite。
      ignored: ["**/src-tauri/target/**"]
    }
  }
});
