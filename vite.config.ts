import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5174" },
    watch: {
      // API サーバーが書き換える data/ やビルド出力は監視しない。
      // Windows で書込み中のファイルを watch すると EBUSY になるため。
      ignored: ["**/data/**", "**/dist/**", "**/node_modules/**", "**/.git/**"],
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
