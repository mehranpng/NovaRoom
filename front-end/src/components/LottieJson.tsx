import { useEffect, useRef } from 'react';

declare global {
    interface Window {
        bodymovin?: {
            loadAnimation: (config: Record<string, any>) => { destroy: () => void };
        };
    }
}

interface LottieJsonProps {
    path: string;
    loop?: boolean;
    autoplay?: boolean;
    className?: string;
}

export function LottieJson({ path, loop = true, autoplay = true, className }: LottieJsonProps) {
    const ref = useRef<HTMLSpanElement | null>(null);

    useEffect(() => {
        if (!ref.current || !window.bodymovin) return;
        const anim = window.bodymovin.loadAnimation({
            container: ref.current,
            renderer: 'svg',
            loop,
            autoplay,
            path,
        });

        return () => anim.destroy();
    }, [autoplay, loop, path]);

    return <span className={className} ref={ref} />;
}
