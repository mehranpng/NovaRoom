export function isElementScrolled(element: HTMLElement | null, threshold = 2): boolean {
    if (!element) return false;
    return element.scrollTop > threshold;
}
