export function VerifiedBadge({ size = 16 }: { size?: number }) {
    const inner = Math.max(10, Math.round(size * 0.7));

    return (
        <span
            aria-label="Verified"
            title="Verified"
            style={{
                width: size,
                height: size,
                borderRadius: 999,
                background: 'var(--accent-primary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 auto',
            }}
        >
            <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none">
                <path
                    d="M20 6L9 17l-5-5"
                    stroke="#fff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </span>
    );
}
