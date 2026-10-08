import { createHash } from 'node:crypto';
import { defineConfig } from '@playwright/test';

/**
 * בדיקת PWA/offline אמיתית: חייבת build+preview (לא npm run dev), כי ה-service worker
 * של vite-plugin-pwa מתנהג אחרת ב-dev (devOptions) לעומת build אמיתי (generateSW + precache).
 * פורט נפרד מ-playwright.config.ts (offset+10000), לפי אותו hash של תיקיית ה-worktree.
 */
const port = Number(process.env.E2E_OFFLINE_PORT) || 16000 + (createHash('md5').update(process.cwd()).digest().readUInt16BE(0) % 2000);
const url = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e-offline',
  use: { baseURL: url, locale: 'he-IL' },
  // build לפני preview; ה-build כבר כולל typecheck (ראו package.json), ולכן יכול לקחת זמן
  webServer: { command: `npm run build && npm run preview -- --port ${port} --strictPort`, url, reuseExistingServer: false, timeout: 120_000 },
});
