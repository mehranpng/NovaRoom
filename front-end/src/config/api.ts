const isDev = import.meta.env.VITE_IS_DEV_ENVIRONMENT === 'true';

export const API_BASE_URL = isDev
    ? import.meta.env.VITE_DEV_API_URL
    : import.meta.env.VITE_PROD_API_URL;

// WebSocket URL (convert http/https to ws/wss)
export const API_WS_URL = API_BASE_URL?.replace(/^http/, 'ws') || '';

export const getHeaders = (includeAuth = true) => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (includeAuth) {
        const token = localStorage.getItem('token');
        if (token) headers.Authorization = `Bearer ${token}`;
    }

    // ngrok warning skip
    if (isDev) {
        headers['ngrok-skip-browser-warning'] = 'true';
    }

    return headers;
};

export const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: { ...getHeaders(), ...options.headers },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'API Error');
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
