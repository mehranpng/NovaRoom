const ENC_PREFIX = 'enc:v1:';
const ENC_NONCE_SIZE = 16;
const ENC_TAG_SIZE = 16;

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

const deriveKey = async (material: string): Promise<Uint8Array> => {
    return sha256(toUtf8(material));
};

const xorStream = async (data: Uint8Array, key: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> => {
    const out = new Uint8Array(data.length);
    let counter = 0;
    let idx = 0;

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
    if (!value.startsWith(ENC_PREFIX)) return value;

    try {
        const raw = fromBase64Url(value.slice(ENC_PREFIX.length));
        if (raw.length < ENC_NONCE_SIZE + ENC_TAG_SIZE) return '';

        const nonce = raw.slice(0, ENC_NONCE_SIZE);
        const body = raw.slice(ENC_NONCE_SIZE, raw.length - ENC_TAG_SIZE);
        const tag = raw.slice(raw.length - ENC_TAG_SIZE);

        const nonceAndBody = new Uint8Array(nonce.length + body.length);
        nonceAndBody.set(nonce, 0);
        nonceAndBody.set(body, nonce.length);

        const candidateMaterials = [
            buildSharedMaterial(scope),
            buildLegacyMaterial(token, scope),
        ];

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

const E2EE_PREFIX = 'enc:e2ee:v1:';
const E2EE_CONTEXT = {
    myChatId: '',
    peerPublicKeyByChatId: new Map<string, string>(),
    chatTypeByChatId: new Map<string, 'direct' | 'group' | ''>(),
};
const E2EE_DB_NAME = 'messenger_e2ee';
const E2EE_DB_STORE = 'identity_keys';
const IDENTITY_MEMORY_CACHE = new Map<string, { privateKey: CryptoKey; publicKeyRaw: Uint8Array }>();

const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
};

const listKnownIdentityChatIds = async (): Promise<string[]> => {
    const ids = new Set<string>(Array.from(IDENTITY_MEMORY_CACHE.keys()));
    try {
        const db = await openE2EEDb();
        try {
            const rows = await new Promise<any[]>((resolve, reject) => {
                const tx = db.transaction(E2EE_DB_STORE, 'readonly');
                const store = tx.objectStore(E2EE_DB_STORE);
                const req = store.getAllKeys();
                req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => reject(req.error || new Error('Failed to list E2EE key ids'));
            });
            rows.forEach((id) => {
                const chatId = String(id || '');
                if (chatId) ids.add(chatId);
            });
        } finally {
            db.close();
        }
    } catch {
        // Ignore and use in-memory ids only.
    }
    return Array.from(ids);
};

const identityStorageKey = (chatId: string) => `messenger.e2ee.identity.${chatId}`;

const openE2EEDb = async (): Promise<IDBDatabase> => {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(E2EE_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(E2EE_DB_STORE)) {
                db.createObjectStore(E2EE_DB_STORE, { keyPath: 'chatId' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Failed to open E2EE DB'));
    });
};

const readIdentityFromDb = async (chatId: string): Promise<{ privateKey: CryptoKey; publicKeyRaw: Uint8Array } | null> => {
    const cached = IDENTITY_MEMORY_CACHE.get(chatId);
    if (cached) return cached;

    const db = await openE2EEDb();
    try {
        const row = await new Promise<any>((resolve, reject) => {
            const tx = db.transaction(E2EE_DB_STORE, 'readonly');
            const store = tx.objectStore(E2EE_DB_STORE);
            const req = store.get(chatId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error || new Error('Failed to read E2EE key'));
        });
        if (!row?.publicKeyRaw) return null;

        let privateKey: CryptoKey | null = null;

        if (row.privateKey && typeof row.privateKey === 'object' && 'type' in row.privateKey) {
            privateKey = row.privateKey as CryptoKey;
        }

        if (!privateKey && row.privateJwk) {
            privateKey = await crypto.subtle.importKey(
                'jwk',
                row.privateJwk,
                { name: 'ECDH', namedCurve: 'P-256' },
                false,
                ['deriveBits'],
            );
        }

        if (!privateKey) return null;

        const identity = { privateKey, publicKeyRaw: fromBase64(String(row.publicKeyRaw || '')) };
        IDENTITY_MEMORY_CACHE.set(chatId, identity);
        return identity;
    } finally {
        db.close();
    }
};

const findIdentityChatIdByPublicKey = async (publicKeyB64: string): Promise<string> => {
    const target = String(publicKeyB64 || '');
    if (!target) return '';

    for (const [chatId, identity] of IDENTITY_MEMORY_CACHE.entries()) {
        if (toBase64(identity.publicKeyRaw) === target) return chatId;
    }

    try {
        const db = await openE2EEDb();
        try {
            const rows = await new Promise<any[]>((resolve, reject) => {
                const tx = db.transaction(E2EE_DB_STORE, 'readonly');
                const store = tx.objectStore(E2EE_DB_STORE);
                const req = store.getAll();
                req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => reject(req.error || new Error('Failed to scan E2EE keys'));
            });

            const match = rows.find((row) => String(row?.publicKeyRaw || '') === target);
            return String(match?.chatId || '');
        } finally {
            db.close();
        }
    } catch {
        return '';
    }
};

const writeIdentityToDb = async (chatId: string, privateKey: CryptoKey, publicKeyRaw: Uint8Array, privateJwk: JsonWebKey): Promise<void> => {
    IDENTITY_MEMORY_CACHE.set(chatId, { privateKey, publicKeyRaw });
    try {
        const db = await openE2EEDb();
        try {
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(E2EE_DB_STORE, 'readwrite');
                const store = tx.objectStore(E2EE_DB_STORE);
                // Important for mobile/WebView compatibility:
                // Persist only serializable fields. Some environments fail the whole write
                // when a CryptoKey object is included in IndexedDB payload.
                store.put({
                    chatId,
                    privateJwk,
                    publicKeyRaw: toBase64(publicKeyRaw),
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('Failed to persist E2EE key'));
                tx.onabort = () => reject(tx.error || new Error('Failed to persist E2EE key'));
            });
        } finally {
            db.close();
        }
    } catch {
        // Keep in-memory key for current session if IndexedDB write fails entirely.
    }
};

const ensureIdentity = async (chatId: string): Promise<{ privateKey: CryptoKey; publicKeyRaw: Uint8Array }> => {
    if (!chatId || !crypto?.subtle) throw new Error('E2EE unavailable');
    let dbIdentity: { privateKey: CryptoKey; publicKeyRaw: Uint8Array } | null = null;
    try {
        dbIdentity = await readIdentityFromDb(chatId);
    } catch {
        dbIdentity = IDENTITY_MEMORY_CACHE.get(chatId) || null;
    }
    if (dbIdentity) return dbIdentity;

    // One-time migration from old localStorage format (if present), then delete it.
    const existing = localStorage.getItem(identityStorageKey(chatId));
    if (existing) {
        const parsed = JSON.parse(existing);
        const imported = await crypto.subtle.importKey(
            'jwk',
            parsed.privateJwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveBits']
        );
        const migratedJwk = await crypto.subtle.exportKey('jwk', imported);
        const nonExtractable = await crypto.subtle.importKey('jwk', migratedJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        const migrated = { privateKey: nonExtractable, publicKeyRaw: fromBase64(parsed.publicKeyRaw) };
        await writeIdentityToDb(chatId, migrated.privateKey, migrated.publicKeyRaw, migratedJwk);
        localStorage.removeItem(identityStorageKey(chatId));
        return migrated;
    }

    const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    await writeIdentityToDb(chatId, privateKey, publicRaw, privateJwk);
    return { privateKey, publicKeyRaw: publicRaw };
};

const importEcdhPublic = async (rawB64: string): Promise<CryptoKey> => {
    return crypto.subtle.importKey('raw', toArrayBuffer(fromBase64(rawB64)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
};

const deriveE2eeAesKey = async (privateKey: CryptoKey, peerPublicRawB64: string, scope: string): Promise<CryptoKey> => {
    const peerPublic = await importEcdhPublic(peerPublicRawB64);
    const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPublic }, privateKey, 256);
    const ikm = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: toArrayBuffer(toUtf8(scope)),
            info: toArrayBuffer(toUtf8('messenger-e2ee-v1')),
        },
        ikm,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
};

export const configureE2EEContext = (
    myChatId: string,
    peerPublicKeyByChatId: Record<string, string>,
    chatTypeByChatId: Record<string, 'direct' | 'group' | ''> = {},
): void => {
    E2EE_CONTEXT.myChatId = String(myChatId || '');
    E2EE_CONTEXT.peerPublicKeyByChatId = new Map(Object.entries(peerPublicKeyByChatId || {}).filter(([, v]) => Boolean(v)));
    E2EE_CONTEXT.chatTypeByChatId = new Map(Object.entries(chatTypeByChatId || {}));
};

export const registerChatPeerPublicKey = (chatId: string, publicKey: string): void => {
    if (!chatId || !publicKey) return;
    E2EE_CONTEXT.peerPublicKeyByChatId.set(chatId, publicKey);
};

export const ensureAndGetE2EEPublicKey = async (chatId: string): Promise<string> => {
    const identity = await ensureIdentity(chatId);
    return toBase64(identity.publicKeyRaw);
};

/**
 * Attempts to decrypt an E2EE message.
 *
 * Key insight for mobile: E2EE_CONTEXT.myChatId may be empty if the app
 * resumed from background or the WebView was recreated. In that case we
 * fall back to using the recipientPublicKey stored inside the payload to
 * find our own identity in IndexedDB by scanning known chat keys.
 */
const decryptE2EEText = async (cipher: string, chatId: string, senderId?: string): Promise<string> => {
    if (!cipher.startsWith(E2EE_PREFIX)) return cipher;

    let bodyRaw: any = null;
    try {
        bodyRaw = JSON.parse(textDecoder.decode(fromBase64Url(cipher.slice(E2EE_PREFIX.length))));
    } catch {
        return cipher;
    }

    // Resolve which chatId to use as our own identity.
    // If E2EE_CONTEXT.myChatId is set use it; otherwise derive it from payload.
    const myChatId = E2EE_CONTEXT.myChatId || '';

    // The recipient's public key is embedded in the payload — use it to find our identity.
    const recipientPublicKeyInPayload = String(bodyRaw.recipientPublicKey || bodyRaw.recipient_public_key || '');

    // Determine which identity to load:
    // 1. Use myChatId from context (normal path)
    // 2. If myChatId missing, scan IndexedDB/in-memory cache for identity matching recipientPublicKey
    let identityChatId = myChatId;
    if (!identityChatId && recipientPublicKeyInPayload) {
        identityChatId = await findIdentityChatIdByPublicKey(recipientPublicKeyInPayload);
    }

    const identityChatIdCandidates = identityChatId
        ? [identityChatId]
        : await listKnownIdentityChatIds();
    if (!identityChatIdCandidates.length) return cipher;

    for (const candidateChatId of identityChatIdCandidates) {
        try {
            const identity = await readIdentityFromDb(candidateChatId);
            if (!identity) continue;

            // Determine peer public key to derive shared secret
            const isSelf = senderId === candidateChatId;
            let peerPublic: string;
            if (isSelf) {
                // We sent this message — peer is the recipient
                peerPublic =
                    E2EE_CONTEXT.peerPublicKeyByChatId.get(chatId) ||
                    recipientPublicKeyInPayload ||
                    toBase64(identity.publicKeyRaw);
            } else {
                // Someone else sent it — peer is the sender
                peerPublic =
                    String(bodyRaw.senderPublicKey || bodyRaw.sender_public_key || '') ||
                    String(E2EE_CONTEXT.peerPublicKeyByChatId.get(chatId) || '');
            }

            if (!peerPublic) continue;

            const aesKey = await deriveE2eeAesKey(identity.privateKey, peerPublic, `chat:${chatId}`);
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: toArrayBuffer(fromBase64(String(bodyRaw.iv || ''))) },
                aesKey,
                toArrayBuffer(fromBase64(String(bodyRaw.ct || '')))
            );
            return textDecoder.decode(new Uint8Array(decrypted));
        } catch {
            // Try next identity candidate.
        }
    }

    if (bodyRaw && typeof bodyRaw.legacy === 'string') {
        try {
            return await decryptClientText(bodyRaw.legacy, '', `chat:${chatId}`);
        } catch {
            return cipher;
        }
    }
    return cipher;
};

export const decryptMessageClientSide = async (message: any, _token: string, chatId: string): Promise<any> => {
    if (!message) return message;
    const next = { ...message };
    const scope = `chat:${chatId}`;
    if (typeof next.text === 'string') {
        const e2ee = await decryptE2EEText(next.text, chatId, next.senderId);
        next.text = e2ee === next.text ? await decryptClientText(next.text, _token, scope) : e2ee;
    }
    if (next.replyTo && typeof next.replyTo === 'object' && typeof next.replyTo.text === 'string') {
        const e2eeReply = await decryptE2EEText(next.replyTo.text, chatId, next.replyTo.senderId);
        next.replyTo = {
            ...next.replyTo,
            text: e2eeReply === next.replyTo.text
                ? await decryptClientText(next.replyTo.text, _token, scope)
                : e2eeReply,
        };
    }
    return next;
};

export const encryptChatTextClientSide = async (text: string, _token: string, chatId: string): Promise<string> => {
    const plain = String(text || '');
    if (!plain) return '';
    if (!E2EE_CONTEXT.myChatId || !crypto?.subtle) {
        return encryptClientText(plain, _token, `chat:${chatId}`, 'shared');
    }

    const isSavedMessagesChat = chatId === `saved_messages_${E2EE_CONTEXT.myChatId}`;
    const chatType = E2EE_CONTEXT.chatTypeByChatId.get(chatId) || '';
    const isDirectChat = chatType ? chatType === 'direct' : E2EE_CONTEXT.peerPublicKeyByChatId.has(chatId);
    if (!isDirectChat && !isSavedMessagesChat) {
        // Group chats use shared room-level encryption for now.
        return encryptClientText(plain, _token, `chat:${chatId}`, 'shared');
    }

    const identity = await ensureIdentity(E2EE_CONTEXT.myChatId);
    const peerPublic = E2EE_CONTEXT.peerPublicKeyByChatId.get(chatId) || (isSavedMessagesChat ? toBase64(identity.publicKeyRaw) : '');
    if (!peerPublic) {
        throw new Error('E2EE_PEER_KEY_MISSING');
    }

    try {
        const aesKey = await deriveE2eeAesKey(identity.privateKey, peerPublic, `chat:${chatId}`);
        const iv = randomBytes(12);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, aesKey, toArrayBuffer(toUtf8(plain)));
        const body = {
            v: 1,
            alg: 'ECDH-P256+AES-GCM',
            senderPublicKey: toBase64(identity.publicKeyRaw),
            recipientPublicKey: peerPublic,
            iv: toBase64(iv),
            ct: toBase64(new Uint8Array(ct)),
        };
        return `${E2EE_PREFIX}${toBase64Url(toUtf8(JSON.stringify(body)))}`;
    } catch (error) {
        throw new Error(error instanceof Error && error.message ? error.message : 'E2EE_ENCRYPT_FAILED');
    }
};

export const encryptBioClientSide = async (bio: string, token: string, chatId: string): Promise<string> => {
    return encryptClientText(bio, token, `user-bio:${chatId}`, 'shared');
};

export const decryptBioClientSide = async (bio: string, token: string, chatId: string): Promise<string> => {
    return decryptClientText(bio, token, `user-bio:${chatId}`);
};
