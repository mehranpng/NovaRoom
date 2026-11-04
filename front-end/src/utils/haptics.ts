export function triggerHaptic(): void {
    try { navigator.vibrate?.(10); } catch { return; }
}
