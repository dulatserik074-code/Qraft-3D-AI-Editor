import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8790" } },
  build: {
    // Three.js is the editor's WebGL engine; keep it cached separately from app code.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("GLTFExporter")) return "three-exporter";
          if (id.includes("three")) return "three";
          if (id.includes("react")) return "react";
        },
      },
    },
  },
});
