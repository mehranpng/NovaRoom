export type AudioMetadata = {
  title?: string;
  artist?: string;
  coverUrl?: string;
};

export type AudioTags = {
  title?: string;
  artist?: string;
  cover?: Blob;
};

function latin1(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  let label = 'iso-8859-1';
  if (encoding === 1) label = 'utf-16';
  else if (encoding === 2) label = 'utf-16be';
  else if (encoding === 3) label = 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes).replace(/\0+$/, '').trim();
  } catch {
    return latin1(bytes, 0, bytes.length).replace(/\0+$/, '').trim();
  }
}

function readSyncSafe(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
}

function readInt32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function readPicture(data: Uint8Array, isV22: boolean, encoding: number): Blob | undefined {
  let mime = 'image/jpeg';
  let i = 1;
  if (isV22) {
    mime = `image/${latin1(data, i, 3).toLowerCase().replace('jpg', 'jpeg')}`;
    i += 3;
  } else {
    const mimeStart = i;
    while (i < data.length && data[i] !== 0) i += 1;
    mime = latin1(data, mimeStart, i - mimeStart) || mime;
    i += 1;
  }
  i += 1;
  if (encoding === 1 || encoding === 2) {
    while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < data.length && data[i] !== 0) i += 1;
    i += 1;
  }
  const image = data.subarray(i);
  if (!image.length) return undefined;
  return new Blob([image as BlobPart], { type: mime });
}

export function readAudioTags(buffer: ArrayBuffer, withCover = true): AudioTags | undefined {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== 'ID3') return undefined;

  const version = bytes[3];
  const isV22 = version === 2;
  const tagSize = readSyncSafe(bytes, 6);
  const tagEnd = Math.min(bytes.length, 10 + tagSize);
  const tags: AudioTags = {};
  let offset = 10;

  while (offset < tagEnd) {
    let id: string;
    let frameSize: number;
    let headerSize: number;
    if (isV22) {
      if (offset + 6 > tagEnd) break;
      id = latin1(bytes, offset, 3);
      frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
      headerSize = 6;
    } else {
      if (offset + 10 > tagEnd) break;
      id = latin1(bytes, offset, 4);
      frameSize = version === 4 ? readSyncSafe(bytes, offset + 4) : readInt32(bytes, offset + 4);
      headerSize = 10;
    }
    if (!id.trim() || frameSize <= 0) break;
    const dataStart = offset + headerSize;
    const data = bytes.subarray(dataStart, Math.min(bytes.length, dataStart + frameSize));
    if (!data.length) break;

    if (id === 'TIT2' || id === 'TT2') tags.title = decodeText(data.subarray(1), data[0]);
    else if (id === 'TPE1' || id === 'TP1') tags.artist = decodeText(data.subarray(1), data[0]);
    else if (withCover && (id === 'APIC' || id === 'PIC') && !tags.cover) tags.cover = readPicture(data, id === 'PIC', data[0]);

    offset = dataStart + frameSize;
  }

  return tags;
}

export function readAudioMetadata(buffer: ArrayBuffer, withCover = true): AudioMetadata | undefined {
  const tags = readAudioTags(buffer, withCover);
  if (!tags) return undefined;
  return {
    title: tags.title,
    artist: tags.artist,
    coverUrl: tags.cover ? URL.createObjectURL(tags.cover) : undefined,
  };
}

export async function createCoverDataUrl(cover: Blob, maxSize = 160): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(cover);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return undefined;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}
