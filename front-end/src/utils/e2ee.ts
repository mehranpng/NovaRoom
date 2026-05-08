const ENC_PREFIX = 'enc:v1:';
const ENC_PREFIX_V2 = 'enc:v2:';
const ENC_NONCE_SIZE = 16;
const ENC_TAG_SIZE = 16;
const FILE_MAGIC = new Uint8Array([0x4e, 0x43, 0x46, 0x32]); // NCF2 (AES-GCM)
const FILE_MAGIC_LEGACY = new Uint8Array([0x4e, 0x43, 0x46, 0x31]); // NCF1 (XOR+HMAC legacy)
const FILE_TEXT_PREFIX = 'ncf:v1:';
const AVATAR_MAGIC = new Uint8Array([0x4e, 0x43, 0x41, 0x32]); // NCA2 (AES-GCM)
const AVATAR_MAGIC_LEGACY = new Uint8Array([0x4e, 0x43, 0x41, 0x31]); // NCA1 (XOR+HMAC legacy)
const AVATAR_TEXT_PREFIX = 'nca:v1:';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const SHA256_BLOCK_SIZE = 64;

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

const sha256Fallback = (message: Uint8Array): Uint8Array => {
    const bitLen = message.length * 8;
    const withOne = message.length + 1;
    const padLen = (64 - ((withOne + 8) % 64)) % 64;
    const totalLen = withOne + padLen + 8;
    const data = new Uint8Array(totalLen);
    data.set(message, 0);
    data[message.length] = 0x80;
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    data[totalLen - 8] = (hi >>> 24) & 0xff;
    data[totalLen - 7] = (hi >>> 16) & 0xff;
    data[totalLen - 6] = (hi >>> 8) & 0xff;
    data[totalLen - 5] = hi & 0xff;
    data[totalLen - 4] = (lo >>> 24) & 0xff;
    data[totalLen - 3] = (lo >>> 16) & 0xff;
    data[totalLen - 2] = (lo >>> 8) & 0xff;
    data[totalLen - 1] = lo & 0xff;

    let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
    let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
    const w = new Uint32Array(64);

    for (let offset = 0; offset < data.length; offset += 64) {
        for (let i = 0; i < 16; i += 1) {
            const j = offset + (i * 4);
            w[i] = ((data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3]) >>> 0;
        }
        for (let i = 16; i < 64; i += 1) {
            const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
            const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let a = h0; let b = h1; let c = h2; let d = h3;
        let e = h4; let f = h5; let g = h6; let h = h7;

        for (let i = 0; i < 64; i += 1) {
            const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
            const ch = ((e & f) ^ (~e & g)) >>> 0;
            const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
            const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
            const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
            const temp2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e;
            e = (d + temp1) >>> 0;
            d = c; c = b; b = a;
            a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const words = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < words.length; i += 1) {
        out[i * 4] = (words[i] >>> 24) & 0xff;
        out[(i * 4) + 1] = (words[i] >>> 16) & 0xff;
        out[(i * 4) + 2] = (words[i] >>> 8) & 0xff;
        out[(i * 4) + 3] = words[i] & 0xff;
    }
    return out;
};

const hmacSha256Fallback = (keyBytes: Uint8Array, payload: Uint8Array): Uint8Array => {
    let key = keyBytes;
    if (key.length > SHA256_BLOCK_SIZE) key = sha256Fallback(key);
    if (key.length < SHA256_BLOCK_SIZE) {
        const padded = new Uint8Array(SHA256_BLOCK_SIZE);
        padded.set(key, 0);
        key = padded;
    }
    const oKeyPad = new Uint8Array(SHA256_BLOCK_SIZE);
    const iKeyPad = new Uint8Array(SHA256_BLOCK_SIZE);
    for (let i = 0; i < SHA256_BLOCK_SIZE; i += 1) {
        oKeyPad[i] = key[i] ^ 0x5c;
        iKeyPad[i] = key[i] ^ 0x36;
    }
    const inner = new Uint8Array(iKeyPad.length + payload.length);
    inner.set(iKeyPad, 0);
    inner.set(payload, iKeyPad.length);
    const innerHash = sha256Fallback(inner);
    const outer = new Uint8Array(oKeyPad.length + innerHash.length);
    outer.set(oKeyPad, 0);
    outer.set(innerHash, oKeyPad.length);
    return sha256Fallback(outer);
};

const toUtf8 = (value: string) => textEncoder.encode(value);

const toBase64Url = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value: string): Uint8Array => {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const view = bytes as Uint8Array<ArrayBufferLike>;
    if (view.buffer instanceof ArrayBuffer) {
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    const out = new Uint8Array(view.byteLength);
    out.set(view);
    return out.buffer;
};

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
        return new Uint8Array(digest);
    }
    return sha256Fallback(bytes);
};

const derivedKeyCache = new Map<string, Promise<Uint8Array>>();
const aesKeyCache = new Map<string, Promise<CryptoKey>>();

const deriveKey = async (material: string): Promise<Uint8Array> => {
    const cached = derivedKeyCache.get(material);
    if (cached) return cached;
    const next = sha256(toUtf8(material));
    derivedKeyCache.set(material, next);
    return next;
};

const xorStream = async (data: Uint8Array, key: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> => {
    const out = new Uint8Array(data.length);
    let counter = 0;
    let idx = 0;
    let iterationsSinceYield = 0;

    while (idx < data.length) {
        const counterBytes = new Uint8Array(8);
        const view = new DataView(counterBytes.buffer);
        view.setUint32(4, counter, false);
        const blockInput = new Uint8Array(key.length + nonce.length + counterBytes.length);
        blockInput.set(key, 0);
        blockInput.set(nonce, key.length);
        blockInput.set(counterBytes, key.length + nonce.length);

        const block = await sha256(blockInput);
        for (let i = 0; i < block.length && idx < data.length; i += 1) {
            out[idx] = data[idx] ^ block[i];
            idx += 1;
        }
        counter += 1;
        iterationsSinceYield += 1;
        if (iterationsSinceYield >= 48) {
            iterationsSinceYield = 0;
            await new Promise<void>((resolve) => {
                window.setTimeout(resolve, 0);
            });
        }
    }

    return out;
};

const hmacTag = async (keyBytes: Uint8Array, payload: Uint8Array): Promise<Uint8Array> => {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const mac = await crypto.subtle.sign('HMAC', key, toArrayBuffer(payload));
        return new Uint8Array(mac).slice(0, ENC_TAG_SIZE);
    }
    return hmacSha256Fallback(keyBytes, payload).slice(0, ENC_TAG_SIZE);
};

const buildLegacyMaterial = (token: string, scope: string) => `${token || ''}|${scope || ''}`;
const buildSharedMaterial = (scope: string) => `novaroom-client-shared|${scope || ''}`;
const randomBytes = (length: number): Uint8Array => {
    const out = new Uint8Array(length);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        return crypto.getRandomValues(out);
    }
    for (let i = 0; i < out.length; i += 1) out[i] = Math.floor(Math.random() * 256);
    return out;
};

export const encryptClientText = async (plain: string, token: string, scope: string, mode: 'legacy' | 'shared' = 'legacy'): Promise<string> => {
    const text = String(plain || '');
    if (!text) return '';
    try {
        const material = mode === 'shared' ? buildSharedMaterial(scope) : buildLegacyMaterial(token, scope);
        const key = await deriveKey(material);

        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const nonce = randomBytes(AES_GCM_NONCE_SIZE);
            const encrypted = await aesGcmEncrypt(toUtf8(text), key, nonce);
            const full = new Uint8Array(nonce.length + encrypted.length);
            full.set(nonce, 0);
            full.set(encrypted, nonce.length);
            return `${ENC_PREFIX_V2}${toBase64Url(full)}`;
        }

        const nonce = randomBytes(ENC_NONCE_SIZE);
        const encrypted = await xorStream(toUtf8(text), key, nonce);
        const nonceAndEncrypted = new Uint8Array(nonce.length + encrypted.length);
        nonceAndEncrypted.set(nonce, 0);
        nonceAndEncrypted.set(encrypted, nonce.length);
        const tag = await hmacTag(key, nonceAndEncrypted);
        const full = new Uint8Array(nonce.length + encrypted.length + tag.length);
        full.set(nonce, 0);
        full.set(encrypted, nonce.length);
        full.set(tag, nonce.length + encrypted.length);
        return `${ENC_PREFIX}${toBase64Url(full)}`;
    } catch {
        return text;
    }
};

export const decryptClientText = async (cipher: string, token: string, scope: string): Promise<string> => {
    const value = String(cipher || '');
    if (!value) return '';

    try {
        if (value.startsWith(ENC_PREFIX_V2)) {
            const raw = fromBase64Url(value.slice(ENC_PREFIX_V2.length));
            if (raw.length < AES_GCM_NONCE_SIZE + ENC_TAG_SIZE) return '';
            const nonce = raw.slice(0, AES_GCM_NONCE_SIZE);
            const bodyAndTag = raw.slice(AES_GCM_NONCE_SIZE);
            const material = buildSharedMaterial(scope);
            const key = await deriveKey(material);
            const plainBytes = await aesGcmDecrypt(bodyAndTag, key, nonce);
            return textDecoder.decode(plainBytes);
        }

        if (!value.startsWith(ENC_PREFIX)) return value;
        const raw = fromBase64Url(value.slice(ENC_PREFIX.length));
        if (raw.length < ENC_NONCE_SIZE + ENC_TAG_SIZE) return '';
        const nonce = raw.slice(0, ENC_NONCE_SIZE);
        const body = raw.slice(ENC_NONCE_SIZE, raw.length - ENC_TAG_SIZE);
        const tag = raw.slice(raw.length - ENC_TAG_SIZE);
        const nonceAndBody = new Uint8Array(nonce.length + body.length);
        nonceAndBody.set(nonce, 0);
        nonceAndBody.set(body, nonce.length);

        const candidateMaterials = [buildSharedMaterial(scope), buildLegacyMaterial(token, scope)];
        for (const material of candidateMaterials) {
            const key = await deriveKey(material);
            const expectedTag = await hmacTag(key, nonceAndBody);
            const sameTag = tag.length === expectedTag.length && tag.every((b, i) => b === expectedTag[i]);
            if (!sameTag) continue;
            const plainBytes = await xorStream(body, key, nonce);
            return textDecoder.decode(plainBytes);
        }
        return value;
    } catch {
        return value;
    }
};

export const decryptMessageClientSide = async (message: any, token: string, chatId: string): Promise<any> => {
    if (!message) return message;
    const scope = `chat:${chatId}`;
    const next = { ...message };
    if (typeof next.text === 'string') {
        const dec = await decryptClientText(next.text, token, scope);
        next.text = dec;
    }
    if (next.replyTo && typeof next.replyTo === 'object' && typeof next.replyTo.text === 'string') {
        const decReply = await decryptClientText(next.replyTo.text, token, scope);
        next.replyTo = { ...next.replyTo, text: decReply };
    }
    if (typeof next.reasoningContent === 'string') {
        const decReasoning = await decryptClientText(next.reasoningContent, token, scope);
        next.reasoningContent = decReasoning;
    }
    return next;
};

export const encryptChatTextClientSide = async (text: string, token: string, chatId: string): Promise<string> => {
    return encryptClientText(text, token, `chat:${chatId}`, 'shared');
};

export const encryptBioClientSide = async (bio: string, token: string, chatId: string): Promise<string> => {
    return encryptClientText(bio, token, `user-bio:${chatId}`, 'shared');
};

export const decryptBioClientSide = async (bio: string, token: string, chatId: string): Promise<string> => {
    return decryptClientText(bio, token, `user-bio:${chatId}`);
};


const AES_GCM_NONCE_SIZE = 12;

const importAesKey = async (keyBytes: Uint8Array): Promise<CryptoKey> => {
    const cacheKey = toBase64Url(keyBytes);
    const cached = aesKeyCache.get(cacheKey);
    if (cached) return cached;
    const next = crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    aesKeyCache.set(cacheKey, next);
    return next;
};

const aesGcmEncrypt = async (plain: Uint8Array, keyBytes: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> => {
    const key = await importAesKey(keyBytes);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, plain);
    return new Uint8Array(cipher);
};

const aesGcmDecrypt = async (packed: Uint8Array, keyBytes: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> => {
    const key = await importAesKey(keyBytes);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, packed);
    return new Uint8Array(plain);
};
const hasMagic = (raw: Uint8Array, magic: Uint8Array): boolean => {
    if (raw.length < magic.length) return false;
    for (let i = 0; i < magic.length; i += 1) {
        if (raw[i] !== magic[i]) return false;
    }
    return true;
};

export const encryptFileBytesClientSide = async (plain: Uint8Array, _token: string, chatId: string): Promise<Uint8Array> => {
    if (!plain.length) return plain;
    try {
        const scope = `chat:${chatId}`;
        const key = await deriveKey(buildSharedMaterial(scope));

        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const nonce = randomBytes(AES_GCM_NONCE_SIZE);
            const encrypted = await aesGcmEncrypt(plain, key, nonce);
            const full = new Uint8Array(FILE_MAGIC.length + nonce.length + encrypted.length);
            full.set(FILE_MAGIC, 0);
            full.set(nonce, FILE_MAGIC.length);
            full.set(encrypted, FILE_MAGIC.length + nonce.length);
            return full;
        }

        const nonce = randomBytes(ENC_NONCE_SIZE);
        const encrypted = await xorStream(plain, key, nonce);
        const nonceAndEncrypted = new Uint8Array(nonce.length + encrypted.length);
        nonceAndEncrypted.set(nonce, 0);
        nonceAndEncrypted.set(encrypted, nonce.length);
        const tag = await hmacTag(key, nonceAndEncrypted);
        const full = new Uint8Array(FILE_MAGIC_LEGACY.length + nonce.length + encrypted.length + tag.length);
        full.set(FILE_MAGIC_LEGACY, 0);
        full.set(nonce, FILE_MAGIC_LEGACY.length);
        full.set(encrypted, FILE_MAGIC_LEGACY.length + nonce.length);
        full.set(tag, FILE_MAGIC_LEGACY.length + nonce.length + encrypted.length);
        return full;
    } catch {
        return plain;
    }
};

export const decryptFileBytesClientSide = async (raw: Uint8Array, _token: string, chatId: string): Promise<Uint8Array> => {
    if (!raw.length) return raw;
    let packed: Uint8Array | null = null;
    let isAesV2 = false;

    if (hasMagic(raw, FILE_MAGIC)) {
        packed = raw.subarray(FILE_MAGIC.length);
        isAesV2 = true;
    } else if (hasMagic(raw, FILE_MAGIC_LEGACY)) {
        packed = raw.subarray(FILE_MAGIC_LEGACY.length);
    } else {
        try {
            const maybeText = textDecoder.decode(raw);
            if (maybeText.startsWith(FILE_TEXT_PREFIX)) {
                packed = fromBase64Url(maybeText.slice(FILE_TEXT_PREFIX.length));
            }
        } catch {
            packed = null;
        }
    }
    if (!packed) return raw;

    try {
        const scope = `chat:${chatId}`;
        const key = await deriveKey(buildSharedMaterial(scope));

        if (isAesV2) {
            if (packed.length < AES_GCM_NONCE_SIZE + ENC_TAG_SIZE) return raw;
            const nonce = packed.subarray(0, AES_GCM_NONCE_SIZE);
            const bodyAndTag = packed.subarray(AES_GCM_NONCE_SIZE);
            return await aesGcmDecrypt(bodyAndTag, key, nonce);
        }

        if (packed.length < ENC_NONCE_SIZE + ENC_TAG_SIZE) return raw;
        const nonce = packed.subarray(0, ENC_NONCE_SIZE);
        const body = packed.subarray(ENC_NONCE_SIZE, packed.length - ENC_TAG_SIZE);
        const tag = packed.subarray(packed.length - ENC_TAG_SIZE);
        const nonceAndBody = new Uint8Array(nonce.length + body.length);
        nonceAndBody.set(nonce, 0);
        nonceAndBody.set(body, nonce.length);
        const expectedTag = await hmacTag(key, nonceAndBody);
        const sameTag = tag.length === expectedTag.length && tag.every((b, i) => b === expectedTag[i]);
        if (!sameTag) return raw;
        return xorStream(body, key, nonce);
    } catch {
        return raw;
    }
};

export const encryptAvatarBytesClientSide = async (plain: Uint8Array, _token: string): Promise<Uint8Array> => {
    if (!plain.length) return plain;
    try {
        const key = await deriveKey(buildSharedMaterial('profile-avatar:shared'));

        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const nonce = randomBytes(AES_GCM_NONCE_SIZE);
            const encrypted = await aesGcmEncrypt(plain, key, nonce);
            const full = new Uint8Array(AVATAR_MAGIC.length + nonce.length + encrypted.length);
            full.set(AVATAR_MAGIC, 0);
            full.set(nonce, AVATAR_MAGIC.length);
            full.set(encrypted, AVATAR_MAGIC.length + nonce.length);
            return full;
        }

        const nonce = randomBytes(ENC_NONCE_SIZE);
        const encrypted = await xorStream(plain, key, nonce);
        const nonceAndEncrypted = new Uint8Array(nonce.length + encrypted.length);
        nonceAndEncrypted.set(nonce, 0);
        nonceAndEncrypted.set(encrypted, nonce.length);
        const tag = await hmacTag(key, nonceAndEncrypted);
        const full = new Uint8Array(AVATAR_MAGIC_LEGACY.length + nonce.length + encrypted.length + tag.length);
        full.set(AVATAR_MAGIC_LEGACY, 0);
        full.set(nonce, AVATAR_MAGIC_LEGACY.length);
        full.set(encrypted, AVATAR_MAGIC_LEGACY.length + nonce.length);
        full.set(tag, AVATAR_MAGIC_LEGACY.length + nonce.length + encrypted.length);
        return full;
    } catch {
        return plain;
    }
};

export const decryptAvatarBytesClientSide = async (raw: Uint8Array, _token: string): Promise<Uint8Array> => {
    if (!raw.length) return raw;
    let packed: Uint8Array | null = null;
    let isAesV2 = false;
    if (hasMagic(raw, AVATAR_MAGIC)) {
        packed = raw.subarray(AVATAR_MAGIC.length);
        isAesV2 = true;
    } else if (hasMagic(raw, AVATAR_MAGIC_LEGACY)) {
        packed = raw.subarray(AVATAR_MAGIC_LEGACY.length);
    } else {
        try {
            const maybeText = textDecoder.decode(raw);
            if (maybeText.startsWith(AVATAR_TEXT_PREFIX)) {
                packed = fromBase64Url(maybeText.slice(AVATAR_TEXT_PREFIX.length));
            }
        } catch {
            packed = null;
        }
    }
    if (!packed) return raw;
    try {
        const key = await deriveKey(buildSharedMaterial('profile-avatar:shared'));

        if (isAesV2) {
            if (packed.length < AES_GCM_NONCE_SIZE + ENC_TAG_SIZE) return raw;
            const nonce = packed.subarray(0, AES_GCM_NONCE_SIZE);
            const bodyAndTag = packed.subarray(AES_GCM_NONCE_SIZE);
            return await aesGcmDecrypt(bodyAndTag, key, nonce);
        }

        if (packed.length < ENC_NONCE_SIZE + ENC_TAG_SIZE) return raw;
        const nonce = packed.subarray(0, ENC_NONCE_SIZE);
        const body = packed.subarray(ENC_NONCE_SIZE, packed.length - ENC_TAG_SIZE);
        const tag = packed.subarray(packed.length - ENC_TAG_SIZE);
        const nonceAndBody = new Uint8Array(nonce.length + body.length);
        nonceAndBody.set(nonce, 0);
        nonceAndBody.set(body, nonce.length);
        const expectedTag = await hmacTag(key, nonceAndBody);
        const sameTag = tag.length === expectedTag.length && tag.every((b, i) => b === expectedTag[i]);
        if (!sameTag) return raw;
        return xorStream(body, key, nonce);
    } catch {
        return raw;
    }
};
