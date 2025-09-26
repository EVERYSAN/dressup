// src/utils/resizeImage.ts
export async function resizeFileToDataURL(
  file: File,
  opts?: { maxEdge?: number; mime?: string; quality?: number }
): Promise<string> {
  const { maxEdge = 1024, mime = 'image/webp', quality = 0.85 } = opts || {};
  const img = await new Promise<HTMLImageElement>((ok, err) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = err;
    i.src = URL.createObjectURL(file);
  });

  const { width, height } = img;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  const dataUrl = canvas.toDataURL(mime, quality);
  URL.revokeObjectURL(img.src);
  return dataUrl;
}

/** base64 部分の推定サイズ(MB)を返す */
export function base64SizeMB(dataUrlOrB64: string): number {
  const b64 = dataUrlOrB64.includes('base64,')
    ? dataUrlOrB64.split('base64,')[1]
    : dataUrlOrB64;
  const bytes = (b64.length * 3) / 4;
  return bytes / (1024 * 1024);
}
