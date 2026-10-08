import { createHash } from 'node:crypto';
import { defineConfig } from '@playwright/test';

/**
 * פורט קבוע לכל תיקייה (worktree), כדי שסשנים שמריצים e2e במקביל לא ישתמשו בשרת אחד של השני.
 * אפשר לקבוע ידנית: E2E_PORT=6000 npm run e2e
 */
const port = Number(process.env.E2E_PORT) || 6000 + (createHash('md5').update(process.cwd()).digest().readUInt16BE(0) % 2000);
const url = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  // העורך מתחיל בעברית לפי שפת הדפדפן; ספציפית ל-LTR: test.use({ locale: 'en-US' })
  use: { baseURL: url, locale: 'he-IL' },
  // לא משתמשים בשרת קיים: אם הפורט תפוס, עדיף שהבדיקה תיכשל מאשר שתרוץ מול קוד של ענף אחר
  webServer: { command: `npm run dev -- --port ${port} --strictPort`, url, reuseExistingServer: false },
});
