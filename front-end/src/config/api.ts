import { decryptScopedText, encryptScopedText, isCiphertext } from '../utils/e2ee';

const isDev = import.meta.env.VITE_IS_DEV_ENVIRONMENT === 'true';

export const API_BASE_URL = isDev
    ? import.meta.env.VITE_DEV_API_URL
    : import.meta.env.VITE_PROD_API_URL;

export const API_WS_URL = API_BASE_URL?.replace(/^http/, 'ws') || '';

export const getHeaders = (includeAuth = true) => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (includeAuth) {
        const token = localStorage.getItem('token');
        if (token) headers.Authorization = `Bearer ${token}`;
    }

    if (isDev) headers['ngrok-skip-browser-warning'] = 'true';

    return headers;
};

const LEGACY_BOOTSTRAP_TOKEN = 'bootstrap:v1';

type ScopeContext = { chatId?: string; aiChatId?: string; userChatId?: string };

async function decryptAny(value: any, token: string, scopeHints: string[], ctx: ScopeContext = {}): Promise<any> {
    if (typeof value === 'string' && isCiphertext(value)) {
        for (const scope of scopeHints) {
            const plain = await decryptScopedText(value, token, scope);
            if (!isCiphertext(plain)) return plain;
            const fallback = await decryptScopedText(value, LEGACY_BOOTSTRAP_TOKEN, scope);
            if (!isCiphertext(fallback)) return fallback;
        }
        return value;
    }
    if (Array.isArray(value)) {
        return Promise.all(value.map((v) => decryptAny(v, token, scopeHints, ctx)));
    }
    if (value && typeof value === 'object') {
        const obj: Record<string, any> = { ...value };
        const chatId = String(obj.chatId || ctx.chatId || '');
        const aiChatId = String(obj.aiChatId || ctx.aiChatId || '');
        const userChatId = String(obj.chatId || ctx.userChatId || '');
        const localScopes = [...scopeHints];
        if (chatId && (obj.text !== undefined || obj.lastMessage || obj.messages || obj.replyTo)) localScopes.unshift(`chat:${chatId}`);
        if (aiChatId && (obj.content !== undefined || obj.title !== undefined || obj.summary !== undefined)) {
            localScopes.unshift(`ai:${aiChatId}`);
        }
        const nextCtx: ScopeContext = { chatId, aiChatId, userChatId: userChatId || chatId };

        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string' && isCiphertext(v)) {
                const scopes = [...localScopes];
                if (k === 'bio' && userChatId) scopes.unshift(`user-bio:${userChatId}`);
                if ((k === 'text' || k === 'reasoningContent') && chatId) scopes.unshift(`chat:${chatId}`);
                if ((k === 'content' || k === 'title' || k === 'summary' || k === 'reasoningContent') && aiChatId) scopes.unshift(`ai:${aiChatId}`);
                obj[k] = await decryptAny(v, token, scopes);
            } else {
                obj[k] = await decryptAny(v, token, localScopes, nextCtx);
            }
        }
        return obj;
    }
    return value;
}

async function encryptRequestBody(endpoint: string, body: string, token: string): Promise<string> {
    let parsed: any;
    try {
        parsed = JSON.parse(body);
    } catch {
        return body;
    }

    if (endpoint === '/profile/me' && typeof parsed.bio === 'string') {
        const me = JSON.parse(localStorage.getItem('user') || '{}');
        const chatId = String(me.chatId || '');
        if (chatId) parsed.bio = await encryptScopedText(parsed.bio, token, `user-bio:${chatId}`);
    }

    return JSON.stringify(parsed);
}

export const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('token') || '';
    let requestOptions = { ...options };

    if (token && typeof requestOptions.body === 'string') {
        requestOptions.body = await encryptRequestBody(endpoint, requestOptions.body, token);
    }

    const isFormData = typeof FormData !== 'undefined' && requestOptions.body instanceof FormData;
    const baseHeaders = isFormData
        ? Object.fromEntries(Object.entries(getHeaders()).filter(([k]) => k.toLowerCase() !== 'content-type'))
        : getHeaders();

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...requestOptions,
        headers: { ...baseHeaders, ...requestOptions.headers },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'API Error');
    }

    const data = await response.json();
    if (data && typeof data === 'object' && typeof data.e2eeSecret === 'string') {
        localStorage.setItem('e2ee_secret', data.e2eeSecret);
    }
    if (!token) return data;

    const hints: string[] = [];
    const aiChatId = /chatId=([^&]+)/.exec(endpoint)?.[1];
    if (aiChatId && endpoint.startsWith('/ai/')) hints.push(`ai:${decodeURIComponent(aiChatId)}`);
    return decryptAny(data, token, hints);
};

export const toggleReaction = async (messageId: string, emoji: string) => {
    return apiFetch(`/messages/${encodeURIComponent(messageId)}/react`, {
        method: 'POST',
        body: JSON.stringify({ messageId, emoji }),
    });
};

export const getMessageSeenBy = async (chatId: string, messageId: string) => {
    return apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/seen-by`);
};
