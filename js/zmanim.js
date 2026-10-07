/**
 * זמני היום למיקום נתון. כל הזמנים במילישניות UTC.
 * שעות זמניות לפי הגר"א: מהנץ עד השקיעה.
 * לפי המג"א: מעלות השחר 72 דקות לפני הנץ עד 72 דקות אחרי השקיעה.
 */

import { sunEvent, ZENITH } from './astro.js';

const MIN = 60000;

export function zmanim(dayNum, lat, lng) {
  const sunrise = sunEvent(dayNum, lat, lng, ZENITH.SUNRISE, true);
  const sunset = sunEvent(dayNum, lat, lng, ZENITH.SUNRISE, false);
  const z = {
    sunrise, sunset,
    alotHaShachar: sunEvent(dayNum, lat, lng, ZENITH.ALOT, true),
    tzeit: sunEvent(dayNum, lat, lng, ZENITH.TZEIT, false)
  };
  if (sunrise != null && sunset != null) {
    const hour = (sunset - sunrise) / 12;
    const at = h => sunrise + h * hour;
    const alot72 = sunrise - 72 * MIN, hourMGA = (sunset - sunrise + 144 * MIN) / 12;
    Object.assign(z, {
      sofZmanShma: at(3),
      sofZmanShmaMGA: alot72 + 3 * hourMGA,
      chatzot: at(6),
      minchaGedola: at(6.5),
      minchaKetana: at(9.5),
      plagHaMincha: at(10.75)
    });
  }
  return z;
}

/**
 * עיגול לדקה שלמה, לצד המחמיר:
 * זמנים שעד אליהם צריך להספיק מעוגלים למטה, זמנים שמהם מותר להתחיל מעוגלים למעלה.
 */
const ROUND_UP = new Set(['alotHaShachar', 'sunrise', 'tzeit', 'havdalah', 'minchaGedola', 'minchaKetana', 'plagHaMincha']);

export function roundZman(key, ms) {
  if (ms == null) return null;
  return ROUND_UP.has(key) ? Math.ceil(ms / MIN) * MIN : Math.floor(ms / MIN) * MIN;
}
