import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // src/main.jsx registers the service worker itself, so it can skip the
      // native (Capacitor) shell. Nothing is injected into index.html.
      injectRegister: null,
      // The glob below already picks up the manifest icons; listing them twice
      // only duplicates precache entries.
      includeManifestIcons: false,
      workbox: {
        // Fonts are bundled (src/fonts.css) and precached with everything else:
        // no request leaves the origin, so there is no runtime caching.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // App Store artwork only; nothing in the app loads it.
        globIgnores: ['**/icons/icon-1024.png'],
      },
      manifest: {
        name: 'Local Catch',
        short_name: 'Local Catch',
        description: 'Know what the fillet really costs: yield and cost calculator for seafood producers and chefs.',
        // Paper, both: the top bar is paper, and the splash should not flash teal.
        theme_color: '#f4f2ec',
        background_color: '#f4f2ec',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
