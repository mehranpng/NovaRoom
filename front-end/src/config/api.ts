const isDev = import.meta.env.VITE_IS_DEV_ENVIRONMENT === 'true';

export const API_BASE_URL = isDev
    ? import.meta.env.VITE_DEV_API_URL
    : import.meta.env.VITE_PROD_API_URL;

// WebSocket URL (strictly map protocol: http -> ws, https -> wss)
export const API_WS_URL = API_BASE_URL
    ? API_BASE_URL.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://')
    : '';

export const getHeaders = (includeAuth = true) => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (includeAuth) {
        const tokenFromCookie = (typeof document !== 'undefined'
            ? document.cookie.split('; ').find((row) => row.startsWith('auth_token='))?.split('=')[1]
            : null);
        const token = tokenFromCookie ? decodeURIComponent(tokenFromCookie) : null;
        if (token) headers.Authorization = `Bearer ${token}`;
    }

    // ngrok warning skip
    if (isDev) {
        headers['ngrok-skip-browser-warning'] = 'true';
    }

    return headers;
};

export const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const baseHeaders = isFormData
        ? Object.fromEntries(Object.entries(getHeaders()).filter(([k]) => k.toLowerCase() !== 'content-type'))
        : getHeaders();

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: { ...baseHeaders, ...options.headers },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const err: any = new Error(error.detail || 'API Error');
        err.status = response.status;
        throw err;
    }

    return response.json();
};

// Add reaction to message
export const toggleReaction = async (messageId: string, emoji: string) => {
    return apiFetch(`/messages/${encodeURIComponent(messageId)}/react`, {
        method: 'POST',
        body: JSON.stringify({ messageId, emoji }),
    });
};

export const getMessageSeenBy = async (chatId: string, messageId: string) => {
    return apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/seen-by`);
};
