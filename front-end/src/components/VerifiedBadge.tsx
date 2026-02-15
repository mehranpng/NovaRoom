import { useEffect, useRef, useState } from 'react';

declare global {
    interface Window {
        bodymovin?: {
            loadAnimation: (config: Record<string, any>) => { destroy: () => void };
        };
    }
}

const LOTTIE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js';

async function ensureBodymovin(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (window.bodymovin) return true;

    return new Promise((resolve) => {
        const existing = document.querySelector(`script[src="${LOTTIE_CDN}"]`) as HTMLScriptElement | null;
        if (existing) {
            existing.addEventListener('load', () => resolve(Boolean(window.bodymovin)), { once: true });
            existing.addEventListener('error', () => resolve(false), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = LOTTIE_CDN;
        script.async = true;
        script.onload = () => resolve(Boolean(window.bodymovin));
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });
}

export function VerifiedBadge({ size = 16 }: { size?: number }) {
    const ref = useRef<HTMLSpanElement | null>(null);
    const [useFallback, setUseFallback] = useState(false);

    useEffect(() => {
        let anim: { destroy: () => void } | null = null;
        let mounted = true;

        const run = async () => {
            const ok = await ensureBodymovin();
            if (!mounted || !ref.current || !ok || !window.bodymovin) {
                setUseFallback(true);
                return;
            }

            setUseFallback(false);
            anim = window.bodymovin.loadAnimation({
                container: ref.current,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                path: '/anm/verify.json',
            });
        };

        run();

        return () => {
            mounted = false;
            anim?.destroy();
        };
    }, []);

    const inner = Math.max(10, Math.round(size * 0.7));

    return (
        <span
            aria-label="Verified"
            title="Verified"
            style={{
                width: size,
                height: size,
                borderRadius: 999,
                background: '#2F80ED',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 auto',
                overflow: 'hidden',
            }}
            ref={ref}
        >
            {useFallback && (
                <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none">
                    <path
                        d="M20 6L9 17l-5-5"
                        stroke="#fff"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            )}
        </span>
    );
}
