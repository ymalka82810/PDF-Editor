/**
 * תרגום עברית/אנגלית. מילון הליבה ב-src/i18n/{he,en}.json, וכל כלי מוסיף את שלו עם קידומת '<tool id>.'.
 * t('save'), t('shapes.rect'), t('pages.count', { n: 3 }) – משתנים בצורה {n}.
 */

import he from '../i18n/he.json';
import en from '../i18n/en.json';

export type Lang = 'he' | 'en';
type Dict = Record<string, string>;

const dicts: Record<Lang, Dict> = { he: { ...he }, en: { ...en } };
let current: Lang = 'he';
const listeners = new Set<(l: Lang) => void>();

export function addLocale(prefix: string, locales: { he: Dict; en: Dict }) {
  for (const lang of ['he', 'en'] as const)
    for (const [k, v] of Object.entries(locales[lang] ?? {})) dicts[lang][prefix ? prefix + '.' + k : k] = v;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[current][key] ?? dicts.he[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export const lang = () => current;
export const dir = (l: Lang = current) => (l === 'he' ? 'rtl' : 'ltr');

export function setLang(l: Lang) {
  current = l;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l;
    document.documentElement.dir = dir(l);
  }
  try {
    localStorage.setItem('lang', l);
  } catch {
    /* אין גישה לאחסון */
  }
  for (const fn of listeners) fn(l);
}

export function onLangChange(fn: (l: Lang) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** השפה השמורה, או לפי הדפדפן */
export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    /* אין גישה לאחסון */
  }
  return typeof navigator !== 'undefined' && !/^he|^iw/i.test(navigator.language) ? 'en' : 'he';
}
