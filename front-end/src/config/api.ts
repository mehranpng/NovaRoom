const isDev = import.meta.env.VITE_IS_DEV_ENVIRONMENT === 'true';

export const API_BASE_URL = isDev
    ? import.meta.env.VITE_DEV_API_URL
    : import.meta.env.VITE_PROD_API_URL;

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
