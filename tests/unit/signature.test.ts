import { describe, expect, it } from 'vitest';
import { bytesToDataUrl, dataUrlToBytes, loadSaved, removeSaved, saveSignature } from '../../src/tools/signature/saved';
import { putImage, getImage } from '../../src/tools/image/store';

/** localStorage בזיכרון */
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const url = (n: number) => 'data:image/png;base64,' + btoa('sig' + n);

describe('saved signatures', () => {
  it('newest first, no duplicates, at most 6', () => {
    const s = memory();
    for (let i = 0; i < 8; i++) expect(saveSignature(url(i), s)).toBe(true);
    saveSignature(url(5), s);
    const list = loadSaved(s);
    expect(list).toHaveLength(6);
    expect(list[0]).toBe(url(5));
    expect(list.filter((x) => x === url(5))).toHaveLength(1);
    expect(list).not.toContain(url(0));
  });

  it('remove', () => {
    const s = memory();
    saveSignature(url(1), s);
    saveSignature(url(2), s);
    removeSaved(url(1), s);
    expect(loadSaved(s)).toEqual([url(2)]);
  });

  it('survives blocked or broken storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSaved(blocked)).toEqual([]);
    expect(saveSignature(url(1), blocked)).toBe(false);
    expect(() => removeSaved(url(1), blocked)).not.toThrow();
    expect(loadSaved(null)).toEqual([]);
    const junk = memory();
    junk.setItem('pdf-editor.signatures', '{not json');
    expect(loadSaved(junk)).toEqual([]);
    junk.setItem('pdf-editor.signatures', JSON.stringify(['javascript:alert(1)', 5, url(3)]));
    expect(loadSaved(junk)).toEqual([url(3)]);
  });

  it('a too large signature is not saved', () => {
    const s = memory();
    expect(saveSignature('data:image/png;base64,' + 'A'.repeat(500_000), s)).toBe(false);
    expect(loadSaved(s)).toEqual([]);
  });

  it('data URL round trip goes back to the same image in the store', () => {
    // PNG מינימלי: חתימה + IHDR (רוחב 3, גובה 2) – מספיק ל-sniff
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0,
      0,
    ]);
    const back = dataUrlToBytes(bytesToDataUrl(png, 'image/png'));
    expect(back).toEqual(png);
    expect(putImage(back)).toBe(putImage(png));
    expect(getImage(putImage(back))).toMatchObject({ width: 3, height: 2 });
  });
});
