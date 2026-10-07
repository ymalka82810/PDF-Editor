/**
 * שמירת קובץ למשתמש. בדפדפן – הורדה. (סשן E מחליף/מרחיב לאנדרואיד עם Capacitor)
 */
export async function saveBytes(name: string, bytes: Uint8Array, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** שם לקובץ שנשמר: "x.pdf" ← "x-edited.pdf" */
export function editedName(name: string) {
  return name.replace(/\.[^.]+$/, '') + '-edited.pdf';
}
