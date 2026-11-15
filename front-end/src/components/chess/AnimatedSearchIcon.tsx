import { useId } from 'react';
import { motion } from 'framer-motion';

interface AnimatedSearchIconProps {
    size?: number;
}

export function AnimatedSearchIcon({ size = 28 }: AnimatedSearchIconProps) {
    const uid = useId().replace(/:/g, '');
    const lensClipId = `search-lens-${uid}`;

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
        >
            <defs>
                <clipPath id={lensClipId}>
                    <circle cx="14.2" cy="14.2" r="5.8" />
                </clipPath>
            </defs>

            <motion.g
                animate={{
                    x: [0, 1.55, 2.2, 1.55, 0, -1.55, -2.2, -1.55, 0],
                    y: [-2.2, -1.55, 0, 1.55, 2.2, 1.55, 0, -1.55, -2.2],
                    rotate: [-4, 0, 4, 0, -4],
                }}
                transition={{
                    x: { duration: 2.6, repeat: Infinity, ease: 'linear' },
                    y: { duration: 2.6, repeat: Infinity, ease: 'linear' },
                    rotate: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' },
                }}
                style={{ transformOrigin: '16px 16px' }}
            >
                <circle
                    cx="14.2"
                    cy="14.2"
                    r="6.6"
                    fill="currentColor"
                    fillOpacity={0.1}
                />

                <g clipPath={`url(#${lensClipId})`}>
                    <motion.rect
                        x="4"
                        y="6"
                        width="4.5"
                        height="18"
                        rx="2"
                        fill="currentColor"
                        fillOpacity={0.22}
                        style={{ rotate: 28, transformOrigin: '14.2px 14.2px' }}
                        animate={{ x: [-8, 22, 22] }}
                        transition={{
                            duration: 2.6,
                            times: [0, 0.55, 1],
                            repeat: Infinity,
                            ease: 'easeInOut',
                        }}
                    />
                </g>

                <circle
                    cx="14.2"
                    cy="14.2"
                    r="6.6"
                    stroke="currentColor"
                    strokeWidth="2"
                />
                <path
                    d="M10.8 11.8 A 4.4 4.4 0 0 1 13.8 10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeOpacity={0.6}
                />
                <line
                    x1="19"
                    y1="19"
                    x2="24.5"
                    y2="24.5"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                />
            </motion.g>
        </svg>
    );
}
