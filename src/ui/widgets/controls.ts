/**
 * פקדים קטנים משותפים לכלי התוכן: בוחר צבע, עובי/גודל, כפתור מצב, ופס מאפיינים צף מעל פעולה נבחרת.
 */

import './controls.css';
import type { Rect } from '../../core/types';

export function swatches(container: HTMLElement, colors: string[], value: string, onPick: (c: string) => void) {
  const wrap = document.createElement('span');
  wrap.className = 'widget-swatches';
  for (const c of colors) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'widget-swatch' + (c.toLowerCase() === value.toLowerCase() ? ' active' : '');
    b.style.background = c;
    b.onclick = () => onPick(c);
    wrap.appendChild(b);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'widget-swatch-custom';
  custom.value = /^#[\da-f]{6}$/i.test(value) ? value : '#000000';
  custom.oninput = () => onPick(custom.value);
  wrap.appendChild(custom);
  container.appendChild(wrap);
  return wrap;
}

export function stepper(
  container: HTMLElement,
  value: number,
  opts: { step?: number; min?: number; max?: number; format?: (n: number) => string },
  onChange: (n: number) => void,
) {
  const { step = 1, min = 1, max = 999, format = (n) => String(n) } = opts;
  const wrap = document.createElement('span');
  wrap.className = 'widget-stepper';
  const dec = document.createElement('button');
  dec.type = 'button';
  dec.textContent = '−';
  dec.onclick = () => onChange(Math.max(min, round(value - step)));
  const out = document.createElement('output');
  out.textContent = format(value);
  const inc = document.createElement('button');
  inc.type = 'button';
  inc.textContent = '+';
  inc.onclick = () => onChange(Math.min(max, round(value + step)));
  wrap.append(dec, out, inc);
  container.appendChild(wrap);
  return wrap;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function toggleButton(container: HTMLElement, label: string, active: boolean, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'widget-toggle';
  b.setAttribute('aria-pressed', String(active));
  b.textContent = label;
  b.onclick = onClick;
  container.appendChild(b);
  return b;
}

export function segmented<T extends string>(
  container: HTMLElement,
  options: { value: T; label: string }[],
  value: T,
  onPick: (v: T) => void,
) {
  const wrap = document.createElement('span');
  wrap.className = 'widget-segmented';
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(opt.value === value));
    b.textContent = opt.label;
    b.onclick = () => onPick(opt.value);
    wrap.appendChild(b);
  }
  container.appendChild(wrap);
  return wrap;
}

/**
 * פס מאפיינים צף מעל מלבן תצוגה (view-space). יוצר/מחליף div בתוך el, ומחזיר אותו ריק למילוי.
 * el הוא האלמנט הממוקם של הפעולה (position:relative, בגודל ה-rect שלה).
 */
export function floatingBar(el: HTMLElement, viewRect: Rect): HTMLElement {
  let bar = el.querySelector<HTMLElement>(':scope > .widget-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'widget-bar';
    el.appendChild(bar);
  }
  bar.innerHTML = '';
  // מעל הפעולה; אם קרוב מדי לראש האזור – מתחת
  if (viewRect.y < 44) bar.classList.add('below');
  else bar.classList.remove('below');
  return bar;
}
