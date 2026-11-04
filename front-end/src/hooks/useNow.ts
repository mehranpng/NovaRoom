import { useEffect, useState } from 'react';

export function useNow(active: boolean, intervalMs = 30000) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!active) return;
        const refresh = () => setNow(Date.now());
        const kickoff = window.setTimeout(refresh, 0);
        const timer = window.setInterval(refresh, intervalMs);
        return () => {
            window.clearTimeout(kickoff);
            window.clearInterval(timer);
        };
    }, [active, intervalMs]);

    return now;
}
