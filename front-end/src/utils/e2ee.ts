const TEXT_PREFIX = 'e2ee:v1:';
const FILE_MAGIC = new Uint8Array([0x4e, 0x52, 0x45, 0x32]); // "NRE2"
const NONCE_SIZE = 16;
const FALLBACK_KEY = 'novaroom-e2ee-shared-key-v1';

const getKey = (): string => {
    if (typeof window === 'undefined') return FALLBACK_KEY;
    const saved = (localStorage.getItem('novaroom_e2ee_key') || '').trim();
    return saved || FALLBACK_KEY;
};

const hash32 = (input: string): number => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

const buildKeystream = (len: number, nonce: Uint8Array): Uint8Array => {
    const keySeed = hash32(`${getKey()}:${Array.from(nonce).join(',')}`) || 1;
    let x = keySeed >>> 0;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        // xorshift32
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        out[i] = x & 0xff;
    }
    return out;
};

const randomNonce = (): Uint8Array => {
    const nonce = new Uint8Array(NONCE_SIZE);
    crypto.getRandomValues(nonce);
    return nonce;
};

const xorBytes = (data: Uint8Array, nonce: Uint8Array): Uint8Array => {
    const stream = buildKeystream(data.length, nonce);
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] ^ stream[i];
    return out;
};

const toB64 = (data: Uint8Array): string => btoa(String.fromCharCode(...data));
const fromB64 = (value: string): Uint8Array => {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};

export const encryptTextForTransport = (plain: string): string => {
    const text = String(plain ?? '');
    if (!text) return '';
    if (text.startsWith(TEXT_PREFIX)) return text;
    const nonce = randomNonce();
    const raw = new TextEncoder().encode(text);
    const cipher = xorBytes(raw, nonce);
    return `${TEXT_PREFIX}${toB64(nonce)}:${toB64(cipher)}`;
};

export const decryptTextFromTransport = (value: unknown): string => {
    const text = String(value ?? '');
    if (!text.startsWith(TEXT_PREFIX)) return text;
    const body = text.slice(TEXT_PREFIX.length);
    const [nonceB64, cipherB64] = body.split(':');
    if (!nonceB64 || !cipherB64) return text;
    try {
        const nonce = fromB64(nonceB64);
        const cipher = fromB64(cipherB64);
        const plain = xorBytes(cipher, nonce);
        return new TextDecoder().decode(plain);
    } catch {
        return text;
    }
};

export const encryptFileBytesForTransport = (raw: Uint8Array): Uint8Array => {
    const nonce = randomNonce();
    const cipher = xorBytes(raw, nonce);
    const out = new Uint8Array(FILE_MAGIC.length + NONCE_SIZE + cipher.length);
    out.set(FILE_MAGIC, 0);
    out.set(nonce, FILE_MAGIC.length);
    out.set(cipher, FILE_MAGIC.length + NONCE_SIZE);
    return out;
};

export const decryptFileBytesFromTransport = (raw: Uint8Array): Uint8Array => {
    if (raw.length < FILE_MAGIC.length + NONCE_SIZE) return raw;
    for (let i = 0; i < FILE_MAGIC.length; i++) {
        if (raw[i] !== FILE_MAGIC[i]) return raw;
    }
    const nonceStart = FILE_MAGIC.length;
    const nonce = raw.slice(nonceStart, nonceStart + NONCE_SIZE);
    const cipher = raw.slice(nonceStart + NONCE_SIZE);
    return xorBytes(cipher, nonce);
};

export const isE2EEText = (value: unknown): boolean =>
    String(value ?? '').startsWith(TEXT_PREFIX);
