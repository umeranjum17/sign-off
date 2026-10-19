import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** A picture of text (a log, receipt or summary) is a few colours: paper, ink and their anti-aliased blends, with no large flat block of a
 * third colour. A real capture of the product has colour, images and icons off that line, or a grey panel covering a good part of the
 * picture. Measured on the calibration set in the PR: text renders, lossy ones too, have at most 0.01% of pixels off the line and a flat
 * third colour of 1.7% at most; real captures have 1.5% or more off the line and a flat third colour of 8.9% or more. */
const OFF_LINE_MAX = 0.005;
/** The largest flat area in a third colour (any colour but the paper or the ink), as a share of the picture. */
const SOLID_MAX = 0.04;
export type Fault = 'text' | 'colour bars' | 'placeholder';
/** A saturated colour is at least this far between its brightest and dimmest channel; a colour band must cover this share of the picture.
 * A colour-bar card has at least five such bands, together most of the picture; the real captures measured have one at most. */
const SATURATED = 96;
const BAND_MIN = 0.05;
const BARS_MIN = 5;
const BARS_SHARE_MIN = 0.6;
/** A placeholder is one flat colour over this share of the picture; the real captures measured top out at 75%, the text renders are text. */
const PLACEHOLDER_MIN = 0.9;
/** A picture with no ink at all (a flat colour) is not text, so it passes. */
const INK_MIN = 0.005;
/** How close (0-255 RGB distance) a pixel must be to the paper or to the paper-ink line to count as text. */
const NEAR = 24;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Samples per pixel for each PNG colour type: grey, RGB, palette, grey with alpha, RGB with alpha. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Adam7 interlace passes: x start, y start, x step, y step. A non-interlaced PNG is one pass over every pixel. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
const WHOLE = [[0, 0, 1, 1]];

/** The share of pixels that are ink (a colour off the paper), of pixels off the paper-ink line, and of the largest flat area in any other colour,
 * or undefined when the file cannot be decoded. */
export function palette(file: string): { ink: number; off: number; solid: number; top: number; bars: number; barShare: number } | undefined {
  const rgb = decode(file);
  if (!rgb) return undefined;
  const total = rgb.length / 3, bins = new Uint32Array(32768);
  const centre = (b: number) => [(b >> 10) * 8 + 4, ((b >> 5) & 31) * 8 + 4, (b & 31) * 8 + 4];
  for (let i = 0; i < rgb.length; i += 3) bins[(rgb[i] >> 3) << 10 | (rgb[i + 1] >> 3) << 5 | (rgb[i + 2] >> 3)]++;
  const paperBin = bins.indexOf(Math.max(...bins)), paper = centre(paperBin);
  let inkBin = -1;
  for (let b = 0; b < bins.length; b++) {
    if (bins[b] && dist(centre(b), paper) > 128 && (inkBin < 0 || bins[b] > bins[inkBin])) inkBin = b;
  }
  let solid = 0;
  bins.forEach((count, b) => {
    if (b !== paperBin && b !== inkBin && count / total > solid) solid = count / total;
  });
  // Saturated flat colours: a colour-bar test card has several, each a band of the picture.
  let bars = 0, barShare = 0;
  bins.forEach((count, b) => {
    const c = centre(b), share = count / total;
    if (Math.max(...c) - Math.min(...c) >= SATURATED && share >= BAND_MIN) bars++, (barShare += share);
  });
  const top = bins[paperBin] / total;
  if (inkBin < 0) return { ink: 0, off: 0, solid: 0, top, bars, barShare };
  const [pr, pg, pb] = paper, [ar, ag, ab] = centre(inkBin).map((c, i) => c - paper[i]), len2 = ar * ar + ag * ag + ab * ab;
  let ink = 0, off = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const dr = rgb[i] - pr, dg = rgb[i + 1] - pg, db = rgb[i + 2] - pb;
    if (dr * dr + dg * dg + db * db <= NEAR * NEAR) continue;
    const t = Math.min(1, Math.max(0, (dr * ar + dg * ag + db * ab) / len2));
    const er = dr - t * ar, eg = dg - t * ag, eb = db - t * ab;
    if (er * er + eg * eg + eb * eb <= NEAR * NEAR) ink++;
    else off++;
  }
  return { ink: ink / total, off: off / total, solid, top, bars, barShare };
}

/** Why a still is not a picture of the product: text (a log, receipt or summary), colour bars (a test card) or a placeholder (a flat card
 * standing in for a picture). A file that cannot be decoded has no faults: it is not refused. */
export function faults(file: string): Fault[] {
  const share = palette(file);
  if (!share) return [];
  const text = share.ink >= INK_MIN && share.off <= OFF_LINE_MAX && share.solid <= SOLID_MAX;
  return [
    ...(text ? ['text' as const] : []),
    ...(share.bars >= BARS_MIN && share.barShare >= BARS_SHARE_MIN ? ['colour bars' as const] : []),
    ...(!text && share.top >= PLACEHOLDER_MIN ? ['placeholder' as const] : []),
  ];
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The picture as packed 8-bit RGB. PNG is decoded here; JPEG, WebP and any PNG this decoder refuses go through ImageMagick, when it is installed. */
function decode(file: string): Buffer | undefined {
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const own = pngRgb(bytes);
    if (own) return own;
  }
  const out = spawnSync('convert', [file, 'png24:-'], { maxBuffer: 1 << 30, timeout: 30_000 });
  return out.status === 0 && out.stdout.subarray(0, 8).equals(PNG_SIGNATURE) ? pngRgb(out.stdout) : undefined;
}

/** Packed 8-bit RGB of a PNG, every colour type and bit depth, interlaced or not. undefined for a PNG it does not read. */
function pngRgb(buf: Buffer): Buffer | undefined {
  try {
    let width = 0, height = 0, type = 0, depth = 0, interlace = 0, palette: Buffer | undefined;
    const idat: Buffer[] = [];
    for (let at = 8; at + 8 <= buf.length;) {
      const len = buf.readUInt32BE(at), name = buf.toString('latin1', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
      if (name === 'IHDR') [width, height, depth, type, interlace] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8], data[9], data[12]];
      else if (name === 'PLTE') palette = data;
      else if (name === 'IDAT') idat.push(data);
      else if (name === 'IEND') break;
      at += 12 + len;
    }
    const channels = CHANNELS[type];
    if (!channels || ![1, 2, 4, 8, 16].includes(depth) || (type === 3 && (!palette || depth > 8))) return undefined;
    const bits = channels * depth, bpp = Math.max(1, bits >> 3), raw = inflateSync(Buffer.concat(idat));
    const rgb = Buffer.alloc(width * height * 3);
    const to8 = (v: number) => (depth < 8 ? Math.round((v * 255) / ((1 << depth) - 1)) : v);
    let at = 0;
    for (const [x0, y0, dx, dy] of interlace ? ADAM7 : WHOLE) {
      const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const rowBytes = Math.ceil(pw * bits / 8), px = Buffer.alloc(rowBytes * ph);
      for (let y = 0; y < ph; y++, at += rowBytes + 1) {
        const filter = raw[at];
        for (let i = 0; i < rowBytes; i++) {
          const a = i >= bpp ? px[y * rowBytes + i - bpp] : 0, b = y ? px[(y - 1) * rowBytes + i] : 0;
          let predict = 0;
          if (filter === 1) predict = a;
          else if (filter === 2) predict = b;
          else if (filter === 3) predict = (a + b) >> 1;
          else if (filter === 4) {
            const c = i >= bpp && y ? px[(y - 1) * rowBytes + i - bpp] : 0, p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            predict = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          }
          px[y * rowBytes + i] = (raw[at + 1 + i] + predict) & 0xff;
        }
      }
      // The sample at index `n` of a row: a whole byte, a packed value of 1, 2 or 4 bits, or the high byte of 16 bits.
      const sample = (y: number, n: number) => {
        if (depth === 16) return px[y * rowBytes + n * 2];
        if (depth === 8) return px[y * rowBytes + n];
        const shift = 8 - depth - ((n * depth) & 7);
        return (px[y * rowBytes + ((n * depth) >> 3)] >> shift) & ((1 << depth) - 1);
      };
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const n = x * channels, o = ((y0 + y * dy) * width + x0 + x * dx) * 3;
          if (type === 3) {
            const k = sample(y, n) * 3;
            rgb[o] = palette![k] ?? 0;
            rgb[o + 1] = palette![k + 1] ?? 0;
            rgb[o + 2] = palette![k + 2] ?? 0;
          } else if (channels <= 2) {
            rgb[o] = rgb[o + 1] = rgb[o + 2] = to8(sample(y, n));
          } else {
            rgb[o] = to8(sample(y, n));
            rgb[o + 1] = to8(sample(y, n + 1));
            rgb[o + 2] = to8(sample(y, n + 2));
          }
        }
      }
    }
    return rgb;
  } catch {
    return undefined;
  }
}
