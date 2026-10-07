import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // העורך מתחיל בעברית לפי שפת הדפדפן; ספציפית ל-LTR: test.use({ locale: 'en-US' })
  use: { baseURL: 'http://localhost:5173', locale: 'he-IL' },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
});
