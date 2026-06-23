import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  base: '/cstl/',
  resolve: {
    alias: {
      'path': 'path-browserify',
      'zlibjs/bin/gunzip.min.js': path.resolve(__dirname, 'src/zlib-shim.ts'),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    rollupOptions: {
      input: 'index.html',
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.jpg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,woff2}']
      },
      manifest: {
        name: 'Copas Tool',
        short_name: 'Copas Tool',
        description: 'Alat bantu penerjemahan string dengan dukungan AI',
        theme_color: '#1a1f2b',
        background_color: '#0f131a',
        display: 'standalone',
        start_url: '/cstl/',
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
