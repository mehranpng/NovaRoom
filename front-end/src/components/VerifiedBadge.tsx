export function VerifiedBadge({ size = 16 }: { size?: number }) {
    const renderedSize = Math.round(size * 1.15);

    return (
        <svg
            width={renderedSize}
            height={renderedSize}
            viewBox="0 0 24 24"
            role="img"
            aria-label="Verified"
            style={{ flex: '0 0 auto', marginInlineStart: '-3px' }}
        >
            <path
                fill="var(--accent-primary)"
                d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"
            />
            <path
                fill="none"
                stroke="#fff"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
                transform="translate(12 12) scale(0.9) translate(-12 -12)"
                d="M7.2 12.5 10.1 15.4 16.6 8.7"
            />
        </svg>
    );
}
