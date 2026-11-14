import { useSyncExternalStore } from 'react';

export const MESSAGE_TEXT_SIZE_MIN = 12;
export const MESSAGE_TEXT_SIZE_MAX = 20;
export const MESSAGE_TEXT_SIZE_VALUES = [12, 13, 14, 15, 16, 17, 18, 19, 20] as const;

export const DEFAULT_MESSAGE_TEXT_SIZE_PX = 16;
export const IOS_DEFAULT_MESSAGE_TEXT_SIZE_PX = 17;
export const MACOS_DEFAULT_MESSAGE_TEXT_SIZE_PX = 15;

const STORAGE_KEY = 'messageTextSize';
const listeners = new Set<() => void>();

function detectPlatformFlags(): { isIOS: boolean; isMacOS: boolean } {
    if (typeof navigator === 'undefined') {
        return { isIOS: false, isMacOS: false };
    }
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const isIOS = /iPhone|iPad|iPod/i.test(platform)
        || /iPhone|iPad|iPod/i.test(ua)
        || (platform === 'MacIntel' && navigator.maxTouchPoints > 2);
    const isMacOS = !isIOS && (/Mac/i.test(platform) || /Mac OS/i.test(ua));
    return { isIOS, isMacOS };
}

export function getDefaultMessageTextSize(): number {
    const { isIOS, isMacOS } = detectPlatformFlags();
    if (isIOS) return IOS_DEFAULT_MESSAGE_TEXT_SIZE_PX;
    if (isMacOS) return MACOS_DEFAULT_MESSAGE_TEXT_SIZE_PX;
    return DEFAULT_MESSAGE_TEXT_SIZE_PX;
}

export function clampMessageTextSize(value: number): number {
    if (!Number.isFinite(value)) return getDefaultMessageTextSize();
    return Math.min(MESSAGE_TEXT_SIZE_MAX, Math.max(MESSAGE_TEXT_SIZE_MIN, Math.round(value)));
}

export function getMessageTextSize(): number {
    if (typeof window === 'undefined') return getDefaultMessageTextSize();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return getDefaultMessageTextSize();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return getDefaultMessageTextSize();
    return clampMessageTextSize(parsed);
}

export function applyMessageTextSize(size: number): void {
    if (typeof document === 'undefined') return;
    const clamped = clampMessageTextSize(size);
    const { isIOS } = detectPlatformFlags();
    const root = document.documentElement;
    root.style.setProperty('--composer-text-size', `${Math.max(clamped, isIOS ? 16 : 15)}px`);
    root.style.setProperty('--message-meta-height', `${Math.floor(clamped * 1.25)}px`);
    root.style.setProperty('--message-text-size', `${clamped}px`);
    root.setAttribute('data-message-text-size', String(clamped));
}

export function setMessageTextSize(size: number): void {
    const clamped = clampMessageTextSize(size);
    if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, String(clamped));
    }
    applyMessageTextSize(clamped);
    listeners.forEach((listener) => listener());
}

export function initMessageTextSize(): number {
    const size = getMessageTextSize();
    applyMessageTextSize(size);
    return size;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (typeof window === 'undefined') {
        return () => {
            listeners.delete(listener);
        };
    }
    const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) {
            applyMessageTextSize(getMessageTextSize());
            listener();
        }
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

export function useMessageTextSize(): [number, (nextSize: number) => void] {
    const size = useSyncExternalStore(subscribe, getMessageTextSize, getDefaultMessageTextSize);
    return [size, setMessageTextSize];
}
