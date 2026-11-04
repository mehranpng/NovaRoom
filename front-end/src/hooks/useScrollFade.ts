import { useCallback, useState } from 'react';
import type { UIEvent } from 'react';
import { isElementScrolled } from '../utils/scrollFade';

export function useScrollFade() {
    const [scrolled, setScrolled] = useState(false);
    const handleScroll = useCallback((event: UIEvent<HTMLElement>) => {
        const nextScrolled = isElementScrolled(event.currentTarget);
        setScrolled((prev) => (prev === nextScrolled ? prev : nextScrolled));
    }, []);
    return { scrolled, handleScroll };
}
