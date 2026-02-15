import { LottieJson } from './LottieJson';

export function VerifiedBadge({ size = 16 }: { size?: number }) {
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
            <LottieJson path="/anm/verify.json" className="verified-badge__lottie" />
        </span>
    );
}
