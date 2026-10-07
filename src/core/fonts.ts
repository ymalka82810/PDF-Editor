/**
 * הגופנים שמגיעים עם העורך (src/assets/fonts). כולם עם עברית ולטינית.
 * בדפדפן נטענים ב-fetch, ובבדיקות (node) מהדיסק.
 */

export const FONTS = {
  default: 'Alef-Regular.ttf',
  'default-bold': 'Alef-Bold.ttf',
} as const;

export type FontName = keyof typeof FONTS;

const urls = import.meta.glob('../assets/fonts/*.ttf', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const cache = new Map<string, Promise<Uint8Array>>();

export function fontBytes(name: FontName | string = 'default'): Promise<Uint8Array> {
  const file = (FONTS as Record<string, string>)[name] ?? name;
  let p = cache.get(file);
  if (!p) {
    p = load(file);
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}

async function load(file: string): Promise<Uint8Array> {
  if (typeof window === 'undefined') {
    // node (בדיקות)
    const fs = 'node:fs/promises';
    const { readFile } = await import(/* @vite-ignore */ fs);
    return new Uint8Array(await readFile(new URL('../assets/fonts/' + file, import.meta.url)));
  }
  const url = urls['../assets/fonts/' + file];
  if (!url) throw new Error('גופן לא קיים: ' + file);
  const res = await fetch(url);
  if (!res.ok) throw new Error('טעינת הגופן נכשלה: ' + file);
  return new Uint8Array(await res.arrayBuffer());
}
