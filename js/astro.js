/**
 * חישוב מיקום השמש (אלגוריתם NOAA).
 * כל הזמנים מוחזרים כמילישניות UTC (כמו Date.getTime()).
 * ימים מיוצגים כמספר ימים מאז 1970-01-01 (dayNum).
 */

const RAD = Math.PI / 180;

/** זנית (מעלות) לאירועים הנפוצים */
export const ZENITH = {
  SUNRISE: 90.833,     // זריחה/שקיעה מישורית עם שבירת אור
  ALOT: 90 + 16.1,     // עלות השחר
  TZEIT: 90 + 8.5      // צאת הכוכבים
};

function solar(T) {
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const dec = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.pow(Math.tan(eps * RAD / 2), 2);
  const eqTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) +
    4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
    0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  return { dec, eqTime };
}

/**
 * זמן אירוע שמש ביום המקומי dayNum.
 * lng חיובי למזרח. rising=true לבוקר, false לערב. מחזיר null אם השמש לא מגיעה לזווית.
 */
export function sunEvent(dayNum, lat, lng, zenith, rising) {
  let t = 720 - 4 * lng;
  for (let i = 0; i < 3; i++) {
    const T = (dayNum + 2440587.5 + t / 1440 - 2451545) / 36525;
    const { dec, eqTime } = solar(T);
    const cosH = (Math.cos(zenith * RAD) - Math.sin(lat * RAD) * Math.sin(dec * RAD)) /
      (Math.cos(lat * RAD) * Math.cos(dec * RAD));
    if (cosH > 1 || cosH < -1) return null;
    const H = Math.acos(cosH) / RAD;
    t = 720 - 4 * (lng + (rising ? H : -H)) - eqTime;
  }
  return dayNum * 86400000 + t * 60000;
}
