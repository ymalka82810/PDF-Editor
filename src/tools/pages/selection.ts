/**
 * בחירת עמודים מרובה בפאנל התמונות המוקטנות. לא חלק מ-DocState (כמו store.selected שהוא לפעולה בודדת) –
 * זה state מקומי של כלי העמודים, משותף בין הפאנל לפקודות (סיבוב/מחיקה/שכפול וכו').
 */

export class PageSelection {
  private ids: string[] = [];
  private anchor: string | null = null;
  private listeners = new Set<() => void>();

  get(): string[] {
    return [...this.ids];
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  /** בחירה פשוטה (לחיצה בלי מקשים) */
  only(id: string) {
    this.ids = [id];
    this.anchor = id;
    this.emit();
  }

  /** Ctrl/Cmd+לחיצה – הוספה/הסרה מהבחירה */
  toggle(id: string) {
    this.ids = this.has(id) ? this.ids.filter((x) => x !== id) : [...this.ids, id];
    this.anchor = id;
    this.emit();
  }

  /** Shift+לחיצה – טווח מהעוגן ועד כאן, לפי סדר העמודים הנוכחי */
  range(id: string, order: string[]) {
    const from = this.anchor ?? id;
    const a = order.indexOf(from);
    const b = order.indexOf(id);
    if (a === -1 || b === -1) return this.only(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    this.ids = order.slice(lo, hi + 1);
    this.emit();
  }

  clear() {
    if (!this.ids.length) return;
    this.ids = [];
    this.anchor = null;
    this.emit();
  }

  /** מסירים עמודים שלא קיימים יותר (נמחקו, או קובץ חדש נפתח) */
  prune(validIds: Set<string>) {
    const next = this.ids.filter((id) => validIds.has(id));
    if (next.length === this.ids.length) return;
    this.ids = next;
    if (this.anchor && !validIds.has(this.anchor)) this.anchor = null;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const pageSelection = new PageSelection();
