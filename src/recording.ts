/** Whether a file is a real recording, by its container and without decoding it: an mp4 whose top-level boxes include `ftyp`, `moov` and `mdat`,
 * or a webm whose EBML header names the `webm` doctype and holds a Segment with a Cluster of frames. A renamed picture or text file is neither. */
const u32 = (b: Buffer, at: number) => b.readUInt32BE(at);

function mp4(b: Buffer): boolean {
  const seen = new Set<string>();
  for (let at = 0; at + 8 <= b.length;) {
    let size = u32(b, at);
    const kind = b.toString('latin1', at + 4, at + 8);
    if (!/^[\x20-\x7e]{4}$/.test(kind)) return false;
    if (size === 1) { if (at + 16 > b.length) return false; size = Number(b.readBigUInt64BE(at + 8)); } else if (size === 0) size = b.length - at;
    if (size < 8 || at + size > b.length) return false;
    seen.add(kind);
    at += size;
  }
  return seen.has('ftyp') && seen.has('moov') && seen.has('mdat');
}

/** One EBML element's id and size at `at`, or undefined where the bytes do not hold one. An unknown size reads as the rest of the file. */
function ebml(b: Buffer, at: number): { id: number; head: number; size: number } | undefined {
  if (at >= b.length) return;
  const idLen = Math.clz32(b[at]) - 23;
  if (idLen < 1 || idLen > 4 || at + idLen >= b.length) return;
  const id = b.readUIntBE(at, idLen), first = b[at + idLen], sizeLen = Math.clz32(first) - 23;
  if (sizeLen < 1 || sizeLen > 8 || at + idLen + sizeLen > b.length) return;
  let size = first & (0xff >> sizeLen), unknown = size === (0xff >> sizeLen);
  for (let i = 1; i < sizeLen; i++) { size = size * 256 + b[at + idLen + i]; unknown &&= b[at + idLen + i] === 0xff; }
  return { id, head: idLen + sizeLen, size: unknown ? b.length - at - idLen - sizeLen : size };
}

function webm(b: Buffer): boolean {
  const head = ebml(b, 0);
  if (head?.id !== 0x1a45dfa3 || !b.toString('latin1', 0, Math.min(b.length, head.head + head.size)).includes('webm')) return false;
  const segment = ebml(b, head.head + head.size);
  if (segment?.id !== 0x18538067) return false;
  // Inside the Segment: a Tracks element, then a Cluster that holds the frames.
  const end = Math.min(b.length, head.head + head.size + segment.head + segment.size);
  const seen = new Set<number>();
  for (let at = head.head + head.size + segment.head; at < end;) {
    const e = ebml(b, at);
    if (!e) return false;
    seen.add(e.id);
    at += e.head + e.size;
  }
  return seen.has(0x1654ae6b) && seen.has(0x1f43b675);
}

export const isRecording = (bytes: Buffer, ext: string): boolean => {
  try { return ext.toLowerCase() === '.mp4' ? mp4(bytes) : ext.toLowerCase() === '.webm' ? webm(bytes) : false; } catch { return false; }
};
