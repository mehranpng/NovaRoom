import { useState } from 'react';
import { LottieJson } from './LottieJson';

export function VerifiedBadge({ size = 16 }: { size?: number }) {
    const [fallback, setFallback] = useState(false);
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
        >
            {!fallback ? (
                <LottieJson
                    path="/anm/verify.json"
                    className="verified-badge__lottie"
                    onUnavailable={() => setFallback(true)}
                />
            ) : (
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
