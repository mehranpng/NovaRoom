export function SendIcon({ size = 20 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ display: 'block' }}
            aria-hidden="true"
        >
            <path
                d="M2.5 21.3 20 13.2 Q24 12 20 10.8 L2.5 2.7 2.4 9.2 12.4 12 2.4 14.8 Z"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
