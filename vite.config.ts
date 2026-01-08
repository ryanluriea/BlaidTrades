import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// HMR configuration for Replit's proxied environment
function getHmrConfig() {
  // Completely disable HMR on Replit to avoid WebSocket connection issues
  if (process.env.REPL_ID) {
    return false;
  }
  // Local development: Use default HMR
  return true;
}

export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    hmr: getHmrConfig(),
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  root: path.resolve(__dirname, "client"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
      "@assets": path.resolve(__dirname, "./attached_assets"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
}));
