import { useId } from 'react';
import { motion } from 'framer-motion';

interface AnimatedHourglassProps {
    size?: number;
}

const CYCLE_DURATION = 3.2;
const EASE_IN_OUT = [0.42, 0, 0.58, 1] as const;

export function AnimatedHourglass({ size = 28 }: AnimatedHourglassProps) {
    const uid = useId().replace(/:/g, '');
    const topClipId = `hg-top-${uid}`;
    const bottomClipId = `hg-bottom-${uid}`;

    return (
        <motion.svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
            animate={{ rotate: [0, 0, 180, 180] }}
            transition={{
                duration: CYCLE_DURATION,
                times: [0, 0.74, 0.94, 1],
                repeat: Infinity,
                ease: EASE_IN_OUT,
            }}
        >
            <defs>
                <clipPath id={topClipId}>
                    <path d="M10.4 5.8 H21.6 V8.6 C21.6 11.7 17.2 13.8 16.45 15.5 H15.55 C14.8 13.8 10.4 11.7 10.4 8.6 Z" />
                </clipPath>
                <clipPath id={bottomClipId}>
                    <path d="M10.4 26.2 H21.6 V23.4 C21.6 20.3 17.2 18.2 16.45 16.5 H15.55 C14.8 18.2 10.4 20.3 10.4 23.4 Z" />
                </clipPath>
            </defs>

            <path
                d="M10.4 5.8 H21.6 V8.6 C21.6 11.7 17.2 13.8 16.45 15.5 H15.55 C14.8 13.8 10.4 11.7 10.4 8.6 Z"
                fill="currentColor"
                fillOpacity={0.08}
            />
            <path
                d="M10.4 26.2 H21.6 V23.4 C21.6 20.3 17.2 18.2 16.45 16.5 H15.55 C14.8 18.2 10.4 20.3 10.4 23.4 Z"
                fill="currentColor"
                fillOpacity={0.08}
            />

            <g clipPath={`url(#${topClipId})`}>
                <motion.path
                    d="M9 7.2 Q16 8.3 23 7.2 V16 H9 Z"
                    fill="currentColor"
                    fillOpacity={0.85}
                    animate={{ y: [0, 8.8, 8.8, 8.8] }}
                    transition={{
                        duration: CYCLE_DURATION,
                        times: [0, 0.72, 0.94, 1],
                        repeat: Infinity,
                        ease: 'linear',
                    }}
                />
            </g>

            <g clipPath={`url(#${bottomClipId})`}>
                <motion.path
                    d="M9 26.5 L16 23.8 L23 26.5 V36 H9 Z"
                    fill="currentColor"
                    fillOpacity={0.85}
                    animate={{ y: [3.2, -5.2, -7.2, -7.2] }}
                    transition={{
                        duration: CYCLE_DURATION,
                        times: [0, 0.72, 0.94, 1],
                        repeat: Infinity,
                        ease: EASE_IN_OUT,
                    }}
                />
            </g>

            <motion.line
                x1="16"
                y1="15.6"
                x2="16"
                y2="25.6"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeDasharray="1.8 2.2"
                animate={{
                    strokeDashoffset: [0, -18],
                    opacity: [0.95, 0.95, 0, 0],
                }}
                transition={{
                    strokeDashoffset: {
                        duration: 0.7,
                        repeat: Infinity,
                        ease: 'linear',
                    },
                    opacity: {
                        duration: CYCLE_DURATION,
                        times: [0, 0.68, 0.74, 1],
                        repeat: Infinity,
                    },
                }}
            />

            <path
                d="M9.6 5.2 V8.6 C9.6 12.1 14.7 14.3 15.25 16 C14.7 17.7 9.6 19.9 9.6 23.4 V26.8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M22.4 5.2 V8.6 C22.4 12.1 17.3 14.3 16.75 16 C17.3 17.7 22.4 19.9 22.4 23.4 V26.8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <line
                x1="7.5"
                y1="4.6"
                x2="24.5"
                y2="4.6"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
            />
            <line
                x1="7.5"
                y1="27.4"
                x2="24.5"
                y2="27.4"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
            />
        </motion.svg>
    );
}
