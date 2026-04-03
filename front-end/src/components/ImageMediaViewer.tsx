import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';

interface ImageMediaViewerProps {
    imageUrl: string;
    onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export function ImageMediaViewer({ imageUrl, onClose }: ImageMediaViewerProps) {
    const [scale, setScale] = useState(1);
    const pinchDistanceRef = useRef<number | null>(null);
    const pinchStartScaleRef = useRef(1);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const clampScale = (next: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    const zoomIn = () => setScale((prev) => clampScale(prev + 0.25));
    const zoomOut = () => setScale((prev) => clampScale(prev - 0.25));

    return (
        <div className="image-media-viewer" onClick={onClose} role="dialog" aria-modal="true">
            <header className="image-media-viewer__header" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="image-media-viewer__btn" onClick={zoomOut} aria-label="Zoom out">
                    <Minus size={18} />
                </button>
                <button type="button" className="image-media-viewer__btn" onClick={zoomIn} aria-label="Zoom in">
                    <Plus size={18} />
                </button>
                <button type="button" className="image-media-viewer__btn image-media-viewer__btn--close" onClick={onClose} aria-label="Close">
                    <X size={18} />
                </button>
            </header>

            <div
                className="image-media-viewer__stage"
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => {
                    if (e.touches.length !== 2) return;
                    const [t1, t2] = Array.from(e.touches);
                    pinchDistanceRef.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                    pinchStartScaleRef.current = scale;
                }}
                onTouchMove={(e) => {
                    if (e.touches.length !== 2 || pinchDistanceRef.current == null) return;
                    e.preventDefault();
                    const [t1, t2] = Array.from(e.touches);
                    const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                    const ratio = distance / pinchDistanceRef.current;
                    setScale(clampScale(pinchStartScaleRef.current * ratio));
                }}
                onTouchEnd={() => {
                    if (pinchDistanceRef.current == null) return;
                    pinchDistanceRef.current = null;
                    pinchStartScaleRef.current = scale;
                }}
            >
                <img
                    src={imageUrl}
                    alt="media viewer"
                    className="image-media-viewer__image"
                    style={{ transform: `scale(${scale})` }}
                    draggable={false}
                />
            </div>
        </div>
    );
}
