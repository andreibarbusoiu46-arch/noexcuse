// Evidence fingerprints: SHA-256 for exact duplicates, dHash (64-bit difference hash) for
// near-duplicates — the same image re-encoded, resized or slightly cropped.
import jpeg from "npm:jpeg-js@0.4.4";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** dHash of RGBA pixels: 9×8 area-sampled grayscale, one bit per horizontal gradient. */
export function dhashFromRgba(data: Uint8Array | Uint8ClampedArray, width: number, height: number): string {
  const W = 9, H = 8;
  const g = new Float64Array(W * H);
  for (let cy = 0; cy < H; cy++) {
    const y0 = Math.floor((cy * height) / H), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / H));
    const sy = Math.max(1, Math.floor((y1 - y0) / 16));
    for (let cx = 0; cx < W; cx++) {
      const x0 = Math.floor((cx * width) / W), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / W));
      const sx = Math.max(1, Math.floor((x1 - x0) / 16));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y += sy) {
        for (let x = x0; x < x1; x += sx) {
          const i = (y * width + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      g[cy * W + cx] = n ? sum / n : 0;
    }
  }
  let hex = "";
  for (let cy = 0; cy < H; cy++) {
    let byte = 0;
    for (let cx = 0; cx < 8; cx++) byte = (byte << 1) | (g[cy * W + cx] > g[cy * W + cx + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Null when the bytes aren't a decodable JPEG (the SHA still protects against exact reuse). */
export function dhashFromJpeg(bytes: Uint8Array): string | null {
  try {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256, maxResolutionInMP: 40 });
    return dhashFromRgba(img.data, img.width, img.height);
  } catch {
    return null;
  }
}

export function hammingHex(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
