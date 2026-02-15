import { useEffect, useRef, useState } from 'react';

declare global {
    interface Window {
        bodymovin?: {
            loadAnimation: (config: Record<string, any>) => { destroy: () => void };
        };
    }
}

const LOTTIE_SCRIPT_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js';

interface LottieJsonProps {
    path: string;
    loop?: boolean;
    autoplay?: boolean;
    className?: string;
    onUnavailable?: () => void;
}

function ensureLottieLoaded(): Promise<void> {
    if (window.bodymovin) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[data-lottie-loader="true"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('failed to load lottie script')), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = LOTTIE_SCRIPT_SRC;
        script.async = true;
        script.dataset.lottieLoader = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('failed to load lottie script'));
        document.head.appendChild(script);
    });
}

export function LottieJson({ path, loop = true, autoplay = true, className, onUnavailable }: LottieJsonProps) {
    const ref = useRef<HTMLSpanElement | null>(null);
    const [ready, setReady] = useState(Boolean(window.bodymovin));

    useEffect(() => {
        let alive = true;
        if (ready) return;

        ensureLottieLoaded()
            .then(() => {
                if (alive) setReady(true);
            })
            .catch(() => {
                if (alive) onUnavailable?.();
            });

        return () => {
            alive = false;
        };
    }, [ready, onUnavailable]);

    useEffect(() => {
        if (!ready || !ref.current || !window.bodymovin) return;

        const anim = window.bodymovin.loadAnimation({
            container: ref.current,
            renderer: 'svg',
            loop,
            autoplay,
            path,
        });

        return () => anim.destroy();
    }, [autoplay, loop, path, ready]);

    return <span className={className} ref={ref} />;
}
