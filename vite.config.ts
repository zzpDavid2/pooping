import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: '厕评 pooping',
        short_name: '厕评',
        description: '厕所点评 · Toilet reviews',
        start_url: '/',
        display: 'standalone',
        background_color: '#fdf8f3',
        theme_color: '#c07540',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,json}'],
        // 地图瓦片单独缓存：国内拉瓦片慢，缓存住体感差别巨大
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-z0-9]+\.is\.autonavi\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'amap-tiles',
              expiration: { maxEntries: 1200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 这里**故意不配 manualChunks**。
    //
    // 之前手动把 maplibre-gl 切成一个命名 chunk，结果 Rollup 把 Vite 的
    // __vitePreload 辅助函数也放进了那个 chunk —— 入口为了拿这一个小函数，
    // 必须静态 import 整包，800KB 的地图库又回到了首屏关键路径上，
    // 而且 index.html 里看不出来（没有 modulepreload），非常隐蔽。
    //
    // MapView 本来就是 lazy 的，maplibre 只有它用，交给 Rollup 自己切就对了。
    // 改这里之后一定要复查：入口 chunk 不应出现 `from"./maplibre-*.js"`。
  },
})
