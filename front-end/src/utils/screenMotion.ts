import type { Variants } from 'framer-motion';

export const screenVariants: Variants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.24, ease: 'easeOut' } },
    exit: { opacity: 0, y: 8, transition: { duration: 0.18, ease: 'easeIn' } },
};
