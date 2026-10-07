/**
 * הנחת אזור שנגרר על העמוד בעורך: המקום הקרוב ביותר למקום שבו הונח, שבו הטקסט לא עולה על טקסט אחר,
 * ועדיף מיושר לשורה (קו הבסיס) ולעמודה (קצה ימין, מרכז או קצה שמאל) של הטקסט שסביבו.
 */

const grids = new WeakMap();   // canvas ← Map(צבע רקע ← מפת דיו)

const rgb = h => (h.length === 4 ? [1, 2, 3].map(i => h[i] + h[i]) : [1, 3, 5].map(i => h.slice(i, i + 2))).map(v => parseInt(v, 16));
const lineBase = b => b.baseline ?? (b.y + b.h * 0.78);

/** כמה פיקסלים של דיו (רחוקים מצבע הרקע) יש בכל תא קטן של העמוד. נמדד פעם אחת לכל עמוד וצבע רקע */
function inkGrid(canvas, bg) {
  let byBg = grids.get(canvas);
  if (!byBg) grids.set(canvas, byBg = new Map());
  if (byBg.has(bg)) return byBg.get(bg);
  const W = canvas.width, H = canvas.height, cell = Math.max(1, Math.ceil(Math.max(W, H) / 700));
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell), count = new Uint32Array(gw * gh);
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const [r, g, b] = rgb(bg);
  for (let y = 0, i = 0; y < H; y++) {
    const row = ((y / cell) | 0) * gw;
    for (let x = 0; x < W; x++, i += 4) {
      const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b;
      if (dr * dr + dg * dg + db * db > 4900) count[row + ((x / cell) | 0)]++;
    }
  }
  const grid = { cell, gw, gh, count };
  byBg.set(bg, grid);
  return grid;
}

/** ספירת הדיו במלבן בזמן קבוע (טבלת סכומים), בלי הדיו שבאזורים שנמחקים בציור (erased) */
function inkCounter(grid, erased) {
  const { cell, gw, gh } = grid, c = grid.count.slice();
  for (const e of erased) {
    const x0 = Math.max(0, Math.round(e.x / cell)), x1 = Math.min(gw, Math.round((e.x + e.w) / cell));
    const y0 = Math.max(0, Math.round(e.y / cell)), y1 = Math.min(gh, Math.round((e.y + e.h) / cell));
    for (let y = y0; y < y1; y++) c.fill(0, y * gw + x0, y * gw + Math.max(x0, x1));
  }
  const S = gw + 1, sum = new Float64Array(S * (gh + 1));
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) sum[(y + 1) * S + x + 1] = c[y * gw + x] + sum[y * S + x + 1] + sum[(y + 1) * S + x] - sum[y * S + x];
  }
  const cx = v => Math.min(gw, Math.max(0, Math.round(v / cell))), cy = v => Math.min(gh, Math.max(0, Math.round(v / cell)));
  return r => {
    const x0 = cx(r.x), x1 = cx(r.x + r.w), y0 = cy(r.y), y1 = cy(r.y + r.h);
    return x1 <= x0 || y1 <= y0 ? 0 : sum[y1 * S + x1] - sum[y0 * S + x1] - sum[y1 * S + x0] + sum[y0 * S + x0];
  };
}

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * מחשב המיקום לאזור שנגרר. canvas – העמוד המקורי. bg – צבע הרקע של האזור.
 * erased – מלבנים שהטקסט שבהם נמחק או נכתב מחדש (לא נחשבים תפוסים לפי הדיו).
 * taken – מלבנים של אזורים אחרים, שבהם ייכתב טקסט. refs – תיבות טקסט ליישור.
 * מחזיר פונקציה: (box, label, dx, dy) ← { dx, dy } – ההזזה העדיפה, ליד ההזזה שבה האזור הונח
 */
export function placer(canvas, { bg, erased, taken, refs }) {
  const W = canvas.width, H = canvas.height;
  const ink = inkCounter(inkGrid(canvas, bg), erased);
  return (box, label, dx, dy) => {
    const g = label ? union(box, label) : box;
    // padX, padY – המרווח שנשאר מטקסט שכן: בצד – יותר מרווח בין מילים, כדי שלא ייקרא כהמשך של אותו טקסט
    const size = box.size || box.h * 0.72, reach = size * 6, step = size * 0.5, padX = size * 0.6, padY = size * 0.25;
    // האזור כולו נשאר בתוך העמוד
    const clampX = d => Math.min(W - g.x - g.w, Math.max(-g.x, d)), clampY = d => Math.min(H - g.y - g.h, Math.max(-g.y, d));
    dx = clampX(dx); dy = clampY(dy);
    // ההזזות האפשריות בכל ציר, עם הבונוס ליישור: מקום שמיושר לטקסט אחר עדיף, גם אם הוא מעט רחוק יותר
    const xs = new Map(), ys = new Map();
    const add = (m, clamp, raw, d, bonus) => {
      d = Math.round(clamp(d) * 2) / 2;
      if (Math.abs(d - raw) <= reach && !(m.get(d) >= bonus)) m.set(d, bonus);
    };
    const snapX = size * 0.8, snapY = size * 0.6;
    for (let k = -12; k <= 12; k++) { add(xs, clampX, dx, dx + k * step, 0); add(ys, clampY, dy, dy + k * step, 0); }
    // עמודה: קצה ימין (עברית נכתבת מימין), מרכז, קצה שמאל
    for (const r of refs) {
      add(xs, clampX, dx, r.x + r.w - (box.x + box.w), snapX);
      add(xs, clampX, dx, r.x + r.w / 2 - (box.x + box.w / 2), snapX * 0.9);
      add(xs, clampX, dx, r.x - box.x, snapX * 0.8);
      add(ys, clampY, dy, lineBase(r) - lineBase(box), snapY);
    }
    add(xs, clampX, dx, W / 2 - (box.x + box.w / 2), snapX * 0.9);   // מרכז העמוד

    let best = { dx, dy }, bestCost = Infinity;
    for (const [ddx, bx] of xs) {
      for (const [ddy, by] of ys) {
        const r = { x: g.x + ddx - padX, y: g.y + ddy - padY, w: g.w + 2 * padX, h: g.h + 2 * padY }, area = r.w * r.h;
        let cost = Math.hypot(ddx - dx, (ddy - dy) * 1.3) - bx - by;
        // עולה על טקסט: עונש גדול מכל מרחק בתחום החיפוש, כך שמקום פנוי תמיד עדיף. אין מקום פנוי – הכי פחות חפיפה
        const n = ink(r);
        if (n > Math.max(3, area * 0.003)) cost += size * 20 + n / area * size * 30;
        for (const t of taken) {
          const o = overlap(r, t);
          if (o > 1) cost += size * 20 + o / area * size * 30;
        }
        if (cost < bestCost) { bestCost = cost; best = { dx: ddx, dy: ddy }; }
      }
    }
    return best;
  };
}

function union(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
