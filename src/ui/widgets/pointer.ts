/**
 * כל נקודות התנועה של אירוע (עט ומגע מהירים: הדפדפן מאחד כמה תנועות לאירוע אחד).
 * getCoalescedEvents מחזיר לפעמים רשימה ריקה (אירוע שלא אוחד) – אז האירוע עצמו.
 */
export function movesOf(e: PointerEvent): PointerEvent[] {
  const list = e.getCoalescedEvents?.();
  return list && list.length ? list : [e];
}
