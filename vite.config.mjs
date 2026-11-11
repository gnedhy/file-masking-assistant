import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { SECURITY_HEADERS } from "./server/security-headers.mjs";

export default defineConfig({
  preview: { host: "127.0.0.1", port: 5174, strictPort: true, headers: SECURITY_HEADERS },
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
