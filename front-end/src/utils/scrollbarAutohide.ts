const SCROLLING_CLASS = 'is-scrolling';
const HIDE_DELAY_MS = 900;

const hideTimers = new WeakMap<Element, number>();

function revealScrollbar(element: Element) {
    if (!element.classList.contains(SCROLLING_CLASS)) {
        element.classList.add(SCROLLING_CLASS);
    }
    const existing = hideTimers.get(element);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
        element.classList.remove(SCROLLING_CLASS);
        hideTimers.delete(element);
    }, HIDE_DELAY_MS);
    hideTimers.set(element, timer);
}

function handleScroll(event: Event) {
    const element = event.target;
    if (!(element instanceof Element)) return;
    revealScrollbar(element);
}

let installed = false;

export function installScrollbarAutohide() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
}
