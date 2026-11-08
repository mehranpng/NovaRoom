import { gcm } from '@noble/ciphers/aes';
import { API_BASE_URL } from '../config/api';

const ENC_PREFIX = 'enc:v1:';
const ENC_PREFIX_V2 = 'enc:v2:';
const ENC_NONCE_SIZE = 16;
const ENC_TAG_SIZE = 16;
const E2EE_GCM_IV_SIZE = 12;
const PBKDF2_ITERATIONS = 100000;
const PRIV_STORAGE_PREFIX = 'novaroom_e2ee_priv_';
const PUB_STORAGE_PREFIX = 'novaroom_e2ee_pub_';
const GROUP_KEY_REFRESH_MS = 120000;
const FILE_MAGIC_V3 = new Uint8Array([0x4e, 0x43, 0x46, 0x33]);
const FILE_MAGIC = new Uint8Array([0x4e, 0x43, 0x46, 0x31]); 
const FILE_MAGIC_V2 = new Uint8Array([0x4e, 0x43, 0x46, 0x32]);
const FILE_GCM_IV_SIZE = 12;
const FILE_TEXT_PREFIX = 'ncf:v1:';
const AVATAR_MAGIC = new Uint8Array([0x4e, 0x43, 0x41, 0x31]); 
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

const asBufferSource = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', asBufferSource(bytes));
        return new Uint8Array(digest);
    }
    return sha256Fallback(bytes);
};

const deriveKeyCache = new Map<string, Promise<Uint8Array>>();
const hmacKeyCache = new Map<string, Promise<CryptoKey>>();
const aesKeyCache = new Map<string, Promise<CryptoKey>>();
const decryptedTextCache = new Map<string, string>();

const deriveKey = (material: string): Promise<Uint8Array> => {
    const cached = deriveKeyCache.get(material);
    if (cached) return cached;
    const promise = sha256(toUtf8(material));
    deriveKeyCache.set(material, promise);
    return promise;
};

const getAesKey = (material: string): Promise<CryptoKey> => {
    const cached = aesKeyCache.get(material);
    if (cached) return cached;
    const promise = deriveKey(material).then((key) =>
        crypto.subtle.importKey('raw', asBufferSource(key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    );
    aesKeyCache.set(material, promise);
    void promise.catch(() => aesKeyCache.delete(material));
    return promise;
};

const xorStream = async (data: Uint8Array, key: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> => {
    const out = new Uint8Array(data.length);
    let counter = 0;
    let idx = 0;
    const BATCH_SIZE = 2048; 
    let batchCount = 0;

    while (idx < data.length) {
        const batchPromises: Promise<Uint8Array>[] = [];
        const numBlocks = Math.min(BATCH_SIZE, Math.ceil((data.length - idx) / 32));

        for (let b = 0; b < numBlocks; b++) {
            const counterBytes = new Uint8Array(8);
            const view = new DataView(counterBytes.buffer);
            view.setUint32(4, counter + b, false);
            const blockInput = new Uint8Array(key.length + nonce.length + counterBytes.length);
            blockInput.set(key, 0);
            blockInput.set(nonce, key.length);
            blockInput.set(counterBytes, key.length + nonce.length);
            batchPromises.push(sha256(blockInput));
        }

        const blocks = await Promise.all(batchPromises);

        for (let b = 0; b < blocks.length; b++) {
            const block = blocks[b];
            for (let i = 0; i < block.length && idx < data.length; i += 1) {
                out[idx] = data[idx] ^ block[i];
                idx += 1;
            }
        }
        counter += numBlocks;
        batchCount += 1;

        
        if (batchCount % 16 === 0) {
            await new Promise<void>((resolve) => {
                window.setTimeout(resolve, 0);
            });
        }
    }

    return out;
};

const hmacTag = async (keyBytes: Uint8Array, payload: Uint8Array): Promise<Uint8Array> => {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const cacheKey = toBase64Url(keyBytes);
        let keyPromise = hmacKeyCache.get(cacheKey);
        if (!keyPromise) {
            keyPromise = crypto.subtle.importKey('raw', asBufferSource(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
            hmacKeyCache.set(cacheKey, keyPromise);
        }
        const key = await keyPromise;
        const mac = await crypto.subtle.sign('HMAC', key, asBufferSource(payload));
        return new Uint8Array(mac, 0, ENC_TAG_SIZE);
    }
    return hmacSha256Fallback(keyBytes, payload).subarray(0, ENC_TAG_SIZE);
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

const hasWebCrypto = () => typeof crypto !== 'undefined' && !!crypto.subtle;

let activeUserChatId = '';
let activePrivateKeyPkcs8: Uint8Array | null = null;
let activePublicKeySpki = '';
const peerPublicKeyCache = new Map<string, string>();
const groupRawKeyCache = new Map<string, Uint8Array>();
const groupKeyRefreshAt = new Map<string, number>();
const chatAesKeyV2Cache = new Map<string, CryptoKey>();
const chatAesKeyV2Pending = new Map<string, Promise<CryptoKey | null>>();
const chatAesKeyV2CheckedAt = new Map<string, number>();

export interface E2EEBundle {
    publicKey: string;
    encryptedPrivateKey: string;
    pbkdf2Salt: string;
    keyVersion: number;
}

const derivePasswordWrappingKey = async (password: string, saltBytes: Uint8Array): Promise<CryptoKey> => {
    const baseKey = await crypto.subtle.importKey('raw', asBufferSource(toUtf8(password)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: asBufferSource(saltBytes), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
};

const packWrappedPrivateKey = async (
    password: string,
    pkcs8: Uint8Array,
): Promise<{ encryptedPrivateKey: string; pbkdf2Salt: string }> => {
    const salt = randomBytes(16);
    const iv = randomBytes(E2EE_GCM_IV_SIZE);
    const wrappingKey = await derivePasswordWrappingKey(password, salt);
    const encryptedPriv = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBufferSource(iv) }, wrappingKey, asBufferSource(pkcs8)),
    );
    const packed = new Uint8Array(iv.length + encryptedPriv.length);
    packed.set(iv, 0);
    packed.set(encryptedPriv, iv.length);
    return { encryptedPrivateKey: toBase64Url(packed), pbkdf2Salt: toBase64Url(salt) };
};

export const generateUserE2EEBundle = async (
    password: string,
): Promise<{ bundle: E2EEBundle; privateKeyPkcs8Base64: string }> => {
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
    const wrapped = await packWrappedPrivateKey(password, pkcs8);
    return {
        bundle: {
            publicKey: toBase64Url(spki),
            encryptedPrivateKey: wrapped.encryptedPrivateKey,
            pbkdf2Salt: wrapped.pbkdf2Salt,
            keyVersion: 1,
        },
        privateKeyPkcs8Base64: toBase64Url(pkcs8),
    };
};

export const rewrapPrivateKeyWithNewPassword = async (
    newPassword: string,
    publicKeySpkiBase64?: string,
    privateKeyPkcs8Base64?: string,
    userChatId?: string,
): Promise<E2EEBundle | null> => {
    if (!activePrivateKeyPkcs8 && userChatId) {
        loadLocalE2EEIdentity(userChatId);
    }
    const privB64 = privateKeyPkcs8Base64 || (activePrivateKeyPkcs8 ? toBase64Url(activePrivateKeyPkcs8) : '');
    const pubB64 = publicKeySpkiBase64 || activePublicKeySpki;
    if (!privB64 || !pubB64 || !hasWebCrypto()) {
        return null;
    }
    const wrapped = await packWrappedPrivateKey(newPassword, fromBase64Url(privB64));
    return {
        publicKey: pubB64,
        encryptedPrivateKey: wrapped.encryptedPrivateKey,
        pbkdf2Salt: wrapped.pbkdf2Salt,
        keyVersion: 1,
    };
};

export const unlockE2EEBundleWithPassword = async (
    userChatId: string,
    password: string,
    bundle: { publicKey?: string | null; encryptedPrivateKey?: string | null; pbkdf2Salt?: string | null },
): Promise<boolean> => {
    if (!bundle?.publicKey || !bundle?.encryptedPrivateKey || !bundle?.pbkdf2Salt || !hasWebCrypto()) return false;
    try {
        const salt = fromBase64Url(bundle.pbkdf2Salt);
        const packed = fromBase64Url(bundle.encryptedPrivateKey);
        if (packed.length <= E2EE_GCM_IV_SIZE) return false;
        const iv = packed.subarray(0, E2EE_GCM_IV_SIZE);
        const cipher = packed.subarray(E2EE_GCM_IV_SIZE);
        const wrappingKey = await derivePasswordWrappingKey(password, salt);
        const pkcs8 = new Uint8Array(
            await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asBufferSource(iv) }, wrappingKey, asBufferSource(cipher)),
        );
        saveLocalE2EEIdentity(userChatId, bundle.publicKey, toBase64Url(pkcs8));
        return true;
    } catch {
        return false;
    }
};

export const saveLocalE2EEIdentity = (userChatId: string, publicKeyBase64: string, privateKeyPkcs8Base64: string) => {
    activeUserChatId = userChatId;
    activePublicKeySpki = publicKeyBase64;
    activePrivateKeyPkcs8 = fromBase64Url(privateKeyPkcs8Base64);
    chatAesKeyV2Cache.clear();
    chatAesKeyV2Pending.clear();
    groupRawKeyCache.clear();
    groupKeyRefreshAt.clear();
    try {
        localStorage.setItem(`${PRIV_STORAGE_PREFIX}${userChatId}`, privateKeyPkcs8Base64);
        localStorage.setItem(`${PUB_STORAGE_PREFIX}${userChatId}`, publicKeyBase64);
    } catch {
    }
};

export const loadLocalE2EEIdentity = (userChatId: string): boolean => {
    if (!userChatId) return false;
    if (activeUserChatId === userChatId && activePrivateKeyPkcs8 && activePublicKeySpki) return true;
    try {
        const priv = localStorage.getItem(`${PRIV_STORAGE_PREFIX}${userChatId}`);
        const pub = localStorage.getItem(`${PUB_STORAGE_PREFIX}${userChatId}`);
        if (priv && pub && hasWebCrypto()) {
            activeUserChatId = userChatId;
            activePublicKeySpki = pub;
            activePrivateKeyPkcs8 = fromBase64Url(priv);
            chatAesKeyV2Cache.clear();
            chatAesKeyV2Pending.clear();
            return true;
        }
    } catch {
    }
    return false;
};

export const clearLocalE2EEIdentity = (userChatId?: string) => {
    const targets = new Set<string>();
    if (userChatId) targets.add(userChatId);
    if (activeUserChatId) targets.add(activeUserChatId);
    activeUserChatId = '';
    activePublicKeySpki = '';
    activePrivateKeyPkcs8 = null;
    chatAesKeyV2Cache.clear();
    chatAesKeyV2Pending.clear();
    groupRawKeyCache.clear();
    groupKeyRefreshAt.clear();
    targets.forEach((target) => {
        try {
            localStorage.removeItem(`${PRIV_STORAGE_PREFIX}${target}`);
            localStorage.removeItem(`${PUB_STORAGE_PREFIX}${target}`);
        } catch {
        }
    });
};

export const registerPeerPublicKey = (userChatId: string, publicKeyBase64?: string | null) => {
    if (userChatId && publicKeyBase64) {
        peerPublicKeyCache.set(userChatId, publicKeyBase64);
    }
};

const deriveEcdhSharedBytes = async (peerPublicKeySpkiB64: string): Promise<Uint8Array | null> => {
    if (!hasWebCrypto() || !activePrivateKeyPkcs8 || !peerPublicKeySpkiB64) return null;
    try {
        const privKey = await crypto.subtle.importKey(
            'pkcs8',
            asBufferSource(activePrivateKeyPkcs8),
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            ['deriveBits'],
        );
        const pubKey = await crypto.subtle.importKey(
            'spki',
            asBufferSource(fromBase64Url(peerPublicKeySpkiB64)),
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            [],
        );
        const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pubKey }, privKey, 256);
        return sha256(new Uint8Array(bits));
    } catch {
        return null;
    }
};

const directPeerChatId = (chatId: string): string => {
    const parts = chatId.slice('chat_'.length).split('_user_');
    if (parts.length !== 2) return '';
    const id1 = parts[0].startsWith('user_') ? parts[0] : `user_${parts[0]}`;
    const id2 = `user_${parts[1]}`;
    return id1 === activeUserChatId ? id2 : id1;
};

const fetchPeerPublicKey = async (peerId: string, token: string): Promise<string | null> => {
    const cached = peerPublicKeyCache.get(peerId);
    if (cached) return cached;
    if (!token) return null;
    try {
        const res = await fetch(`${API_BASE_URL}/e2ee/users/${encodeURIComponent(peerId)}/public-key`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const publicKey = data?.publicKey ? String(data.publicKey) : '';
        if (publicKey) {
            peerPublicKeyCache.set(peerId, publicKey);
            return publicKey;
        }
    } catch {
    }
    return null;
};

const resolveOrInitGroupKey = async (chatId: string, token: string): Promise<Uint8Array | null> => {
    const cached = groupRawKeyCache.get(chatId) || null;
    const lastChecked = groupKeyRefreshAt.get(chatId) || 0;
    if (cached && Date.now() - lastChecked < GROUP_KEY_REFRESH_MS) return cached;
    if (!token || !hasWebCrypto() || !activePrivateKeyPkcs8 || !activePublicKeySpki) return cached;

    try {
        const res = await fetch(`${API_BASE_URL}/e2ee/groups/${encodeURIComponent(chatId)}/keys`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return cached;
        const data = await res.json();
        const memberPublicKeys: Record<string, string> = data?.memberPublicKeys || {};
        let groupKey: Uint8Array | null = cached;
        let nextKeyVersion = Number(data?.keyVersion || 1);
        let forceRewrapAll = false;

        if (data?.myEncryptedKey) {
            try {
                const rawEntry = String(data.myEncryptedKey);
                const dotIdx = rawEntry.indexOf('.');
                const entrySenderPub = dotIdx > 0 ? rawEntry.slice(0, dotIdx) : String(data.senderPublicKey || '');
                const entryCipherB64 = dotIdx > 0 ? rawEntry.slice(dotIdx + 1) : rawEntry;
                const shared = entrySenderPub ? await deriveEcdhSharedBytes(entrySenderPub) : null;
                const packed = fromBase64Url(entryCipherB64);
                if (shared && packed.length > E2EE_GCM_IV_SIZE) {
                    const iv = packed.subarray(0, E2EE_GCM_IV_SIZE);
                    const cipher = packed.subarray(E2EE_GCM_IV_SIZE);
                    const wrapKey = await crypto.subtle.importKey('raw', asBufferSource(shared), { name: 'AES-GCM' }, false, ['decrypt']);
                    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: asBufferSource(iv) }, wrapKey, asBufferSource(cipher));
                    groupKey = new Uint8Array(plain);
                }
            } catch {
                groupKey = randomBytes(32);
                nextKeyVersion += 1;
                forceRewrapAll = true;
            }
        } else if (!data?.senderPublicKey && !groupKey) {
            groupKey = randomBytes(32);
            forceRewrapAll = true;
        }

        if (!groupKey) return null;
        groupRawKeyCache.set(chatId, groupKey);
        groupKeyRefreshAt.set(chatId, Date.now());

        const missingIds: string[] = (forceRewrapAll || !data?.senderPublicKey)
            ? Object.keys(memberPublicKeys)
            : (Array.isArray(data?.missingMemberIds) ? data.missingMemberIds : []);

        if (missingIds.length > 0) {
            const encryptedKeys: Record<string, string> = {};
            for (const uid of missingIds) {
                const pub = memberPublicKeys[uid];
                if (!pub) continue;
                const shared = await deriveEcdhSharedBytes(pub);
                if (!shared) continue;
                const iv = randomBytes(E2EE_GCM_IV_SIZE);
                const wrapKey = await crypto.subtle.importKey('raw', asBufferSource(shared), { name: 'AES-GCM' }, false, ['encrypt']);
                const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBufferSource(iv) }, wrapKey, asBufferSource(groupKey)));
                const packed = new Uint8Array(iv.length + cipher.length);
                packed.set(iv, 0);
                packed.set(cipher, iv.length);
                encryptedKeys[uid] = `${activePublicKeySpki}.${toBase64Url(packed)}`;
            }
            if (Object.keys(encryptedKeys).length > 0) {
                await fetch(`${API_BASE_URL}/e2ee/groups/${encodeURIComponent(chatId)}/keys`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ encryptedKeys, senderPublicKey: activePublicKeySpki, keyVersion: nextKeyVersion }),
                }).catch(() => undefined);
            }
        }

        return groupKey;
    } catch {
        return cached;
    }
};

export const invalidateGroupE2EECache = (chatId?: string) => {
    if (chatId) {
        groupKeyRefreshAt.delete(chatId);
        chatAesKeyV2CheckedAt.delete(chatId);
        chatAesKeyV2Cache.delete(chatId);
        chatAesKeyV2Pending.delete(chatId);
    } else {
        groupKeyRefreshAt.clear();
        chatAesKeyV2CheckedAt.clear();
        chatAesKeyV2Cache.clear();
        chatAesKeyV2Pending.clear();
    }
};

export const syncGroupE2EEKeys = async (chatId: string, token: string): Promise<boolean> => {
    if (!chatId.startsWith('grp_') || !token) return false;
    invalidateGroupE2EECache(chatId);
    const key = await resolveChatAesKeyV2(chatId, token);
    return Boolean(key);
};

export const resolveChatAesKeyV2 = async (chatId: string, token: string): Promise<CryptoKey | null> => {
    if (!chatId || !hasWebCrypto() || !activePrivateKeyPkcs8) return null;
    const cached = chatAesKeyV2Cache.get(chatId);
    if (
        cached
        && (!chatId.startsWith('grp_')
            || Date.now() - (chatAesKeyV2CheckedAt.get(chatId) || 0) < GROUP_KEY_REFRESH_MS)
    ) return cached;
    const running = chatAesKeyV2Pending.get(chatId);
    if (running) return running;

    const pending = (async (): Promise<CryptoKey | null> => {
        let rawKeyBytes: Uint8Array | null = null;

        if (chatId.startsWith('saved_messages_')) {
            const idBytes = toUtf8(chatId);
            const seed = new Uint8Array(activePrivateKeyPkcs8!.length + idBytes.length);
            seed.set(activePrivateKeyPkcs8!, 0);
            seed.set(idBytes, activePrivateKeyPkcs8!.length);
            rawKeyBytes = await sha256(seed);
        } else if (chatId === 'official-channel') {
            rawKeyBytes = await sha256(toUtf8('novaroom-official-channel-v2'));
        } else if (chatId.startsWith('chat_')) {
            const peerId = directPeerChatId(chatId);
            if (peerId) {
                const peerPub = await fetchPeerPublicKey(peerId, token);
                if (peerPub) rawKeyBytes = await deriveEcdhSharedBytes(peerPub);
            }
        } else if (chatId.startsWith('grp_')) {
            rawKeyBytes = await resolveOrInitGroupKey(chatId, token);
        }

        if (!rawKeyBytes) return null;
        const aesKey = await crypto.subtle.importKey('raw', asBufferSource(rawKeyBytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        chatAesKeyV2Cache.set(chatId, aesKey);
        chatAesKeyV2CheckedAt.set(chatId, Date.now());
        return aesKey;
    })();

    chatAesKeyV2Pending.set(chatId, pending);
    try {
        return await pending;
    } finally {
        chatAesKeyV2Pending.delete(chatId);
    }
};

export const encryptClientText = async (plain: string, token: string, scope: string, mode: 'legacy' | 'shared' = 'legacy'): Promise<string> => {
    const text = String(plain || '');
    if (!text) return '';
    try {
        const material = mode === 'shared' ? buildSharedMaterial(scope) : buildLegacyMaterial(token, scope);
        const key = await deriveKey(material);
        const nonce = randomBytes(ENC_NONCE_SIZE);
        const encrypted = await xorStream(toUtf8(text), key, nonce);
        const full = new Uint8Array(nonce.length + encrypted.length + ENC_TAG_SIZE);
        full.set(nonce, 0);
        full.set(encrypted, nonce.length);
        const tag = await hmacTag(key, full.subarray(0, nonce.length + encrypted.length));
        full.set(tag, nonce.length + encrypted.length);

        return `${ENC_PREFIX}${toBase64Url(full)}`;
    } catch {
        
        return text;
    }
};

export const decryptClientText = async (cipher: string, token: string, scope: string): Promise<string> => {
    const value = String(cipher || '');
    if (!value) return '';
    if (!value.startsWith(ENC_PREFIX) && !value.startsWith(ENC_PREFIX_V2)) return value;

    const cacheKey = `${scope}|${value}`;
    const cachedPlain = decryptedTextCache.get(cacheKey);
    if (cachedPlain !== undefined) return cachedPlain;

    if (value.startsWith(ENC_PREFIX_V2)) {
        if (!hasWebCrypto()) return value;
        const chatId = scope.startsWith('chat:') ? scope.slice(5) : '';
        const key = await resolveChatAesKeyV2(chatId, token);
        if (!key) return value;
        try {
            const raw = fromBase64Url(value.slice(ENC_PREFIX_V2.length));
            if (raw.length < E2EE_GCM_IV_SIZE + ENC_TAG_SIZE) return value;
            const iv = raw.subarray(0, E2EE_GCM_IV_SIZE);
            const body = raw.subarray(E2EE_GCM_IV_SIZE);
            const plain = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: asBufferSource(iv) },
                key,
                asBufferSource(body),
            );
            const decoded = textDecoder.decode(plain);
            if (decryptedTextCache.size > 4000) {
                const firstKey = decryptedTextCache.keys().next().value;
                if (firstKey) decryptedTextCache.delete(firstKey);
            }
            decryptedTextCache.set(cacheKey, decoded);
            return decoded;
        } catch {
            return value;
        }
    }

    try {
        const raw = fromBase64Url(value.slice(ENC_PREFIX.length));
        if (raw.length < ENC_NONCE_SIZE + ENC_TAG_SIZE) return '';

        const nonce = raw.subarray(0, ENC_NONCE_SIZE);
        const body = raw.subarray(ENC_NONCE_SIZE, raw.length - ENC_TAG_SIZE);
        const tag = raw.subarray(raw.length - ENC_TAG_SIZE);
        const nonceAndBody = raw.subarray(0, raw.length - ENC_TAG_SIZE);

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
            const decoded = textDecoder.decode(plainBytes);
            if (decryptedTextCache.size > 4000) {
                const firstKey = decryptedTextCache.keys().next().value;
                if (firstKey) decryptedTextCache.delete(firstKey);
            }
            decryptedTextCache.set(cacheKey, decoded);
            return decoded;
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
    const tasks: Promise<void>[] = [];
    if (typeof next.text === 'string') {
        tasks.push(decryptClientText(next.text, token, scope).then((dec) => { next.text = dec; }));
    }
    const replyTo = next.replyTo;
    if (replyTo && typeof replyTo === 'object' && typeof replyTo.text === 'string') {
        tasks.push(decryptClientText(replyTo.text, token, scope).then((decReply) => {
            next.replyTo = { ...replyTo, text: decReply };
        }));
    }
    if (typeof next.reasoningContent === 'string') {
        tasks.push(decryptClientText(next.reasoningContent, token, scope).then((decReasoning) => {
            next.reasoningContent = decReasoning;
        }));
    }
    if (typeof next.searchSources === 'string') {
        tasks.push(decryptClientText(next.searchSources, token, scope).then((decSources) => {
            try {
                const parsed = JSON.parse(decSources);
                next.searchSources = Array.isArray(parsed) ? parsed : [];
            } catch {
                next.searchSources = [];
            }
        }));
    }
    await Promise.all(tasks);
    return next;
};

export const encryptChatTextClientSide = async (text: string, token: string, chatId: string): Promise<string> => {
    const plain = String(text || '');
    if (!plain) return '';
    if (hasWebCrypto()) {
        if (chatId.startsWith('grp_')) {
            groupKeyRefreshAt.delete(chatId);
            chatAesKeyV2CheckedAt.delete(chatId);
        }
        const key = await resolveChatAesKeyV2(chatId, token);
        if (key) {
            try {
                const iv = randomBytes(E2EE_GCM_IV_SIZE);
                const encrypted = new Uint8Array(
                    await crypto.subtle.encrypt(
                        { name: 'AES-GCM', iv: asBufferSource(iv) },
                        key,
                        asBufferSource(toUtf8(plain)),
                    ),
                );
                const packed = new Uint8Array(iv.length + encrypted.length);
                packed.set(iv, 0);
                packed.set(encrypted, iv.length);
                return `${ENC_PREFIX_V2}${toBase64Url(packed)}`;
            } catch {
            }
        }
    }
    return encryptClientText(plain, token, `chat:${chatId}`, 'shared');
};

const MENTION_EXTRACT_RE = /(?<![A-Za-z0-9_])@([A-Za-z0-9_]*[A-Za-z][A-Za-z0-9_]*)/g;

export const extractMentionedUsernames = (plainText: string): string[] => {
    if (!plainText) return [];
    const seen = new Set<string>();
    for (const match of plainText.matchAll(MENTION_EXTRACT_RE)) {
        if (match[1]) seen.add(match[1].toLowerCase());
        if (seen.size >= 30) break;
    }
    return Array.from(seen);
};

export const encryptBioClientSide = async (bio: string, token: string, chatId: string): Promise<string> => {
    return encryptClientText(bio, token, `user-bio:${chatId}`, 'shared');
};

export const decryptBioClientSide = async (bio: string, token: string, chatId: string): Promise<string> => {
    return decryptClientText(bio, token, `user-bio:${chatId}`);
};

const hasMagic = (raw: Uint8Array, magic: Uint8Array): boolean => {
    if (raw.length < magic.length) return false;
    for (let i = 0; i < magic.length; i += 1) {
        if (raw[i] !== magic[i]) return false;
    }
    return true;
};

const hasAsciiPrefix = (raw: Uint8Array, prefix: string): boolean => {
    if (raw.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) {
        if (raw[i] !== prefix.charCodeAt(i)) return false;
    }
    return true;
};

// shortcut: v1 keystream costs one SHA-256 per 32 bytes; kept for old data and no-WebCrypto fallback, upgrade by migrating old files to NCF2.
const encryptFileBytesV1 = async (plain: Uint8Array, chatId: string): Promise<Uint8Array> => {
    if (!plain.length) return plain;
    try {
        const scope = `chat:${chatId}`;
        const key = await deriveKey(buildSharedMaterial(scope));
        const nonce = randomBytes(ENC_NONCE_SIZE);
        const encrypted = await xorStream(plain, key, nonce);
        const nonceAndEncrypted = new Uint8Array(nonce.length + encrypted.length);
        nonceAndEncrypted.set(nonce, 0);
        nonceAndEncrypted.set(encrypted, nonce.length);
        const tag = await hmacTag(key, nonceAndEncrypted);
        const full = new Uint8Array(FILE_MAGIC.length + nonce.length + encrypted.length + tag.length);
        full.set(FILE_MAGIC, 0);
        full.set(nonce, FILE_MAGIC.length);
        full.set(encrypted, FILE_MAGIC.length + nonce.length);
        full.set(tag, FILE_MAGIC.length + nonce.length + encrypted.length);
        return full;
    } catch {
        return plain;
    }
};

export const encryptFileWithRandomKey = async (
    plain: Uint8Array,
    token: string,
    chatId: string,
): Promise<{ encryptedBytes: Uint8Array; encryptedFileKey: string }> => {
    const fileKey = randomBytes(32);
    const iv = randomBytes(FILE_GCM_IV_SIZE);
    const useWebCrypto = hasWebCrypto();
    const cryptoKey = useWebCrypto
        ? await crypto.subtle.importKey('raw', asBufferSource(fileKey), { name: 'AES-GCM' }, false, ['encrypt'])
        : null;
    const encrypted = cryptoKey
        ? new Uint8Array(
            await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBufferSource(iv) }, cryptoKey, asBufferSource(plain)),
        )
        : gcm(fileKey, iv).encrypt(plain);
    const full = new Uint8Array(FILE_MAGIC_V3.length + iv.length + encrypted.length);
    full.set(FILE_MAGIC_V3, 0);
    full.set(iv, FILE_MAGIC_V3.length);
    full.set(encrypted, FILE_MAGIC_V3.length + iv.length);
    const encryptedFileKey = await encryptChatTextClientSide(toBase64Url(fileKey), token, chatId);
    return { encryptedBytes: full, encryptedFileKey };
};

export const encryptFileBytesClientSide = async (plain: Uint8Array, _token: string, chatId: string): Promise<Uint8Array> => {
    if (!plain.length) return plain;
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        return encryptFileBytesV1(plain, chatId);
    }
    try {
        const scope = `chat:${chatId}`;
        const key = await getAesKey(buildSharedMaterial(scope));
        const iv = randomBytes(FILE_GCM_IV_SIZE);
        const encrypted = new Uint8Array(await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: asBufferSource(iv) },
            key,
            asBufferSource(plain),
        ));
        const full = new Uint8Array(FILE_MAGIC_V2.length + iv.length + encrypted.length);
        full.set(FILE_MAGIC_V2, 0);
        full.set(iv, FILE_MAGIC_V2.length);
        full.set(encrypted, FILE_MAGIC_V2.length + iv.length);
        return full;
    } catch {
        return encryptFileBytesV1(plain, chatId);
    }
};

export const decryptFileBytesClientSide = async (raw: Uint8Array, token: string, chatId: string, encryptedFileKey?: string): Promise<Uint8Array> => {
    if (!raw.length) return raw;
    const scope = `chat:${chatId}`;
    if (hasMagic(raw, FILE_MAGIC_V3)) {
        if (!encryptedFileKey) return raw;
        try {
            const fileKeyB64 = await decryptClientText(encryptedFileKey, token, scope);
            if (!fileKeyB64 || fileKeyB64.startsWith('enc:')) return raw;
            const fileKey = fromBase64Url(fileKeyB64);
            if (fileKey.length !== 32) return raw;
            if (raw.length < FILE_MAGIC_V3.length + FILE_GCM_IV_SIZE + ENC_TAG_SIZE) return raw;
            const iv = raw.subarray(FILE_MAGIC_V3.length, FILE_MAGIC_V3.length + FILE_GCM_IV_SIZE);
            const body = raw.subarray(FILE_MAGIC_V3.length + FILE_GCM_IV_SIZE);
            if (hasWebCrypto()) {
                const cryptoKey = await crypto.subtle.importKey('raw', asBufferSource(fileKey), { name: 'AES-GCM' }, false, ['decrypt']);
                const plain = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: asBufferSource(iv) },
                    cryptoKey,
                    asBufferSource(body),
                );
                return new Uint8Array(plain);
            }
            return gcm(fileKey, iv).decrypt(body);
        } catch {
            return raw;
        }
    }
    if (hasMagic(raw, FILE_MAGIC_V2)) {
        if (raw.length < FILE_MAGIC_V2.length + FILE_GCM_IV_SIZE + ENC_TAG_SIZE) return raw;
        try {
            const iv = raw.subarray(FILE_MAGIC_V2.length, FILE_MAGIC_V2.length + FILE_GCM_IV_SIZE);
            const body = raw.subarray(FILE_MAGIC_V2.length + FILE_GCM_IV_SIZE);
            const key = await deriveKey(buildSharedMaterial(scope));
            if (typeof crypto !== 'undefined' && crypto.subtle) {
                const plain = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: asBufferSource(iv) },
                    await getAesKey(buildSharedMaterial(scope)),
                    asBufferSource(body),
                );
                return new Uint8Array(plain);
            }
            return gcm(key, iv).decrypt(body);
        } catch {
            return raw;
        }
    }
    let packed: Uint8Array | null = null;
    if (hasMagic(raw, FILE_MAGIC)) {
        packed = raw.subarray(FILE_MAGIC.length);
    } else if (hasAsciiPrefix(raw, FILE_TEXT_PREFIX)) {
        try {
            packed = fromBase64Url(textDecoder.decode(raw.subarray(FILE_TEXT_PREFIX.length)));
        } catch {
            packed = null;
        }
    }
    if (!packed) return raw;
    if (packed.length < ENC_NONCE_SIZE + ENC_TAG_SIZE) return raw;

    try {
        const nonce = packed.subarray(0, ENC_NONCE_SIZE);
        const body = packed.subarray(ENC_NONCE_SIZE, packed.length - ENC_TAG_SIZE);
        const tag = packed.subarray(packed.length - ENC_TAG_SIZE);
        const key = await deriveKey(buildSharedMaterial(scope));
        const expectedTag = await hmacTag(key, packed.subarray(0, packed.length - ENC_TAG_SIZE));
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
        const scope = 'profile-avatar:shared';
        const key = await deriveKey(buildSharedMaterial(scope));
        const nonce = randomBytes(ENC_NONCE_SIZE);
        const encrypted = await xorStream(plain, key, nonce);
        const nonceAndEncrypted = new Uint8Array(nonce.length + encrypted.length);
        nonceAndEncrypted.set(nonce, 0);
        nonceAndEncrypted.set(encrypted, nonce.length);
        const tag = await hmacTag(key, nonceAndEncrypted);
        const full = new Uint8Array(AVATAR_MAGIC.length + nonce.length + encrypted.length + tag.length);
        full.set(AVATAR_MAGIC, 0);
        full.set(nonce, AVATAR_MAGIC.length);
        full.set(encrypted, AVATAR_MAGIC.length + nonce.length);
        full.set(tag, AVATAR_MAGIC.length + nonce.length + encrypted.length);
        return full;
    } catch {
        return plain;
    }
};

export const decryptAvatarBytesClientSide = async (raw: Uint8Array, _token: string): Promise<Uint8Array> => {
    if (!raw.length) return raw;
    let packed: Uint8Array | null = null;
    if (hasMagic(raw, AVATAR_MAGIC)) {
        packed = raw.subarray(AVATAR_MAGIC.length);
    } else if (hasAsciiPrefix(raw, AVATAR_TEXT_PREFIX)) {
        try {
            packed = fromBase64Url(textDecoder.decode(raw.subarray(AVATAR_TEXT_PREFIX.length)));
        } catch {
            packed = null;
        }
    }
    if (!packed) return raw;
    if (packed.length < ENC_NONCE_SIZE + ENC_TAG_SIZE) return raw;
    try {
        const nonce = packed.subarray(0, ENC_NONCE_SIZE);
        const body = packed.subarray(ENC_NONCE_SIZE, packed.length - ENC_TAG_SIZE);
        const tag = packed.subarray(packed.length - ENC_TAG_SIZE);
        const key = await deriveKey(buildSharedMaterial('profile-avatar:shared'));
        const expectedTag = await hmacTag(key, packed.subarray(0, packed.length - ENC_TAG_SIZE));
        const sameTag = tag.length === expectedTag.length && tag.every((b, i) => b === expectedTag[i]);
        if (!sameTag) return raw;
        return xorStream(body, key, nonce);
    } catch {
        return raw;
    }
};
