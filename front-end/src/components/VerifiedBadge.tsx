import { useEffect, useRef, useState } from 'react';

declare global {
    interface Window {
        bodymovin?: {
            loadAnimation: (config: Record<string, any>) => { destroy: () => void };
        };
    }
}

export function VerifiedBadge({ size = 16 }: { size?: number }) {
    const ref = useRef<HTMLSpanElement | null>(null);
    const [useFallback, setUseFallback] = useState(false);

    useEffect(() => {
        if (!ref.current || !window.bodymovin) {
            setUseFallback(true);
            return;
        }

        setUseFallback(false);
        const anim = window.bodymovin.loadAnimation({
            container: ref.current,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: '/anm/verify.json',
        });

        return () => anim.destroy();
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
