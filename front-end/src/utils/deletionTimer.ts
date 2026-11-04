export function formatDeletionRemaining(scheduledForMs: number, nowMs: number): string {
    const remaining = Math.max(0, scheduledForMs - nowMs);
    if (remaining >= 3600000) return `${Math.floor(remaining / 3600000)}H`;
    return `${Math.max(1, Math.ceil(remaining / 60000))}M`;
}

export function formatDeletionCountdown(scheduledForMs: number, nowMs: number): string {
    const totalSeconds = Math.floor(Math.max(0, scheduledForMs - nowMs) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}
