import { useEffect, useRef, useState } from 'react';
import { Download, Minus, Plus, X } from 'lucide-react';
import type { FileMetadata } from '../types';
import { getOrCacheBlob } from '../utils/mediaCache';

interface ImageMediaViewerProps {
    imageUrl: string;
    onClose: () => void;
    downloadFile?: Pick<FileMetadata, 'fileId' | 'fileName'> | null;
    token?: string;
    chatId?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const TOGGLE_ZOOM_SCALE = 2;

export function ImageMediaViewer({ imageUrl, onClose, downloadFile, token: _token = '', chatId = '' }: ImageMediaViewerProps) {
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const scaleRef = useRef(1);
    const offsetRef = useRef({ x: 0, y: 0 });
    const pinchDistanceRef = useRef<number | null>(null);
    const pinchStartScaleRef = useRef(1);
    const pinchStartOffsetRef = useRef({ x: 0, y: 0 });
    const pinchStartCenterRef = useRef({ x: 0, y: 0 });
    const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
    const hasMovedRef = useRef(false);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [controlsVisible, setControlsVisible] = useState(true);

    const updateTransform = (nextScale: number, nextOffset: { x: number; y: number }) => {
        scaleRef.current = nextScale;
        offsetRef.current = nextOffset;
        setScale(nextScale);
        setOffset(nextOffset);
    };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const clampScale = (next: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));

    const clampOffset = (nextX: number, nextY: number, nextScale = scaleRef.current) => {
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

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;

        const onTouchStart = (e: TouchEvent) => {
            if ((e.target as HTMLElement | null)?.closest('.image-media-viewer__controls')) return;

            if (e.touches.length >= 2) {
                e.preventDefault();
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                pinchDistanceRef.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                pinchStartScaleRef.current = scaleRef.current;
                pinchStartOffsetRef.current = offsetRef.current;
                pinchStartCenterRef.current = {
                    x: (t1.clientX + t2.clientX) / 2,
                    y: (t1.clientY + t2.clientY) / 2,
                };
                dragStartRef.current = null;
                hasMovedRef.current = true;
                return;
            }

            if (e.touches.length === 1) {
                hasMovedRef.current = false;
                if (scaleRef.current > 1) {
                    const t = e.touches[0];
                    dragStartRef.current = { x: t.clientX, y: t.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y };
                }
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if ((e.target as HTMLElement | null)?.closest('.image-media-viewer__controls')) return;

            if (e.touches.length >= 2 && pinchDistanceRef.current != null) {
                e.preventDefault();
                hasMovedRef.current = true;
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                if (distance <= 0) return;
                const factor = distance / pinchDistanceRef.current;
                const targetScale = clampScale(pinchStartScaleRef.current * factor);

                const stageEl = stageRef.current;
                if (!stageEl) {
                    updateTransform(targetScale, offsetRef.current);
                    return;
                }

                const stageRect = stageEl.getBoundingClientRect();
                const startCenterX = pinchStartCenterRef.current.x - (stageRect.left + stageRect.width / 2);
                const startCenterY = pinchStartCenterRef.current.y - (stageRect.top + stageRect.height / 2);
                const currentCenterX = (t1.clientX + t2.clientX) / 2 - (stageRect.left + stageRect.width / 2);
                const currentCenterY = (t1.clientY + t2.clientY) / 2 - (stageRect.top + stageRect.height / 2);

                const ratio = targetScale / (pinchStartScaleRef.current || 1);
                const nextOffsetX = startCenterX - (startCenterX - pinchStartOffsetRef.current.x) * ratio + (currentCenterX - startCenterX);
                const nextOffsetY = startCenterY - (startCenterY - pinchStartOffsetRef.current.y) * ratio + (currentCenterY - startCenterY);

                updateTransform(targetScale, clampOffset(nextOffsetX, nextOffsetY, targetScale));
                return;
            }

            if (e.touches.length === 1 && dragStartRef.current && scaleRef.current > 1) {
                e.preventDefault();
                hasMovedRef.current = true;
                const t = e.touches[0];
                const dx = t.clientX - dragStartRef.current.x;
                const dy = t.clientY - dragStartRef.current.y;
                const next = clampOffset(dragStartRef.current.offsetX + dx, dragStartRef.current.offsetY + dy, scaleRef.current);
                updateTransform(scaleRef.current, next);
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2 && pinchDistanceRef.current != null) {
                pinchDistanceRef.current = null;
                pinchStartScaleRef.current = scaleRef.current;
            }
            if (e.touches.length === 1 && scaleRef.current > 1) {
                const t = e.touches[0];
                dragStartRef.current = { x: t.clientX, y: t.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y };
            } else if (e.touches.length === 0) {
                dragStartRef.current = null;
                if (scaleRef.current <= 1) {
                    updateTransform(1, { x: 0, y: 0 });
                }
            }
        };

        const preventGesture = (e: Event) => {
            e.preventDefault();
        };

        stage.addEventListener('touchstart', onTouchStart, { passive: false });
        stage.addEventListener('touchmove', onTouchMove, { passive: false });
        stage.addEventListener('touchend', onTouchEnd);
        stage.addEventListener('touchcancel', onTouchEnd);
        document.addEventListener('gesturestart', preventGesture);
        document.addEventListener('gesturechange', preventGesture);

        return () => {
            stage.removeEventListener('touchstart', onTouchStart);
            stage.removeEventListener('touchmove', onTouchMove);
            stage.removeEventListener('touchend', onTouchEnd);
            stage.removeEventListener('touchcancel', onTouchEnd);
            document.removeEventListener('gesturestart', preventGesture);
            document.removeEventListener('gesturechange', preventGesture);
        };
    }, []);

    const zoomIn = () => {
        const nextScale = clampScale(scaleRef.current + 0.25);
        updateTransform(nextScale, clampOffset(offsetRef.current.x, offsetRef.current.y, nextScale));
    };

    const zoomOut = () => {
        const nextScale = clampScale(scaleRef.current - 0.25);
        updateTransform(nextScale, clampOffset(offsetRef.current.x, offsetRef.current.y, nextScale));
    };

    const toggleZoomAtPoint = (clientX: number, clientY: number) => {
        const stageEl = stageRef.current;
        const nextScale = scaleRef.current > MIN_SCALE ? MIN_SCALE : TOGGLE_ZOOM_SCALE;
        const clampedScale = clampScale(nextScale);
        if (!stageEl) {
            updateTransform(clampedScale, offsetRef.current);
            return;
        }
        const stageRect = stageEl.getBoundingClientRect();
        const pointX = clientX - (stageRect.left + stageRect.width / 2);
        const pointY = clientY - (stageRect.top + stageRect.height / 2);
        const ratio = clampedScale / (scaleRef.current || 1);
        const nextOffset = clampOffset(
            pointX - (pointX - offsetRef.current.x) * ratio,
            pointY - (pointY - offsetRef.current.y) * ratio,
            clampedScale,
        );
        updateTransform(clampedScale, nextOffset);
    };

    const downloadImage = async () => {
        try {
            const fileId = downloadFile?.fileId;
            const blob = fileId
                ? await getOrCacheBlob({
                    cacheKey: `chat:${chatId}:file:${fileId}`,
                    loadBlob: async () => {
                        const directResponse = await fetch(imageUrl);
                        if (!directResponse.ok) throw new Error('Download failed');
                        return directResponse.blob();
                    },
                })
                : await (await fetch(imageUrl)).blob();
            const extension = blob.type.split('/')[1] || 'jpg';
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = downloadFile?.fileName || `image.${extension}`;
            document.body.appendChild(link);
            link.click();
            window.URL.revokeObjectURL(url);
            link.remove();
        } catch (error) {
            console.error('Error downloading image:', error);
            alert('خطا در دانلود تصویر');
        }
    };

    return (
        <div className="image-media-viewer" onClick={onClose} role="dialog" aria-modal="true">
            <div
                ref={stageRef}
                className="image-media-viewer__stage"
                onClick={(e) => {
                    e.stopPropagation();
                    if (hasMovedRef.current) {
                        hasMovedRef.current = false;
                        return;
                    }
                    setControlsVisible((prev) => !prev);
                }}
                onMouseMove={(e) => {
                    if (!dragStartRef.current || scaleRef.current <= 1) return;
                    const dx = e.clientX - dragStartRef.current.x;
                    const dy = e.clientY - dragStartRef.current.y;
                    const next = clampOffset(dragStartRef.current.offsetX + dx, dragStartRef.current.offsetY + dy, scaleRef.current);
                    updateTransform(scaleRef.current, next);
                }}
                onMouseUp={() => {
                    dragStartRef.current = null;
                }}
                onMouseLeave={() => {
                    dragStartRef.current = null;
                }}
            >
                <div
                    className={`image-media-viewer__controls ${controlsVisible ? '' : 'image-media-viewer__controls--hidden'}`.trim()}
                    onClick={(e) => e.stopPropagation()}
                >
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
                    onDoubleClick={(e) => toggleZoomAtPoint(e.clientX, e.clientY)}
                    onMouseDown={(e) => {
                        if (scaleRef.current <= 1) return;
                        dragStartRef.current = { x: e.clientX, y: e.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y };
                    }}
                    style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                    draggable={false}
                />
            </div>
        </div>
    );
}
