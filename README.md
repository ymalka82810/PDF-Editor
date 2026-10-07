# עורך PDF – תבנית מלוח קיים

העתק של הקוד מפרויקט "זמנים" שמאפשר להעלות קובץ PDF (או תמונה), לזהות בו את הטקסט,
לסמן אזורים, לערוך/להחליף/להזיז טקסט ולשמור את התוצאה כתמונה או כקובץ PDF חדש.

מקור: הפרויקט Zmanim (התיקייה `js/` ו-`vendor/pdfjs/`), גרסה מ-7.10.2026 (commit cc20042).

## איך זה עובד
1. **קריאת הקובץ** – `template-read.js` (`readFile`) טוען את pdf.js, מצייר את העמוד הראשון ל-canvas
   ומחלץ את כל פריטי הטקסט עם המיקום, הגודל, הצבע והגופן של כל אחד. גופנים מוטמעים נשלפים מהקובץ.
   בתמונה או במסמך סרוק – זיהוי טקסט (OCR) עם tesseract.js מ-CDN.
2. **העורך** – `template-ui.js` מציג את העמוד, מסמן אזורים (`tplBoxes`), ומאפשר:
   סימון אזור חדש, עריכת כל טקסט בעמוד (`text-edit.js`), והזזת אזורים (`template-place.js` מוצא מקום פנוי מיושר לשורה ולעמודה).
3. **ציור התוצאה** – `template-render.js` (`templateCanvas`) מוחק את הטקסט הישן מהרקע ומצייר את הטקסט החדש
   באותו גופן, צבע וגודל. `font-fill.js` משלים אותיות שחסרות בגופן המוטמע (מהגופנים שבמחשב או מקובץ גופן, עם opentype.js מ-CDN).
4. **ייצוא** – `image.js`: `pngBlob` לתמונה, `pdfBlob` ליצירת PDF מ-canvas בלי ספריות חיצוניות.

## הקבצים
| קובץ | תפקיד |
|---|---|
| `js/template-read.js` | קריאת PDF/תמונה, חילוץ טקסט וגופנים, OCR, זיהוי תאריכים/שעות |
| `js/template-ui.js` | העורך עצמו (ממשק, אזורים, שמירה). נקודות כניסה: `editFromFile`, `editExisting`, `editFromBoard` |
| `js/template-render.js` | מחיקת הטקסט הישן וציור הטקסט החדש על העמוד |
| `js/template-place.js` | הנחת אזור שהוזז במקום פנוי מיושר |
| `js/text-edit.js` | חלונית עריכת טקסט |
| `js/font-fill.js` | השלמת אותיות חסרות בגופן המוטמע |
| `js/image.js` | יצירת PNG ו-PDF מ-canvas |
| `js/dialog.js` | `SiteDialog` (alert/confirm) – סקריפט רגיל, לא מודול, נטען לפני השאר |
| `vendor/pdfjs/` | pdf.js 6.3.289 (רישיון Apache 2.0) |
| `editor-section.html` | ה-HTML של מסך העורך (מתוך `index.html`) – ה-IDs שלו נדרשים ל-`template-ui.js` |
| `css/app.css` | העיצוב של האתר, כולל מחלקות `tpl-*` של העורך |

קבצים שהועתקו רק כי העורך תלוי בהם (לוגיקת זמנים ולוח עברי):
`config.js`, `luach.js`, `dates.js`, `hebrew.js`, `zmanim.js`, `moadim.js`, `astro.js`, `render.js`.

## שימוש בפרויקט אחר
```html
<link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/app.css">
<!-- כאן להדביק את התוכן של editor-section.html -->
<script src="js/dialog.js"></script>
<script type="module">
  import { editFromFile } from './js/template-ui.js';
  // file – קובץ PDF מ-<input type="file">; cfg – הגדרות (ראו config.js); tpl – אובייקט תבנית עם rules
  await editFromFile(file, cfg, tpl, result => { /* result.template – העיצוב השמור, או null בביטול */ }, msg => console.log(msg));
  document.getElementById('view-template').hidden = false;
</script>
```
- צריך שרת (לא `file://`), כי המודולים ו-pdf.js נטענים כ-ES modules.
- דוגמה מלאה לחיבור נמצאת בפרויקט המקורי ב-`js/app.js` (הפונקציות `templateDone` ו-`$('tplFile').onchange`).
- העורך בנוי ללוחות זמנים: הוא מזהה שעות, תאריכים ופרשה. לעורך PDF כללי, החלקים שכדאי לשמור הם
  `readFile` (קריאה), `templateCanvas` (ציור), `font-fill.js`, `text-edit.js` ו-`pdfBlob`; הזיהוי של זמני תפילה
  (`suggestSlots`, `ruleOptions` וכו' ב-`template-read.js`) אפשר להסיר.
