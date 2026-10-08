/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      // registerType: 'prompt' – לא מחליף גרסה בלי שהמשתמש יודע; registerSW נקרא מ-ui/app.ts
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-maskable.svg'],
      // גם ב-npm run dev יש manifest ו-service worker, כדי לבדוק PWA (והתנהגות offline) בלי build
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'עורך PDF',
        short_name: 'עורך PDF',
        description: 'עריכת קבצי PDF בדפדפן: טקסט, תמונות, עמודים וטפסים',
        lang: 'he',
        dir: 'rtl',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f7f4ee',
        theme_color: '#1e3a63',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // pdf.js/pdf-lib נטענים דינמית; מטמינים את כל מה שה-build מפיק כדי שהעורך יעבוד בלי אינטרנט
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/helpers/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
