/**
 * חתימה: דיאלוג עם שלוש לשוניות – ציור על canvas (עכבר, מגע, עט), העלאת תמונה, וחתימות שמורות.
 * החתימה מונחת כתמונה (פעולת image – אותו ייצוא ואותה הזזה), ונשמרת ב-localStorage לפעם הבאה.
 * הדיאלוג בעיצוב של ui/dialog.ts (המחלקות dlg-*), כי שם יש רק alert/confirm/prompt.
 */

import type { EditorApi, Tool } from '../../core/registry';
import { placeImage, pickImageFile } from '../image';
import { getImage, putImage, putImageFile } from '../image/store';
import { bytesToDataUrl, dataUrlToBytes, loadSaved, removeSaved, saveSignature } from './saved';
import he from './locales/he.json';
import en from './locales/en.json';
import './style.css';

/** רוחב החתימה בעמוד, בנקודות */
const WIDTH = 150;
const INK = ['#1e3a63', '#000000'];

/** ה-canvas של הציור: משיכות עם החלקה, וחיתוך לגבולות הדיו ברקע שקוף */
class Pad {
  readonly canvas = document.createElement('canvas');
  private strokes: { x: number; y: number }[][] = [];
  color = INK[0];
  onChange: () => void = () => {};

  constructor() {
    this.canvas.className = 'signature-pad';
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
  }

  get empty() {
    return !this.strokes.length;
  }

  /** גודל ה-canvas לפי הגודל שלו על המסך (חד גם במסך צפוף) */
  fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.redraw();
  }

  clear() {
    this.strokes = [];
    this.redraw();
    this.onChange();
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const r = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / r.width;
    const at = (m: PointerEvent) => ({ x: (m.clientX - r.left) * k, y: (m.clientY - r.top) * k });
    const stroke = [at(e)];
    this.strokes.push(stroke);
    const move = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return;
      for (const c of m.getCoalescedEvents?.() ?? [m]) stroke.push(at(c));
      this.redraw();
    };
    const up = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return;
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
      this.redraw();
      this.onChange();
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.redraw();
  }

  redraw() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = 2.6 * (window.devicePixelRatio || 1);
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const s of this.strokes) {
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      if (s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y);
      // עקומות דרך אמצעי הקטעים
      for (let i = 1; i < s.length - 1; i++)
        ctx.quadraticCurveTo(s[i].x, s[i].y, (s[i].x + s[i + 1].x) / 2, (s[i].y + s[i + 1].y) / 2);
      if (s.length > 1) ctx.lineTo(s[s.length - 1].x, s[s.length - 1].y);
      ctx.stroke();
    }
  }

  /** PNG שקוף, חתוך לגבולות הדיו (עם שוליים קטנים) */
  async toPng(): Promise<Uint8Array | null> {
    const { width: W, height: H } = this.canvas;
    const data = this.canvas.getContext('2d')!.getImageData(0, 0, W, H).data;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (data[(y * W + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return null;
    const pad = 4;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1 + pad * 2;
    out.height = y1 - y0 + 1 + pad * 2;
    out
      .getContext('2d')!
      .drawImage(this.canvas, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
}

function button(label: string, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  return b;
}

/** מניח חתימה מהמאגר ושומר אותה לפעם הבאה */
function insert(api: EditorApi, imageId: string, remember: boolean) {
  if (!placeImage(api, imageId, WIDTH)) return api.toast(api.t('image.noPage'), 'error');
  const img = getImage(imageId);
  if (remember && img) saveSignature(bytesToDataUrl(img.bytes, img.mime));
}

function openDialog(api: EditorApi) {
  const t = (k: string) => api.t('signature.' + k);
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg signature-dlg';
  const form = document.createElement('form');
  form.method = 'dialog';
  form.className = 'dlg-form';
  const title = document.createElement('h2');
  title.className = 'dlg-title';
  title.textContent = t('title');

  // לשוניות
  const tabs = document.createElement('div');
  tabs.className = 'signature-tabs';
  tabs.setAttribute('role', 'tablist');
  const panels: Record<'draw' | 'saved', HTMLElement> = {
    draw: document.createElement('div'),
    saved: document.createElement('div'),
  };
  const tabButtons = new Map<string, HTMLButtonElement>();
  const show = (name: 'draw' | 'saved') => {
    for (const [k, p] of Object.entries(panels)) p.hidden = k !== name;
    for (const [k, b] of tabButtons) b.setAttribute('aria-selected', String(k === name));
    if (name === 'draw') requestAnimationFrame(() => pad.fit());
  };
  const saved = loadSaved();
  for (const name of ['draw', 'saved'] as const) {
    if (name === 'saved' && !saved.length) continue;
    const b = button(t(name), 'signature-tab');
    b.setAttribute('role', 'tab');
    b.onclick = () => show(name);
    tabButtons.set(name, b);
    tabs.appendChild(b);
  }

  // ציור
  const pad = new Pad();
  const hint = document.createElement('p');
  hint.className = 'signature-hint';
  hint.textContent = t('hint');
  const tools = document.createElement('div');
  tools.className = 'signature-tools';
  for (const c of INK) {
    const sw = button('', 'widget-swatch');
    sw.style.background = c;
    sw.setAttribute('aria-label', c);
    sw.onclick = () => {
      pad.color = c;
      pad.redraw();
    };
    tools.appendChild(sw);
  }
  const clear = button(t('clear'));
  clear.onclick = () => pad.clear();
  const upload = button(t('upload'));
  upload.onclick = async () => {
    const file = await pickImageFile();
    if (!file) return;
    try {
      const id = await putImageFile(file);
      dlg.close();
      insert(api, id, remember.checked);
    } catch (err) {
      console.error(err);
      api.toast(api.t('image.failed'), 'error');
    }
  };
  tools.append(clear, upload);
  panels.draw.append(pad.canvas, hint, tools);

  // שמורות
  const grid = document.createElement('div');
  grid.className = 'signature-saved';
  for (const url of saved) {
    const item = document.createElement('div');
    item.className = 'signature-saved-item';
    const use = button('', 'signature-use');
    const img = document.createElement('img');
    img.src = url;
    img.alt = t('saved');
    use.appendChild(img);
    use.onclick = () => {
      dlg.close();
      insert(api, putImage(dataUrlToBytes(url)), false);
    };
    const del = button('×', 'signature-delete');
    del.setAttribute('aria-label', t('delete'));
    del.onclick = () => {
      removeSaved(url);
      item.remove();
    };
    item.append(use, del);
    grid.appendChild(item);
  }
  panels.saved.appendChild(grid);

  // שמירה לפעם הבאה, ופעולות
  const rememberLabel = document.createElement('label');
  rememberLabel.className = 'signature-remember';
  const remember = document.createElement('input');
  remember.type = 'checkbox';
  remember.checked = true;
  rememberLabel.append(remember, ' ' + t('remember'));
  const actions = document.createElement('div');
  actions.className = 'dlg-actions';
  const cancel = button(api.t('dialog.cancel'), 'dlg-cancel');
  cancel.onclick = () => dlg.close();
  const ok = button(t('insert'), 'dlg-ok primary');
  ok.type = 'submit';
  ok.disabled = true;
  pad.onChange = () => (ok.disabled = pad.empty);
  actions.append(cancel, ok);

  form.append(title, tabs, panels.draw, panels.saved, rememberLabel, actions);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const png = await pad.toPng();
    dlg.close();
    if (png) insert(api, putImage(png), remember.checked);
  };
  dlg.appendChild(form);
  dlg.addEventListener('close', () => dlg.remove());
  // מקשים בתוך הדיאלוג לא מגיעים לקיצורי העורך
  dlg.addEventListener('keydown', (e) => e.key !== 'Escape' && e.stopPropagation());
  document.body.appendChild(dlg);
  dlg.showModal();
  show(saved.length ? 'saved' : 'draw');
}

const tool: Tool = {
  id: 'signature',
  icon: '✒',
  group: 'insert',
  shortcut: 's',
  locales: { he, en },
  run(api) {
    openDialog(api);
  },
};

export default tool;
