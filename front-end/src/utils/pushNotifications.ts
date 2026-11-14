import { useSyncExternalStore } from 'react';
import { apiFetch } from '../config/api';
import { notify } from './notificationBus';

export type ChatNotifyMode = 'all' | 'muted' | 'mentions';
export type PushSupport = 'supported' | 'unsupported' | 'needs-install';
export type NotificationPrefs = {
    enabled: boolean;
    chess: boolean;
    sound: boolean;
    smart: boolean;
    chatModes: Record<string, ChatNotifyMode>;
};

const STORAGE_KEY = 'nr_notify_prefs';
const DEFAULT_PREFS: NotificationPrefs = { enabled: true, chess: true, sound: true, smart: true, chatModes: {} };

const normalizePrefs = (value: unknown): NotificationPrefs => {
    const record = (value && typeof value === 'object' ? value : {}) as Partial<NotificationPrefs>;
    return {
        enabled: record.enabled !== false,
        chess: record.chess !== false,
        sound: record.sound !== false,
        smart: record.smart !== false,
        chatModes: record.chatModes && typeof record.chatModes === 'object' ? record.chatModes : {},
    };
};

const readStoredPrefs = (): NotificationPrefs => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? normalizePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
    } catch {
        return DEFAULT_PREFS;
    }
};

let prefs: NotificationPrefs = readStoredPrefs();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const setPrefs = (next: NotificationPrefs) => {
    prefs = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        void 0;
    }
    listeners.forEach((listener) => listener());
};

export function useNotificationPrefs(): NotificationPrefs {
    return useSyncExternalStore(subscribe, () => prefs, () => prefs);
}

export function getPushSupport(): PushSupport {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
    if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
        return 'supported';
    }
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches) {
        return 'needs-install';
    }
    return 'unsupported';
}

export function getPermission(): NotificationPermission | 'unsupported' {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (getPushSupport() !== 'supported') return null;
    try {
        return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch {
        return null;
    }
}

const urlBase64ToUint8Array = (value: string): Uint8Array<ArrayBuffer> => {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i);
    }
    return output;
};

const keyToBase64 = (key: ArrayBuffer): string => {
    const bytes = new Uint8Array(key);
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function ensurePushSubscription(): Promise<boolean> {
    if (getPushSupport() !== 'supported') return false;
    if (getPermission() !== 'granted') return false;
    try {
        const registration = await navigator.serviceWorker.ready;
        const response = await apiFetch('/push/vapid-public-key');
        const publicKey = String(response?.publicKey || '');
        if (!publicKey) return false;
        let subscription = await registration.pushManager.getSubscription();
        const currentKey = subscription?.options?.applicationServerKey;
        if (subscription && (!currentKey || keyToBase64(currentKey) !== publicKey)) {
            await subscription.unsubscribe();
            subscription = null;
        }
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            });
        }
        const json = subscription.toJSON();
        await apiFetch('/push/subscribe', {
            method: 'POST',
            body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        });
        return true;
    } catch {
        return false;
    }
}

export async function requestPermissionAndSubscribe(): Promise<NotificationPermission | 'unsupported'> {
    if (getPushSupport() !== 'supported') return 'unsupported';
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        await ensurePushSubscription();
    }
    return permission;
}

export async function unsubscribePush(): Promise<void> {
    if (getPushSupport() !== 'supported') return;
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) return;
        await apiFetch('/push/unsubscribe', {
            method: 'POST',
            body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => void 0);
        await subscription.unsubscribe();
    } catch {
        void 0;
    }
}

export async function loadNotificationPrefs(): Promise<void> {
    try {
        const response = await apiFetch('/profile/me/notifications');
        setPrefs(normalizePrefs(response));
    } catch {
        void 0;
    }
}

export function getChatNotifyMode(current: NotificationPrefs, chatId: string): ChatNotifyMode {
    return current.chatModes[chatId] ?? 'all';
}

export async function updateNotificationPrefs(
    patch: Partial<Pick<NotificationPrefs, 'enabled' | 'chess' | 'sound' | 'smart'>>
): Promise<void> {
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    try {
        const response = await apiFetch('/profile/me/notifications', {
            method: 'PUT',
            body: JSON.stringify(patch),
        });
        setPrefs(normalizePrefs(response));
    } catch {
        setPrefs(previous);
        notify('خطا در ذخیره تنظیمات اعلان');
    }
}

export async function setChatNotifyMode(chatId: string, mode: ChatNotifyMode): Promise<void> {
    const previous = prefs;
    const chatModes = { ...prefs.chatModes };
    if (mode === 'all') {
        delete chatModes[chatId];
    } else {
        chatModes[chatId] = mode;
    }
    setPrefs({ ...prefs, chatModes });
    try {
        const response = await apiFetch(`/profile/me/notifications/chats/${encodeURIComponent(chatId)}`, {
            method: 'PUT',
            body: JSON.stringify({ mode }),
        });
        setPrefs(normalizePrefs(response));
    } catch {
        setPrefs(previous);
        notify('خطا در ذخیره تنظیمات اعلان');
    }
}

export async function closeChatNotifications(chatId: string): Promise<void> {
    if (getPushSupport() !== 'supported') return;
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        const list = await registration?.getNotifications({ tag: 'chat:' + chatId });
        list?.forEach((notification) => notification.close());
    } catch {
        void 0;
    }
}

export async function closeChessNotifications(gameId: string): Promise<void> {
    if (getPushSupport() !== 'supported') return;
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        const list = await registration?.getNotifications({ tag: 'chess:' + gameId });
        list?.forEach((notification) => notification.close());
    } catch {
        void 0;
    }
}

let notificationSound: HTMLAudioElement | null = null;

export function playNotificationSound(): void {
    if (!prefs.sound || typeof Audio === 'undefined') return;
    if (!notificationSound) {
        notificationSound = new Audio('/sounds/notification.wav');
        notificationSound.volume = 0.6;
    }
    try {
        notificationSound.currentTime = 0;
        void notificationSound.play().catch(() => void 0);
    } catch {
        void 0;
    }
}
