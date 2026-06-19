import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/lucide-react") || id.includes("node_modules\\lucide-react")) {
            return "icons";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules\\react")) {
            return "vendor";
          }
        },
      },
    },
    target: "es2018",
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
  },
});
