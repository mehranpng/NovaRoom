export function updateSearchPillsFade(el: HTMLElement) {
    const maxScroll = el.scrollWidth - el.clientWidth;
    const scrolled = Math.abs(el.scrollLeft);
    const atStart = scrolled <= 1;
    const atEnd = maxScroll <= 1 || scrolled >= maxScroll - 1;
    const mask = atStart && atEnd
        ? 'none'
        : atStart
            ? 'linear-gradient(to right, transparent 0, #000 14px, #000 100%)'
            : atEnd
                ? 'linear-gradient(to right, #000 0, #000 calc(100% - 14px), transparent 100%)'
                : 'linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)';
    el.style.setProperty('mask-image', mask);
    el.style.setProperty('-webkit-mask-image', mask);
}
