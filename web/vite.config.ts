import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Custom service worker (src/sw.ts) so the app can receive push reminders
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "נסיעות – ניהול הסעות",
        short_name: "נסיעות",
        lang: "he",
        dir: "rtl",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#1f6feb",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
    }),
  ],
});
