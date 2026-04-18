import { useEffect, useRef, useState } from 'react';
import { Download, Minus, Plus, X } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import type { FileMetadata } from '../types';
import { decryptAvatarBytesClientSide, decryptFileBytesClientSide } from '../utils/e2ee';

interface ImageMediaViewerProps {
    imageUrl: string;
    onClose: () => void;
    downloadFile?: Pick<FileMetadata, 'fileId' | 'fileName'> | null;
    token?: string;
    decryptScope?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const TOGGLE_ZOOM_SCALE = 2;

export function ImageMediaViewer({ imageUrl, onClose, downloadFile, token = '', decryptScope = '' }: ImageMediaViewerProps) {
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
    const applyScaleAtPoint = (next: number, clientX: number, clientY: number) => {
        const stageEl = stageRef.current;
        const clampedScale = clampScale(next);
        if (!stageEl) {
            setScale(clampedScale);
            return;
        }
        const stageRect = stageEl.getBoundingClientRect();
        const pointX = clientX - (stageRect.left + stageRect.width / 2);
        const pointY = clientY - (stageRect.top + stageRect.height / 2);
        const ratio = clampedScale / scale;
        const nextOffset = clampOffset(
            pointX - (pointX - offset.x) * ratio,
            pointY - (pointY - offset.y) * ratio,
            clampedScale,
        );
        setScale(clampedScale);
        setOffset(nextOffset);
    };
    const zoomIn = () => applyScale(scale + 0.25);
    const zoomOut = () => applyScale(scale - 0.25);
    const toggleZoomAtPoint = (clientX: number, clientY: number) => {
        const nextScale = scale > MIN_SCALE ? MIN_SCALE : TOGGLE_ZOOM_SCALE;
        applyScaleAtPoint(nextScale, clientX, clientY);
    };
    const downloadImage = async () => {
        try {
            const response = downloadFile?.fileId
                ? await fetch(`${API_BASE_URL}/files/${downloadFile.fileId}`, {
                    credentials: 'omit',
                    headers: { Authorization: `Bearer ${token}` },
                })
                : await fetch(imageUrl);
            if (!response.ok) throw new Error('Download failed');
            let blob: Blob;
            if (downloadFile?.fileId && token && decryptScope) {
                const encryptedBytes = new Uint8Array(await response.arrayBuffer());
                let plainBytes = await decryptFileBytesClientSide(encryptedBytes, token, decryptScope);
                if (plainBytes === encryptedBytes) {
                    plainBytes = await decryptAvatarBytesClientSide(encryptedBytes, token);
                }
                blob = new Blob([new Uint8Array(plainBytes)], { type: response.headers.get('content-type') || 'application/octet-stream' });
            } else {
                blob = await response.blob();
            }
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
                    const midX = (t1.clientX + t2.clientX) / 2;
                    const midY = (t1.clientY + t2.clientY) / 2;
                    applyScaleAtPoint(pinchStartScaleRef.current * ratio, midX, midY);
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
                    onDoubleClick={(e) => toggleZoomAtPoint(e.clientX, e.clientY)}
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
