/**
 * חתימות שמורות לשימוש חוזר (localStorage, כ-data URL של PNG). כל גישה עטופה ב-try/catch:
 * בחלון פרטי או כשהאחסון חסום – פשוט אין חתימות שמורות.
 */

const KEY = 'pdf-editor.signatures';
const MAX = 6;
/** חתימה גדולה מזה לא נשמרת (localStorage קטן) */
const MAX_LENGTH = 400_000;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const store = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function loadSaved(s: Storage | null = store()): string[] {
  try {
    const list = JSON.parse(s?.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(list)
      ? list.filter((x): x is string => typeof x === 'string' && x.startsWith('data:image/'))
      : [];
  } catch {
    return [];
  }
}

/** שומרת בראש הרשימה (בלי כפילות), עד MAX חתימות. מחזירה false אם לא נשמרה */
export function saveSignature(url: string, s: Storage | null = store()): boolean {
  if (!s || url.length > MAX_LENGTH) return false;
  try {
    s.setItem(KEY, JSON.stringify([url, ...loadSaved(s).filter((x) => x !== url)].slice(0, MAX)));
    return true;
  } catch {
    return false;
  }
}

export function removeSaved(url: string, s: Storage | null = store()) {
  try {
    s?.setItem(KEY, JSON.stringify(loadSaved(s).filter((x) => x !== url)));
  } catch {
    /* אין אחסון */
  }
}

export function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
}
