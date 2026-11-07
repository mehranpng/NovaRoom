import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    prompt(): Promise<void>;
}

const DISMISS_COOKIE_NAME = 'nr_pwa_banner_dismissed';
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

const getCookie = (name: string): string | null => {
    if (typeof document === 'undefined') return null;
    const key = `${encodeURIComponent(name)}=`;
    const row = document.cookie.split('; ').find((item) => item.startsWith(key));
    return row ? decodeURIComponent(row.slice(key.length)) : null;
};

const setCookie = (name: string, value: string, maxAgeSec = COOKIE_MAX_AGE_SEC) => {
    if (typeof document === 'undefined') return;
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; samesite=lax`;
};

const checkIsStandalone = (): boolean => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    if (typeof document !== 'undefined' && document.referrer.startsWith('android-app://')) return true;
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches
    );
};

const checkIsMobileDevice = (): boolean => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(ua)) return true;
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    return window.matchMedia('(max-width: 768px) and (pointer: coarse)').matches;
};

export const isIosDevice = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
};

export type PwaState = {
    isMobileWeb: boolean;
    bannerDismissed: boolean;
    canPromptNatively: boolean;
    guideOpen: boolean;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let state: PwaState = {
    isMobileWeb: checkIsMobileDevice() && !checkIsStandalone(),
    bannerDismissed: getCookie(DISMISS_COOKIE_NAME) === '1',
    canPromptNatively: false,
    guideOpen: false,
};

const listeners = new Set<() => void>();

const emit = () => {
    listeners.forEach((listener) => listener());
};

const recomputeState = (patch?: Partial<PwaState>) => {
    const nextMobileWeb = checkIsMobileDevice() && !checkIsStandalone();
    state = {
        ...state,
        ...patch,
        isMobileWeb: nextMobileWeb,
        canPromptNatively: Boolean(deferredPrompt),
    };
    emit();
};

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredPrompt = event as BeforeInstallPromptEvent;
        recomputeState();
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        recomputeState({ guideOpen: false });
    });

    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    standaloneMedia.addEventListener?.('change', () => recomputeState());
    window.addEventListener('resize', () => recomputeState());
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export function usePwaInstall(): PwaState {
    return useSyncExternalStore(subscribe, () => state, () => state);
}

export function dismissPwaBanner(): void {
    setCookie(DISMISS_COOKIE_NAME, '1');
    recomputeState({ bannerDismissed: true });
}

export function closePwaGuide(): void {
    recomputeState({ guideOpen: false });
}

export async function triggerPwaInstall(): Promise<void> {
    if (deferredPrompt) {
        const promptEvent = deferredPrompt;
        try {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            if (choice.outcome === 'accepted') {
                deferredPrompt = null;
            }
        } catch {
            void 0;
        }
        recomputeState();
        return;
    }
    recomputeState({ guideOpen: true });
}
