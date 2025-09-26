// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"), // ← "@/..." を src に飛ばす
    },
  },
  build: {
    sourcemap: true, // ← 本番でも元ファイル行に飛べるように
  },
});
