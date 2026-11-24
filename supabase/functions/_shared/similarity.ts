// Crop-tolerant image similarity for duplicate evidence. Pure functions, no I/O.
//
// Each image gets a small grayscale signature (long side 48 px). Two images are compared by searching
// for a crop window of one that lines up with the whole of the other (up to ~10 % cut from each side,
// in any combination, plus any resize), scoring each window by Pearson correlation of 16×16 samples.
// Correlation ignores brightness and contrast, so re-encoded, resized, brightened and cropped copies
// score ≈ 1, while a new photo of the same place (camera moved, light changed, something moved) scores
// clearly lower. No faces or people are analysed: the signature is a blurred thumbnail of the whole frame.

export interface Signature { w: number; h: number; px: Uint8Array; aspect: number }

const LONG = 48;

/** Area-averaged grayscale thumbnail of an RGBA image. `aspect` is the original width / height. */
export function signatureFromRgba(data: Uint8Array | Uint8ClampedArray, width: number, height: number, long = LONG): Signature {
  const w = width >= height ? long : Math.max(8, Math.round((long * width) / height));
  const h = width >= height ? Math.max(8, Math.round((long * height) / width)) : long;
  const px = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    const y0 = Math.floor((ty * height) / h), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / h));
    const sy = Math.max(1, Math.floor((y1 - y0) / 6));
    for (let tx = 0; tx < w; tx++) {
      const x0 = Math.floor((tx * width) / w), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / w));
      const sx = Math.max(1, Math.floor((x1 - x0) / 6));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y += sy) {
        for (let x = x0; x < x1; x += sx) {
          const i = (y * width + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      px[ty * w + tx] = Math.round(n ? sum / n : 0);
    }
  }
  return { w, h, px, aspect: width / height };
}

/** Compact text form for storage: "w,h,aspect:base64". */
export function encodeSignature(s: Signature): string {
  let bin = "";
  for (const b of s.px) bin += String.fromCharCode(b);
  return `${s.w},${s.h},${s.aspect.toFixed(4)}:${btoa(bin)}`;
}

export function decodeSignature(text: string | null | undefined): Signature | null {
  if (!text) return null;
  const m = /^(\d{1,3}),(\d{1,3}),([0-9.]+):([A-Za-z0-9+/=]+)$/.exec(text);
  if (!m) return null;
  const w = +m[1], h = +m[2], aspect = +m[3];
  let bin: string;
  try { bin = atob(m[4]); } catch { return null; }
  if (w < 1 || h < 1 || bin.length !== w * h || !(aspect > 0)) return null;
  const px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = bin.charCodeAt(i);
  return { w, h, px, aspect };
}

/** True when the image has almost no detail (blank, black, a flat colour): such images can't be matched reliably. */
export function isFlat(s: Signature): boolean {
  let mean = 0;
  for (const v of s.px) mean += v;
  mean /= s.px.length;
  let varSum = 0;
  for (const v of s.px) varSum += (v - mean) ** 2;
  return Math.sqrt(varSum / s.px.length) < 6;
}

const MAX_CUT = 0.22; // up to 22 % may be cut per axis (≈ 10 % from each side)

/** Any grayscale-like grid: thumbnails (bytes) or high-pass detail maps (floats). */
interface Grid { w: number; h: number; px: ArrayLike<number>; aspect: number }
/** A crop window of `big`, in fractions of its width/height. */
export interface Window { x0: number; y0: number; fw: number; fh: number }
export interface Match { score: number; bigIsA: boolean; window: Window }

function bilinear(s: Grid, u: number, v: number): number {
  // u, v in [0, 1] across the image; sample pixel centres
  const x = Math.min(s.w - 1, Math.max(0, u * s.w - 0.5)), y = Math.min(s.h - 1, Math.max(0, v * s.h - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(s.w - 1, x0 + 1), y1 = Math.min(s.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = s.px[y0 * s.w + x0], b = s.px[y0 * s.w + x1], c = s.px[y1 * s.w + x0], d = s.px[y1 * s.w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function samples(s: Grid, w: Window, n: number, out: Float64Array): void {
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    out[j * n + i] = bilinear(s, w.x0 + ((i + 0.5) / n) * w.fw, w.y0 + ((j + 0.5) / n) * w.fh);
  }
}

function normalise(v: Float64Array): boolean {
  let m = 0;
  for (const x of v) m += x;
  m /= v.length;
  let ss = 0;
  for (let i = 0; i < v.length; i++) { v[i] -= m; ss += v[i] * v[i]; }
  const sd = Math.sqrt(ss);
  if (sd < 1e-6) return false;
  for (let i = 0; i < v.length; i++) v[i] /= sd;
  return true;
}

function valid(w: Window, ratio: number, slack: number): boolean {
  return w.fw <= 1 + 1e-9 && w.fh <= 1 + 1e-9 && w.fw >= 1 - MAX_CUT - slack && w.fh >= 1 - MAX_CUT - slack &&
    w.x0 >= -1e-9 && w.y0 >= -1e-9 && w.x0 + w.fw <= 1 + 1e-9 && w.y0 + w.fh <= 1 + 1e-9 && Math.abs(w.fh - w.fw * ratio) < 1e-6;
}

/**
 * Best correlation for "small is a crop (and/or resize) of big", with n×n samples.
 * Without `init` it searches all windows coarsely and refines the best three; with `init` it only refines.
 */
function bestWindow(big: Grid, small: Grid, n: number, init?: Window, step0 = 1 / 64): { c: number; window: Window } {
  const target = new Float64Array(n * n);
  samples(small, { x0: 0, y0: 0, fw: 1, fh: 1 }, n, target);
  if (!normalise(target)) return { c: 0, window: { x0: 0, y0: 0, fw: 1, fh: 1 } };
  const cand = new Float64Array(n * n);
  const score = (w: Window) => {
    samples(big, w, n, cand);
    if (!normalise(cand)) return -1;
    let c = 0;
    for (let i = 0; i < cand.length; i++) c += cand[i] * target[i];
    return c;
  };
  const ratio = big.aspect / small.aspect; // window height fraction = fw * ratio
  const starts: { c: number; w: Window }[] = [];
  if (init) starts.push({ c: score(init), w: init });
  else {
    for (let fw = 1; fw >= 1 - MAX_CUT - 1e-9; fw -= 0.025) {
      const fh = fw * ratio;
      if (fh > 1 + 1e-9 || fh < 1 - MAX_CUT - 1e-9) continue;
      const sx = Math.max(0, 1 - fw), sy = Math.max(0, 1 - Math.min(1, fh));
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
        const w = { x0: (sx * i) / 4, y0: (sy * j) / 4, fw, fh };
        starts.push({ c: score(w), w });
        if (sy === 0) break;
      }
    }
    starts.sort((a, b) => b.c - a.c);
  }
  if (!starts.length) return { c: 0, window: { x0: 0, y0: 0, fw: 1, fh: 1 } };
  let best = starts[0];
  for (const st of starts.slice(0, 3)) {
    let w = st.w, cur = st.c, step = step0, fstep = step0 * 0.8;
    for (let round = 0; round < 3; round++) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const [dx, dy, df] of [[step, 0, 0], [-step, 0, 0], [0, step, 0], [0, -step, 0], [0, 0, fstep], [0, 0, -fstep]]) {
          const nw = { x0: w.x0 + dx, y0: w.y0 + dy, fw: w.fw + df, fh: (w.fw + df) * ratio };
          if (!valid(nw, ratio, 0.02)) continue;
          const c = score(nw);
          if (c > cur + 1e-6) { cur = c; w = nw; improved = true; }
        }
      }
      step /= 2; fstep /= 2;
    }
    if (cur > best.c) best = { c: cur, w };
  }
  return { c: best.c, window: best.w };
}

/**
 * Stage 0 — a cheap screen (≈ 0.1 ms): 8×8 samples over 3 scales × 3×3 positions, both directions, no refinement.
 * Only pairs scoring at least QUICK_MIN go on to stage 1. Tuned so that no pair that passes stage 1 is lost.
 */
export const QUICK_MIN = 0.6;
export function quickScore(a: Signature, b: Signature): number {
  if (isFlat(a) || isFlat(b)) return 0;
  const one = (big: Signature, small: Signature) => {
    const n = 8, target = new Float64Array(n * n), cand = new Float64Array(n * n);
    samples(small, { x0: 0, y0: 0, fw: 1, fh: 1 }, n, target);
    if (!normalise(target)) return 0;
    const ratio = big.aspect / small.aspect;
    let best = -1;
    for (const fw of [1, 0.89, 0.78]) {
      const fh = fw * ratio;
      if (fh > 1 + 1e-9 || fh < 1 - MAX_CUT - 1e-9) continue;
      for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
        samples(big, { x0: ((1 - fw) * i) / 2, y0: ((1 - Math.min(1, fh)) * j) / 2, fw, fh }, n, cand);
        if (!normalise(cand)) continue;
        let c = 0;
        for (let k = 0; k < cand.length; k++) c += cand[k] * target[k];
        if (c > best) best = c;
      }
    }
    return best;
  };
  return Math.max(one(a, b), one(b, a));
}

/**
 * Stage 1 — stored thumbnails. Best correlation found when either image is treated as a crop/resize of
 * the other, with the window that produced it. Score 0 when either image is flat (no reliable match).
 */
export function cropMatch(a: Signature, b: Signature): Match {
  if (isFlat(a) || isFlat(b)) return { score: 0, bigIsA: true, window: { x0: 0, y0: 0, fw: 1, fh: 1 } };
  const ab = bestWindow(a, b, 16), ba = bestWindow(b, a, 16);
  return ab.c >= ba.c ? { score: ab.c, bigIsA: true, window: ab.window } : { score: ba.c, bigIsA: false, window: ba.window };
}

export function cropSimilarity(a: Signature, b: Signature): number {
  return cropMatch(a, b).score;
}

/** High-pass detail map (pixel minus its 5×5 local mean) of a grayscale thumbnail with the given long side. */
export function detailMap(data: Uint8Array | Uint8ClampedArray, width: number, height: number, long = 256): Grid {
  const t = signatureFromRgba(data, width, height, long);
  const { w, h } = t;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
      s += t.px[yy * w + xx]; n++;
    }
    out[y * w + x] = t.px[y * w + x] - s / n;
  }
  return { w, h, px: out, aspect: t.aspect };
}

/** Detail is compared at a scale both images can carry: half the smaller image's long side, 64–256 px. */
export function detailScale(a: { width: number; height: number }, b: { width: number; height: number }): number {
  const small = Math.min(Math.max(a.width, a.height), Math.max(b.width, b.height));
  return Math.max(64, Math.min(256, Math.round(small / 2)));
}

export interface Rgba { data: Uint8Array | Uint8ClampedArray; width: number; height: number }

/**
 * Stage 2 — full images, only for candidates that passed stage 1. Correlation of fine detail inside the
 * aligned window (refined at high resolution). A copy keeps its fine detail (≈ 0.8–1); a new photo of the
 * same scene — even taken seconds later — has different noise, focus and sub-degree rotation (≈ 0–0.5).
 */
export function detailSimilarity(a: Rgba, b: Rgba, coarse: Match): number {
  const L = detailScale(a, b);
  const da = detailMap(a.data, a.width, a.height, L), db = detailMap(b.data, b.width, b.height, L);
  const [big, small] = coarse.bigIsA ? [da, db] : [db, da];
  return bestWindow(big, small, Math.min(96, Math.round(L * 0.375)), coarse.window, 1 / (L * 1.5)).c;
}
