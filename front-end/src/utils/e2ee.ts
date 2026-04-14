const ENC_PREFIX = 'enc:v1:';
const ENC_NONCE_SIZE = 16;
const ENC_TAG_SIZE = 16;
const FILE_MAGIC = new TextEncoder().encode('NRF1');
const FILE_NONCE_SIZE = 16;
const FILE_TAG_SIZE = 16;

const enc = new TextEncoder();
const dec = new TextDecoder();

function getSharedSecret(): string {
  return import.meta.env.VITE_E2EE_SECRET || 'dev-secret-change-me';
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(sig);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function xorStream(data: Uint8Array, key: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  const out = new Uint8Array(data.length);
  let counter = 0;
  let idx = 0;
  while (idx < data.length) {
    const counterBytes = new Uint8Array(8);
    new DataView(counterBytes.buffer).setBigUint64(0, BigInt(counter), false);
    const block = await sha256(concatBytes(key, nonce, counterBytes));
    for (let j = 0; j < block.length && idx < data.length; j += 1) {
      out[idx] = data[idx] ^ block[j];
      idx += 1;
    }
    counter += 1;
  }
  return out;
}

async function deriveEncKey(token: string, scope: string): Promise<Uint8Array> {
  return sha256(enc.encode(`${getSharedSecret()}|${token}|${scope}`));
}

async function deriveLegacyKeys(token: string, scope: string): Promise<Uint8Array[]> {
  const tokenHintHex = Array.from(await sha256(enc.encode(String(token || '')))).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  return Promise.all([
    deriveEncKey(token, scope),
    sha256(enc.encode(`${getSharedSecret()}|shared|${scope}`)),
    sha256(enc.encode(`${getSharedSecret()}|${scope}|${tokenHintHex}`)),
    sha256(enc.encode(`${getSharedSecret()}|${token}|${scope}`)),
  ]);
}

export function isCiphertext(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export async function encryptScopedText(plain: string, token: string, scope: string): Promise<string> {
  const text = String(plain || '');
  if (!text) return '';
  if (isCiphertext(text)) return text;
  const key = await deriveEncKey(token, scope);
  const nonce = crypto.getRandomValues(new Uint8Array(ENC_NONCE_SIZE));
  const body = await xorStream(enc.encode(text), key, nonce);
  const tag = (await hmacSha256(key, concatBytes(nonce, body))).slice(0, ENC_TAG_SIZE);
  return `${ENC_PREFIX}${bytesToBase64Url(concatBytes(nonce, body, tag))}`;
}

export async function decryptScopedText(cipher: string, token: string, scope: string): Promise<string> {
  if (!isCiphertext(cipher)) return String(cipher || '');
  try {
    const raw = base64UrlToBytes(cipher.slice(ENC_PREFIX.length));
    if (raw.length < ENC_NONCE_SIZE + ENC_TAG_SIZE) return '';
    const nonce = raw.slice(0, ENC_NONCE_SIZE);
    const body = raw.slice(ENC_NONCE_SIZE, raw.length - ENC_TAG_SIZE);
    const tag = raw.slice(raw.length - ENC_TAG_SIZE);
    const keys = await deriveLegacyKeys(token, scope);
    for (const key of keys) {
      const expected = (await hmacSha256(key, concatBytes(nonce, body))).slice(0, ENC_TAG_SIZE);
      if (!equalBytes(tag, expected)) continue;
      const plain = await xorStream(body, key, nonce);
      return dec.decode(plain);
    }
    return '🔐';
  } catch {
    return '🔐';
  }
}

async function fileKey(): Promise<Uint8Array> {
  return sha256(enc.encode(`${getSharedSecret()}|file-storage`));
}

function startsWithBytes(data: Uint8Array, magic: Uint8Array): boolean {
  if (data.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) if (data[i] !== magic[i]) return false;
  return true;
}

export async function encryptFileBytes(raw: Uint8Array): Promise<Uint8Array> {
  if (startsWithBytes(raw, FILE_MAGIC)) return raw;
  const key = await fileKey();
  const nonce = crypto.getRandomValues(new Uint8Array(FILE_NONCE_SIZE));
  const cipher = await xorStream(raw, key, nonce);
  const tag = (await hmacSha256(key, concatBytes(nonce, cipher))).slice(0, FILE_TAG_SIZE);
  return concatBytes(FILE_MAGIC, nonce, cipher, tag);
}

export async function decryptFileBytes(raw: Uint8Array): Promise<Uint8Array> {
  if (!startsWithBytes(raw, FILE_MAGIC)) return raw;
  if (raw.length < FILE_MAGIC.length + FILE_NONCE_SIZE + FILE_TAG_SIZE) return new Uint8Array();
  const body = raw.slice(FILE_MAGIC.length);
  const nonce = body.slice(0, FILE_NONCE_SIZE);
  const cipher = body.slice(FILE_NONCE_SIZE, body.length - FILE_TAG_SIZE);
  const tag = body.slice(body.length - FILE_TAG_SIZE);
  const key = await fileKey();
  const expected = (await hmacSha256(key, concatBytes(nonce, cipher))).slice(0, FILE_TAG_SIZE);
  if (!equalBytes(tag, expected)) return new Uint8Array();
  return xorStream(cipher, key, nonce);
}

export async function fetchDecryptedFile(fileId: string, token: string, baseUrl: string): Promise<Blob> {
  const response = await fetch(`${baseUrl}/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Failed to fetch file');
  const arr = new Uint8Array(await response.arrayBuffer());
  const plain = await decryptFileBytes(arr);
  return new Blob([plain]);
}
