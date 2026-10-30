import type { SourceImage } from '@huecraft/engine';

/** Longest edge kept in memory. 4096 px covers 400 mm at 0.1 mm resolution. */
const MAX_EDGE = 4096;

export interface LoadedImage {
  source: SourceImage;
  bitmap: ImageBitmap;
  thumbnail: string;
}

export async function decodeImage(blob: Blob): Promise<LoadedImage> {
  let bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale < 1) {
    const resized = await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * scale),
      resizeHeight: Math.round(bitmap.height * scale),
      resizeQuality: 'high',
    });
    bitmap.close();
    bitmap = resized;
  }

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  return {
    source: { width: bitmap.width, height: bitmap.height, rgba: data.data },
    bitmap,
    thumbnail: await makeThumbnail(bitmap),
  };
}

async function makeThumbnail(bitmap: ImageBitmap): Promise<string> {
  const edge = 160;
  const s = edge / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * s));
  const h = Math.max(1, Math.round(bitmap.height * s));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
