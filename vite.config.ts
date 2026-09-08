import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "node:path";
import fs from "node:fs";

// Copy Cesium files to public during dev
const cesiumDevPlugin = {
  name: "cesium-dev-copy",
  apply: "serve",
  async configResolved() {
    const srcDir = path.resolve(__dirname, "node_modules/cesium/Build/Cesium");
    const destDir = path.resolve(__dirname, "public/cesium");

    // Create cesium directory if it doesn't exist
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy files recursively
    const copyDir = (src: string, dest: string) => {
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
          }
          copyDir(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };

    try {
      copyDir(srcDir, destDir);
      console.log("[cesium-dev-copy] Copied Cesium files to public/cesium");
    } catch (err) {
      console.error("[cesium-dev-copy] Failed to copy Cesium files:", err);
    }
  },
};

export default defineConfig({
  plugins: [
    react(),
    cesiumDevPlugin,
    viteStaticCopy({
      targets: [
        {
          src: path.resolve(__dirname, "node_modules/cesium/Build/Cesium"),
          dest: "cesium",
        },
      ],
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify("/cesium"),
  },
  optimizeDeps: {
    // Cesium's Math module imports the CommonJS mersenne-twister package.
    // Force Vite to pre-bundle it so the browser receives a proper ESM default export.
    include: ["cesium", "mersenne-twister"],
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
});