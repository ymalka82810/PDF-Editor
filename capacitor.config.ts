import type { CapacitorConfig } from '@capacitor/cli';

/**
 * אפליקציית Android עטופה (Capacitor) סביב ה-build של vite (dist/).
 * npx cap sync אחרי כל npm run build מעתיק את dist/ ל-android/app/src/main/assets/public.
 */
const config: CapacitorConfig = {
  appId: 'com.pdfeditor.app',
  appName: 'עורך PDF',
  webDir: 'dist',
};

export default config;
