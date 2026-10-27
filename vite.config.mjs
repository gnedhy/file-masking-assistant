import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { SECURITY_HEADERS } from "./worker/index.js";

export default defineConfig({
  preview: { headers: SECURITY_HEADERS },
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
