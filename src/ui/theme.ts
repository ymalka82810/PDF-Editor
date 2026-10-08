/** ערכת נושא: בהיר/כהה/לפי המערכת. 'system' מסיר את data-theme ומשאיר להעדפת המערכת (styles.css) */

export type Theme = 'light' | 'dark' | 'system';

let current: Theme = 'system';
const listeners = new Set<(t: Theme) => void>();

export function setTheme(t: Theme) {
  current = t;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* אין גישה לאחסון */
  }
  for (const fn of listeners) fn(t);
}

export const theme = () => current;

export function onThemeChange(fn: (t: Theme) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    /* אין גישה לאחסון */
  }
  return 'system';
}
