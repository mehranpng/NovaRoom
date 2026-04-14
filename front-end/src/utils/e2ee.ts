const ENC_PREFIX = 'enc:v1:';
const ENC_NONCE_SIZE = 16;
const ENC_TAG_SIZE = 16;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(digest);
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
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, payload);
    return new Uint8Array(mac).slice(0, ENC_TAG_SIZE);
};

const buildLegacyMaterial = (token: string, scope: string) => `${token || ''}|${scope || ''}`;
const buildSharedMaterial = (scope: string) => `novaroom-client-shared|${scope || ''}`;

export const encryptClientText = async (plain: string, token: string, scope: string, mode: 'legacy' | 'shared' = 'legacy'): Promise<string> => {
    const text = String(plain || '');
    if (!text) return '';
    try {
        const material = mode === 'shared' ? buildSharedMaterial(scope) : buildLegacyMaterial(token, scope);
        const key = await deriveKey(material);
        const nonce = crypto.getRandomValues(new Uint8Array(ENC_NONCE_SIZE));
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
        // Never block message/profile flows if browser crypto is unavailable.
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
            buildSharedMaterial(scope),       // current (shared per chat/bio scope)
            buildLegacyMaterial(token, scope), // previous broken rollout compatibility
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

export const decryptMessageClientSide = async (message: any, token: string, chatId: string): Promise<any> => {
    if (!message) return message;
    const scope = `chat:${chatId}`;
    const next = { ...message };
    if (typeof next.text === 'string') {
        const dec = await decryptClientText(next.text, token, scope);
        next.text = dec.startsWith(ENC_PREFIX) ? '🔐' : dec;
    }
    if (next.replyTo && typeof next.replyTo === 'object' && typeof next.replyTo.text === 'string') {
        const decReply = await decryptClientText(next.replyTo.text, token, scope);
        next.replyTo = { ...next.replyTo, text: decReply.startsWith(ENC_PREFIX) ? '🔐' : decReply };
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
