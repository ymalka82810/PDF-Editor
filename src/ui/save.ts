/**
 * שמירת קובץ למשתמש. בדפדפן – הורדה. באנדרואיד (Capacitor) – כתיבה לאחסון הזמני ושיתוף,
 * כדי שהמשתמש יבחר איפה לשמור (אפליקציית הקבצים, Drive וכו').
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function saveBytes(name: string, bytes: Uint8Array, type = 'application/pdf') {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
    await Share.share({ title: name, url: uri });
    return;
  }
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

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
