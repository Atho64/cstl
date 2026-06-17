import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/cstl/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Copas Tool',
        short_name: 'Copas Tool',
        description: 'Alat bantu penerjemahan string dengan dukungan AI',
        theme_color: '#1a1f2b',
        background_color: '#0f131a',
        display: 'standalone',
        icons: [
          {
            src: 'icon.jpg',
            sizes: '192x192',
            type: 'image/jpeg',
            purpose: 'any maskable'
          },
          {
            src: 'icon.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
});
