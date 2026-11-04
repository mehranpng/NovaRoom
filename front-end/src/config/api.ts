const configuredApiUrl = import.meta.env.VITE_API_URL || '/api';

export const API_BASE_URL = configuredApiUrl.replace(/\/+$/, '');

export const API_WS_URL = (() => {
    if (!API_BASE_URL) return '';
    if (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://')) {
        return API_BASE_URL.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
    }
    if (typeof window !== 'undefined' && window.location) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const prefix = API_BASE_URL.startsWith('/') ? API_BASE_URL : `/${API_BASE_URL}`;
        return `${protocol}//${window.location.host}${prefix}`;
    }
    return API_BASE_URL;
})();

export const getAuthToken = (): string | null => {
    const tokenFromStorage = (typeof localStorage !== 'undefined'
        ? localStorage.getItem('token')
        : null);
    if (tokenFromStorage) return tokenFromStorage;
    const tokenFromCookie = (typeof document !== 'undefined'
        ? document.cookie.split('; ').find((row) => row.startsWith('auth_token='))?.split('=')[1]
        : null);
    return tokenFromCookie ? decodeURIComponent(tokenFromCookie) : null;
};

export const getHeaders = (includeAuth = true) => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (includeAuth) {
        const token = getAuthToken();
        if (token) headers.Authorization = `Bearer ${token}`;
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


export const toggleReaction = async (messageId: string, emoji: string) => {
    return apiFetch(`/messages/${encodeURIComponent(messageId)}/react`, {
        method: 'POST',
        body: JSON.stringify({ messageId, emoji }),
    });
};

export const getMessageSeenBy = async (chatId: string, messageId: string) => {
    return apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/seen-by`);
};
