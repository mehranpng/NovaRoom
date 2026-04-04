import { useEffect, useRef, useState } from 'react';
import { Download, Minus, Plus, X } from 'lucide-react';

interface ImageMediaViewerProps {
    imageUrl: string;
    onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const TOGGLE_ZOOM_SCALE = 2.5;

export function ImageMediaViewer({ imageUrl, onClose }: ImageMediaViewerProps) {
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const pinchDistanceRef = useRef<number | null>(null);
    const pinchStartScaleRef = useRef(1);
    const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const clampScale = (next: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    const clampOffset = (nextX: number, nextY: number, nextScale = scale) => {
        const stageEl = stageRef.current;
        const imageEl = imageRef.current;
        if (!stageEl || !imageEl) return { x: nextX, y: nextY };
        const stageRect = stageEl.getBoundingClientRect();
        const baseWidth = imageEl.clientWidth;
        const baseHeight = imageEl.clientHeight;
        const maxX = Math.max(0, ((baseWidth * nextScale) - stageRect.width) / 2);
        const maxY = Math.max(0, ((baseHeight * nextScale) - stageRect.height) / 2);
        return {
            x: Math.min(maxX, Math.max(-maxX, nextX)),
            y: Math.min(maxY, Math.max(-maxY, nextY)),
        };
    };
    const applyScale = (next: number) => {
        const clampedScale = clampScale(next);
        setScale(clampedScale);
        setOffset((prev) => clampOffset(prev.x, prev.y, clampedScale));
    };
    const zoomIn = () => applyScale(scale + 0.25);
    const zoomOut = () => applyScale(scale - 0.25);
    const toggleZoom = () => applyScale(scale > MIN_SCALE ? MIN_SCALE : TOGGLE_ZOOM_SCALE);
    const downloadImage = () => {
        const link = document.createElement('a');
        link.href = imageUrl;
        link.download = 'image';
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    return (
        <div className="image-media-viewer" onClick={onClose} role="dialog" aria-modal="true">
            <div
                ref={stageRef}
                className="image-media-viewer__stage"
                onClick={(e) => e.stopPropagation()}
                onMouseMove={(e) => {
                    if (!dragStartRef.current || scale <= 1) return;
                    const dx = e.clientX - dragStartRef.current.x;
                    const dy = e.clientY - dragStartRef.current.y;
                    const next = clampOffset(dragStartRef.current.offsetX + dx, dragStartRef.current.offsetY + dy);
                    setOffset(next);
                }}
                onMouseUp={() => {
                    dragStartRef.current = null;
                }}
                onMouseLeave={() => {
                    dragStartRef.current = null;
                }}
                onTouchStart={(e) => {
                    if (e.touches.length === 2) {
                        const [t1, t2] = Array.from(e.touches);
                        pinchDistanceRef.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                        pinchStartScaleRef.current = scale;
                        dragStartRef.current = null;
                        return;
                    }
                    if (e.touches.length === 1 && scale > 1) {
                        const [t] = Array.from(e.touches);
                        dragStartRef.current = { x: t.clientX, y: t.clientY, offsetX: offset.x, offsetY: offset.y };
                    }
                }}
                onTouchMove={(e) => {
                    if (e.touches.length !== 2 || pinchDistanceRef.current == null) return;
                    e.preventDefault();
                    const [t1, t2] = Array.from(e.touches);
                    const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                    const ratio = distance / pinchDistanceRef.current;
                    applyScale(pinchStartScaleRef.current * ratio);
                }}
                onTouchMoveCapture={(e) => {
                    if (e.touches.length !== 1 || !dragStartRef.current || scale <= 1) return;
                    e.preventDefault();
                    const [t] = Array.from(e.touches);
                    const dx = t.clientX - dragStartRef.current.x;
                    const dy = t.clientY - dragStartRef.current.y;
                    const next = clampOffset(dragStartRef.current.offsetX + dx, dragStartRef.current.offsetY + dy);
                    setOffset(next);
                }}
                onTouchEnd={() => {
                    if (pinchDistanceRef.current != null) {
                        pinchDistanceRef.current = null;
                        pinchStartScaleRef.current = scale;
                    }
                    if (scale <= 1) setOffset({ x: 0, y: 0 });
                    dragStartRef.current = null;
                }}
            >
                <div className="image-media-viewer__controls" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="image-media-viewer__btn" onClick={downloadImage} aria-label="Download image">
                        <Download size={18} />
                    </button>
                    <button type="button" className="image-media-viewer__btn" onClick={zoomOut} aria-label="Zoom out">
                        <Minus size={18} />
                    </button>
                    <button type="button" className="image-media-viewer__btn" onClick={zoomIn} aria-label="Zoom in">
                        <Plus size={18} />
                    </button>
                    <button type="button" className="image-media-viewer__btn image-media-viewer__btn--close" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </div>
                <img
                    ref={imageRef}
                    src={imageUrl}
                    alt="media viewer"
                    className="image-media-viewer__image"
                    onClick={toggleZoom}
                    onMouseDown={(e) => {
                        if (scale <= 1) return;
                        dragStartRef.current = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
                    }}
                    style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                    draggable={false}
                />
            </div>
        </div>
    );
}
