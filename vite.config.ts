import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Dual-bundle build:
//   SMC_BUNDLE=modern -> dist-modern, base "/modern/", es2020
//   SMC_BUNDLE=legacy -> dist-legacy, base "/legacy/", chrome66/es2017
// Unset (dev / Lovable preview) -> behaves like a single modern build at "/".
const bundle = process.env.SMC_BUNDLE as "modern" | "legacy" | undefined;

const isLegacy = bundle === "legacy";
const base = bundle ? (isLegacy ? "/legacy/" : "/modern/") : "/";
const outDir = bundle ? (isLegacy ? "dist-legacy" : "dist-modern") : "dist";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base,
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: mode === "production" ? { drop: ["console", "debugger"] } : undefined,
  build: {
    outDir,
    emptyOutDir: true,
    // Legacy target supports old Android System WebView (Chrome 66) found on many
    // Android TV / STB devices. Modern target stays current for new devices.
    target: isLegacy ? ["chrome66", "es2017"] : ["es2020", "chrome87"],
    cssTarget: isLegacy ? "chrome66" : "chrome87",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
}));
