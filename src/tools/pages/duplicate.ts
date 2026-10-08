/**
 * שכפול עמודים נבחרים, כולל שכפול הפעולות (ops) שלהם עם id-ים חדשים.
 * ל-op.data עשוי להיות שדה pageId מקונן (למשל text-edit שומר ב-data.original.pageId
 * את העמוד שממנו הגיע הטקסט) – ממפים כל pageId כזה לעמוד המשוכפל, בכל עומק.
 */

import type { Store, UpdateOptions } from '../../core/model';
import { uid } from '../../core/model';
import type { Operation, PageRef } from '../../core/types';

function remapPageIds(data: unknown, map: Record<string, string>): unknown {
  if (Array.isArray(data)) return data.map((d) => remapPageIds(d, map));
  // רק אובייקטים פשוטים (לא Uint8Array וכו') – שאר הסוגים חוזרים כמו שהם, בלי שכפול עמוק
  if (data && typeof data === 'object' && Object.getPrototypeOf(data) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data))
      out[k] = k === 'pageId' && typeof v === 'string' && map[v] ? map[v] : remapPageIds(v, map);
    return out;
  }
  return data;
}

/** משכפל כל עמוד נבחר, ומכניס את העותק מיד אחריו. מחזיר את ה-id-ים של העותקים */
export function duplicatePages(store: Store, pageIds: readonly string[], opts?: UpdateOptions): string[] {
  const selected = new Set(pageIds);
  const newIds: string[] = [];
  const map: Record<string, string> = {};

  store.update((s) => {
    if (!selected.size) return s;
    const pages: PageRef[] = [];
    for (const p of s.pages) {
      pages.push(p);
      if (!selected.has(p.id)) continue;
      const newId = uid('page');
      map[p.id] = newId;
      newIds.push(newId);
      pages.push({ ...p, id: newId });
    }
    const dupOps: Operation[] = s.ops
      .filter((o) => map[o.pageId])
      .map((o) => ({
        ...o,
        id: uid('op'),
        pageId: map[o.pageId],
        data: remapPageIds(o.data, map) as Operation['data'],
      }));
    return { ...s, pages, ops: [...s.ops, ...dupOps] };
  }, opts);

  return newIds;
}
