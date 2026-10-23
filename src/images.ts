import { spawnSync } from 'node:child_process';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import { pngPixels } from './evidence-text.js';

/** A smaller copy of a still the board shows in place of the original: light on a card and the update's own screen, thumb in a list.
 * Each fits its box (width, height) and is never enlarged; at twice device pixels it stays as sharp as the frame shows it. A light copy is
 * bounded by its width (the height bound only stops runaway pages): a full-page capture is shown whole on a card and from its top across a
 * wide frame, so its width is what keeps it sharp.
 * Every frame a thumb fills crops the picture to its own shape, from the top and centred, and none is more than twice as tall as it is wide
 * or twice as wide as it is tall: a thumb keeps only that part, so its short side still fills the frame. */
const BOXES = { light: [1600, 16384], thumb: [720, 1440] } as const;
export type Size = keyof typeof BOXES;
export type Copy = { ext: '.jpg' | '.png'; bytes: Buffer; width: number; height: number };
/** JPEG quality, with no chroma subsampling (jpeg-js keeps every pixel's colour), so coloured text and thin lines keep their edges. */
const QUALITY = 82;
/** A still larger than this is shown as it is: decoding it would hold gigabytes in memory. */
const PIXELS_MAX = 60_000_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Picture = { width: number; height: number; data: Buffer; opaque: boolean; icc?: Buffer; png: Buffer[]; gammaOnly: boolean };

/** The light and thumb copies of a still, each kept only when it weighs less than what the board would show without it (the light copy,
 * else the original). The same bytes always give the same copies. `reason` says why a still could not be read: the board then shows the original. */
export function copiesOf(bytes: Buffer, ext: string): { light?: Copy; thumb?: Copy; reason?: string } {
  let pic: Picture;
  try { pic = decode(bytes, ext.toLowerCase()); } catch (e: any) { return { reason: e.message }; }
  const light = shrink(pic, 'light', bytes.length), thumb = shrink(pic, 'thumb', light?.bytes.length ?? bytes.length);
  return { ...(light && { light }), ...(thumb && { thumb }) };
}

function shrink(pic: Picture, size: Size, against: number): Copy | undefined {
  if (size === 'thumb' && pic.height > pic.width * 2) {
    const height = pic.width * 2;
    pic = { ...pic, height, data: pic.data.subarray(0, pic.width * height * 4) };
  } else if (size === 'thumb' && pic.width > pic.height * 2) {
    const width = pic.height * 2, left = (pic.width - width) >> 1, data = Buffer.alloc(width * pic.height * 4);
    for (let y = 0; y < pic.height; y++) pic.data.copy(data, y * width * 4, (y * pic.width + left) * 4, (y * pic.width + left + width) * 4);
    pic = { ...pic, width, data };
  }
  const [bw, bh] = BOXES[size], scale = Math.min(1, bw / pic.width, bh / pic.height);
  const width = Math.max(1, Math.round(pic.width * scale)), height = Math.max(1, Math.round(pic.height * scale));
  const data = scale < 1 ? resize(pic, width, height) : pic.data;
  // The lighter of a PNG and a JPEG; a JPEG only for a picture with no transparency and no colour rule a JPEG cannot carry.
  const png = encodePng(data, width, height, pic);
  const jpg = pic.opaque && !pic.gammaOnly ? encodeJpeg(data, width, height, pic.icc) : undefined;
  const best = jpg && jpg.length < png.length ? { ext: '.jpg' as const, bytes: jpg } : { ext: '.png' as const, bytes: png };
  return best.bytes.length < against ? { ...best, width, height } : undefined;
}

class Undecodable extends Error {}
function decode(bytes: Buffer, ext: string): Picture {
  let pic: Omit<Picture, 'opaque'>, turn = 1;
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const chunks = pngChunks(bytes), names = new Set(chunks.map((c) => c.name));
    if (names.has('acTL')) throw new Undecodable('it is an animated PNG');
    size(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    const px = pngPixels(bytes, 4);
    if (!px) throw new Undecodable('its PNG data could not be read');
    const iccp = chunks.find((c) => c.name === 'iCCP')?.data, at = iccp ? iccp.indexOf(0) : -1;
    const icc = iccp && at > 0 ? inflateSync(iccp.subarray(at + 2)) : undefined;
    const exif = chunks.find((c) => c.name === 'eXIf')?.data;
    turn = exif ? orientation(exif) : 1;
    pic = { ...px, icc, png: chunks.filter((c) => ['iCCP', 'sRGB', 'gAMA', 'cHRM'].includes(c.name)).map((c) => c.raw),
      gammaOnly: (names.has('gAMA') || names.has('cHRM')) && !names.has('sRGB') && !names.has('iCCP') };
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const segments = jpegSegments(bytes);
    const app1 = segments.find((s) => s.marker === 0xe1 && s.data.subarray(0, 6).toString('latin1') === 'Exif\0\0');
    turn = app1 ? orientation(app1.data.subarray(6)) : 1;
    const icc = Buffer.concat(segments.filter((s) => s.marker === 0xe2 && s.data.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0').map((s) => s.data.subarray(14)));
    const sof = segments.find((s) => s.marker >= 0xc0 && s.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(s.marker));
    if (sof) size(sof.data.readUInt16BE(3), sof.data.readUInt16BE(1));
    let px;
    try { px = jpeg.decode(bytes, { formatAsRGBA: true, maxResolutionInMP: PIXELS_MAX / 1e6, maxMemoryUsageInMB: 1024 }); } catch { throw new Undecodable('its JPEG data could not be read'); }
    // A PNG copy carries the same profile, in its own iCCP chunk.
    pic = { width: px.width, height: px.height, data: px.data, ...(icc.length && { icc }), gammaOnly: false,
      png: icc.length ? [chunk('iCCP', Buffer.concat([Buffer.from('ICC\0\0', 'latin1'), deflateSync(icc)]))] : [] };
  } else if (ext === '.webp' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    // WebP has no decoder in Node: ImageMagick reads it when it is installed, as the still guard does. A WebP is already compact, so without it the original is shown.
    if (bytes.includes('ANMF')) throw new Undecodable('it is an animated WebP');
    const out = spawnSync('convert', ['webp:-[0]', 'png32:-'], { input: bytes, maxBuffer: 1 << 30, timeout: 30_000, killSignal: 'SIGKILL' });
    if (out.status !== 0 || !out.stdout.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Undecodable(out.error ? 'reading a WebP needs ImageMagick (convert), which is not installed' : 'its WebP data could not be read');
    return decode(out.stdout, '.png');
  } else throw new Undecodable('it is not a PNG, JPEG or WebP picture');
  if (pic.icc && pic.icc.subarray(16, 20).toString('latin1') !== 'RGB ') throw new Undecodable('its colour profile is not an RGB one');
  const turned = turn > 1 ? rotate(pic, turn) : pic;
  let opaque = true;
  for (let i = 3; i < turned.data.length; i += 4) if (turned.data[i] !== 255) { opaque = false; break; }
  return { ...turned, opaque };
}
const size = (width: number, height: number) => {
  if (!width || !height || width * height > PIXELS_MAX) throw new Undecodable(`it is ${width} by ${height} pixels, over the ${PIXELS_MAX / 1e6} million the board shrinks`);
};

const pngChunks = (buf: Buffer) => {
  const chunks: { name: string; data: Buffer; raw: Buffer }[] = [];
  for (let at = 8; at + 12 <= buf.length;) {
    const len = buf.readUInt32BE(at), name = buf.toString('latin1', at + 4, at + 8);
    chunks.push({ name, data: buf.subarray(at + 8, at + 8 + len), raw: buf.subarray(at, at + 12 + len) });
    if (name === 'IEND') break;
    at += 12 + len;
  }
  return chunks;
};
/** A JPEG's marker segments up to the image data. */
const jpegSegments = (buf: Buffer) => {
  const segments: { marker: number; data: Buffer }[] = [];
  for (let at = 2; at + 4 <= buf.length && buf[at] === 0xff;) {
    const marker = buf[at + 1], len = buf.readUInt16BE(at + 2);
    segments.push({ marker, data: buf.subarray(at + 4, at + 2 + len) });
    if (marker === 0xda) break;
    at += 2 + len;
  }
  return segments;
};
/** The EXIF orientation (1 to 8) in a TIFF block, 1 when it has none: a phone photo stored on its side says how to turn it upright. */
function orientation(tiff: Buffer): number {
  try {
    const le = tiff.toString('latin1', 0, 2) === 'II', u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const ifd = le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
    for (let i = 0, n = u16(ifd); i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
    }
  } catch { /* a broken EXIF block turns nothing */ }
  return 1;
}
/** The picture turned upright, as a browser shows the original from its EXIF orientation: the copies carry no EXIF of their own. */
function rotate<P extends { width: number; height: number; data: Buffer }>(pic: P, turn: number): P {
  const { width: w, height: h, data } = pic, swap = turn >= 5, W = swap ? h : w, H = swap ? w : h, out = Buffer.alloc(data.length);
  const from: Record<number, (x: number, y: number) => [number, number]> = {
    2: (x, y) => [w - 1 - x, y], 3: (x, y) => [w - 1 - x, h - 1 - y], 4: (x, y) => [x, h - 1 - y],
    5: (x, y) => [y, x], 6: (x, y) => [y, h - 1 - x], 7: (x, y) => [w - 1 - y, h - 1 - x], 8: (x, y) => [w - 1 - y, x],
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [sx, sy] = from[turn](x, y);
    data.copy(out, (y * W + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
  }
  return { ...pic, width: W, height: H, data: out };
}

/** Area-average downscale: each new pixel is the mean of the source pixels it covers, weighted by alpha so transparent edges keep no dark
 * fringe. It runs one output row at a time, so memory stays a row, not a second picture. */
function resize(pic: Picture, W: number, H: number): Buffer {
  const { width: w, height: h, data } = pic;
  // Each output column or row: the first source index it covers, how many, and how much of each (flat, so the loops stay on typed arrays).
  const spans = (n: number, N: number) => {
    const most = Math.ceil(n / N) + 1, first = new Int32Array(N), count = new Int32Array(N), share = new Float64Array(N * most);
    for (let j = 0; j < N; j++) {
      const a = (j * n) / N, b = ((j + 1) * n) / N;
      first[j] = Math.floor(a);
      for (let i = first[j]; i < Math.min(n, Math.ceil(b)); i++) share[j * most + count[j]++] = Math.min(b, i + 1) - Math.max(a, i);
    }
    return { first, count, share, most };
  };
  const xs = spans(w, W), ys = spans(h, H), area = (w / W) * (h / H), sum = new Float64Array(W * 4), out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    sum.fill(0);
    for (let k = 0; k < ys.count[y]; k++) {
      const row = (ys.first[y] + k) * w, wy = ys.share[y * ys.most + k];
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let t = 0, o = (row + xs.first[x]) * 4; t < xs.count[x]; t++, o += 4) {
          const al = data[o + 3] * xs.share[x * xs.most + t];
          r += data[o] * al; g += data[o + 1] * al; b += data[o + 2] * al; a += al;
        }
        sum[x * 4] += r * wy; sum[x * 4 + 1] += g * wy; sum[x * 4 + 2] += b * wy; sum[x * 4 + 3] += a * wy;
      }
    }
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, a = sum[x * 4 + 3];
      out[o + 3] = Math.round(a / area);
      if (a) { out[o] = Math.round(sum[x * 4] / a); out[o + 1] = Math.round(sum[x * 4 + 1] / a); out[o + 2] = Math.round(sum[x * 4 + 2] / a); }
    }
  }
  return out;
}

function encodeJpeg(data: Buffer, width: number, height: number, icc?: Buffer): Buffer {
  const out = jpeg.encode({ data, width, height }, QUALITY).data;
  if (!icc) return out;
  // The colour profile goes right after the JFIF header, split in segments of at most 65519 bytes, as ICC.1 for JPEG says.
  const parts: Buffer[] = [], max = 65519, count = Math.ceil(icc.length / max), app0 = 4 + out.readUInt16BE(4);
  for (let n = 0; n < count; n++) {
    const body = icc.subarray(n * max, (n + 1) * max), head = Buffer.alloc(18);
    head.writeUInt16BE(0xffe2, 0); head.writeUInt16BE(16 + body.length, 2); head.write('ICC_PROFILE\0', 4, 'latin1'); head[16] = n + 1; head[17] = count;
    parts.push(head, body);
  }
  return Buffer.concat([out.subarray(0, app0), ...parts, out.subarray(app0)]);
}

const chunk = (name: string, data: Buffer) => {
  const head = Buffer.alloc(8), tail = Buffer.alloc(4), body = Buffer.concat([Buffer.from(name, 'latin1'), data]);
  head.writeUInt32BE(data.length, 0); head.write(name, 4, 'latin1'); tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, data, tail]);
};
/** An 8-bit PNG, RGB when every pixel is opaque, with the original's colour chunks; each row takes the filter whose bytes sum smallest. */
function encodePng(data: Buffer, width: number, height: number, pic: Picture): Buffer {
  const ch = pic.opaque ? 3 : 4, stride = width * ch, raw = Buffer.alloc((stride + 1) * height), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  const tries = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) for (let c = 0; c < ch; c++) cur[x * ch + c] = data[(y * width + x) * 4 + c];
    let best = 0, least = Infinity;
    for (let f = 0; f < 5; f++) {
      const t = tries[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const predict = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        const v = (cur[i] - predict) & 0xff;
        t[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < least) { least = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    tries[best].copy(raw, y * (stride + 1) + 1);
    cur.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = pic.opaque ? 2 : 6;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), ...pic.png, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
