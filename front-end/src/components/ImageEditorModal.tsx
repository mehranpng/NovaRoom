import { useEffect, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Brush, Check, Crop, X } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import './ImageEditorModal.css';

const TELEGRAM_UNDO_PATH =
    'M7.16,17.657C6.7,17.657 6.327,18.03 6.327,18.49C6.327,18.95 6.7,19.323 7.16,19.323V17.657ZM6,7.337C5.54,7.337 5.167,7.71 5.167,8.17C5.167,8.63 5.54,9.003 6,9.003V7.337ZM8.251,12.759C8.576,13.085 9.104,13.085 9.429,12.759C9.755,12.434 9.755,11.906 9.429,11.581L8.251,12.759ZM4.84,8.17L4.251,7.581C3.925,7.906 3.925,8.434 4.251,8.759L4.84,8.17ZM9.429,4.759C9.755,4.434 9.755,3.906 9.429,3.581C9.104,3.255 8.576,3.255 8.251,3.581L9.429,4.759ZM7.16,19.323H14V17.657H7.16V19.323ZM14,7.337H6V9.003H14V7.337ZM19.993,13.33C19.993,11.357 19.256,9.833 18.096,8.812C16.953,7.806 15.458,7.337 14,7.337V9.003C15.116,9.003 16.201,9.364 16.994,10.063C17.771,10.747 18.327,11.803 18.327,13.33H19.993ZM14,19.323C15.458,19.323 16.953,18.854 18.096,17.848C19.256,16.827 19.993,15.303 19.993,13.33H18.327C18.327,14.857 17.771,15.913 16.994,16.597C16.201,17.296 15.116,17.657 14,17.657V19.323ZM9.429,11.581L5.429,7.581L4.251,8.759L8.251,12.759L9.429,11.581ZM5.429,8.759L9.429,4.759L8.251,3.581L4.251,7.581L5.429,8.759Z';

function TelegramUndoIcon({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }}>
            <path d={TELEGRAM_UNDO_PATH} />
        </svg>
    );
}

function TelegramRedoIcon({ size = 20 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ display: 'block', transform: 'scaleX(-1)' }}
        >
            <path d={TELEGRAM_UNDO_PATH} />
        </svg>
    );
}

export interface ImageEditorModalProps {
    imageFile: File;
    initialStrokes?: Stroke[];
    initialCropRect?: CropRect;
    initialUndoHistory?: EditorSnapshot[];
    initialRedoHistory?: EditorSnapshot[];
    squareCrop?: boolean;
    onSend: (
        fileToSend: File,
        isEdited: boolean,
        editorState: {
            strokes: Stroke[];
            cropRect: CropRect;
            undoHistory: EditorSnapshot[];
            redoHistory: EditorSnapshot[];
        }
    ) => void;
    onCancel: () => void;
}

type Point = { x: number; y: number };
type Stroke = { points: Point[]; color: string; width: number };

type CropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
};

type EditorSnapshot = {
    strokes: Stroke[];
    cropRect: CropRect;
};

function getSquareCrop(handle: string, initialCrop: CropRect, dx: number, dy: number, nw: number, nh: number): CropRect {
    const MIN_DIM = 40;

    if (handle === 'move') {
        return {
            x: Math.round(Math.max(0, Math.min(nw - initialCrop.width, initialCrop.x + dx))),
            y: Math.round(Math.max(0, Math.min(nh - initialCrop.height, initialCrop.y + dy))),
            width: initialCrop.width,
            height: initialCrop.height,
        };
    }

    const centerX = initialCrop.x + initialCrop.width / 2;
    const centerY = initialCrop.y + initialCrop.height / 2;
    const initialSide = Math.min(initialCrop.width, initialCrop.height);

    const isRight = handle === 'right' || handle === 'tr' || handle === 'br';
    const isLeft = handle === 'left' || handle === 'tl' || handle === 'bl';
    const isBottom = handle === 'bottom' || handle === 'bl' || handle === 'br';
    const isTop = handle === 'top' || handle === 'tl' || handle === 'tr';

    const anchorLeft = isRight ? initialCrop.x : isLeft ? initialCrop.x + initialCrop.width : null;
    const anchorTop = isBottom ? initialCrop.y : isTop ? initialCrop.y + initialCrop.height : null;

    const expansionX = anchorLeft === null ? 0 : anchorLeft === initialCrop.x ? dx : -dx;
    const expansionY = anchorTop === null ? 0 : anchorTop === initialCrop.y ? dy : -dy;
    const expansion = anchorLeft !== null && anchorTop !== null
        ? Math.max(expansionX, expansionY)
        : anchorLeft !== null ? expansionX : expansionY;

    const horizontalMax = anchorLeft === null
        ? 2 * Math.min(centerX, nw - centerX)
        : anchorLeft === initialCrop.x
            ? nw - anchorLeft
            : anchorLeft;
    const verticalMax = anchorTop === null
        ? 2 * Math.min(centerY, nh - centerY)
        : anchorTop === initialCrop.y
            ? nh - anchorTop
            : anchorTop;

    const maxSide = Math.min(nw, nh, horizontalMax, verticalMax);
    const side = Math.max(MIN_DIM, Math.min(maxSide, initialSide + expansion));

    const x = anchorLeft === null
        ? centerX - side / 2
        : anchorLeft === initialCrop.x ? anchorLeft : anchorLeft - side;
    const y = anchorTop === null
        ? centerY - side / 2
        : anchorTop === initialCrop.y ? anchorTop : anchorTop - side;

    return {
        x: Math.round(Math.max(0, Math.min(nw - side, x))),
        y: Math.round(Math.max(0, Math.min(nh - side, y))),
        width: Math.round(side),
        height: Math.round(side),
    };
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    const points = stroke.points;
    if (points.length === 0) return;

    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
}

const COLOR_PALETTE = [
    { label: 'سفید', value: '#ffffff' },
    { label: 'فیروزه‌ای', value: '#06b6d4' },
    { label: 'زرد', value: '#facc15' },
    { label: 'قرمز', value: '#ef4444' },
    { label: 'سبز', value: '#22c55e' },
    { label: 'آبی', value: '#3b82f6' },
    { label: 'بنفش', value: '#a855f7' },
    { label: 'مشکی', value: '#000000' },
];

export function ImageEditorModal({
    imageFile,
    initialStrokes,
    initialCropRect,
    initialUndoHistory,
    initialRedoHistory,
    squareCrop = false,
    onSend,
    onCancel,
}: ImageEditorModalProps) {
    const [, setImageLoaded] = useState(false);
    const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
    const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

    const [activeTool, setActiveTool] = useState<'none' | 'draw' | 'crop'>(squareCrop ? 'crop' : 'none');
    const [selectedColor, setSelectedColor] = useState<string>('#ffffff');
    const [selectedThickness, setSelectedThickness] = useState<number>(10);

    const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes || []);
    const strokesRef = useRef<Stroke[]>(strokes);
    strokesRef.current = strokes;

    const [undoHistory, setUndoHistory] = useState<EditorSnapshot[]>(initialUndoHistory || []);
    const undoHistoryRef = useRef<EditorSnapshot[]>(undoHistory);
    undoHistoryRef.current = undoHistory;

    const [redoHistory, setRedoHistory] = useState<EditorSnapshot[]>(initialRedoHistory || []);
    const redoHistoryRef = useRef<EditorSnapshot[]>(redoHistory);
    redoHistoryRef.current = redoHistory;

    const currentStrokeRef = useRef<Stroke | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);

    const [cropRect, setCropRect] = useState<CropRect>(initialCropRect || { x: 0, y: 0, width: 0, height: 0 });
    const cropRectRef = useRef<CropRect>(cropRect);
    cropRectRef.current = cropRect;

    const onCancelRef = useRef(onCancel);
    onCancelRef.current = onCancel;
    const closingRef = useRef(false);

    useEffect(() => {
        if (!window.history.state?.imageEditor) {
            window.history.pushState({ ...window.history.state, imageEditor: true }, '');
        }

        const handleBack = () => {
            if (closingRef.current) return;
            onCancelRef.current();
        };

        window.addEventListener('popstate', handleBack);
        return () => window.removeEventListener('popstate', handleBack);
    }, []);

    const closeHistoryEntry = () => {
        closingRef.current = true;
        if (window.history.state?.imageEditor) {
            window.history.back();
        }
    };

    const closeEditor = useCallback(() => {
        closingRef.current = true;
        if (window.history.state?.imageEditor) {
            window.history.back();
        }
        onCancelRef.current();
    }, []);
    const isCropped =
        imgNaturalSize.width > 0 &&
        (Math.round(cropRect.x) > 0 ||
            Math.round(cropRect.y) > 0 ||
            Math.round(cropRect.width) < imgNaturalSize.width - 2 ||
            Math.round(cropRect.height) < imgNaturalSize.height - 2);

    const cropDragRef = useRef<{
        handle: string;
        startX: number;
        startY: number;
        initialCrop: CropRect;
    } | null>(null);

    const [canvasDisplaySize, setCanvasDisplaySize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
    const initialCropRef = useRef(initialCropRect);

    useEffect(() => {
        let isMounted = true;
        const objectUrl = URL.createObjectURL(imageFile);
        const img = new Image();

        img.onload = () => {
            if (!isMounted) return;
            let nw = img.naturalWidth || img.width;
            let nh = img.naturalHeight || img.height;

            if (!nw || !nh) {
                nw = 1200;
                nh = 800;
            }

            const MAX_DIM = 2048;
            let targetW = nw;
            let targetH = nh;
            if (nw > MAX_DIM || nh > MAX_DIM) {
                const ratio = Math.min(MAX_DIM / nw, MAX_DIM / nh);
                targetW = Math.round(nw * ratio);
                targetH = Math.round(nh * ratio);
            }

            setImgElement(img);
            setImgNaturalSize({ width: targetW, height: targetH });

            const savedCrop = initialCropRef.current;
            const cropFits = Boolean(
                savedCrop
                && (!savedCrop.naturalWidth || (savedCrop.naturalWidth === targetW && savedCrop.naturalHeight === targetH))
                && savedCrop.width > 0
                && savedCrop.height > 0
                && savedCrop.x >= 0
                && savedCrop.y >= 0
                && savedCrop.x + savedCrop.width <= targetW
                && savedCrop.y + savedCrop.height <= targetH
            );
            const centeredSquareSide = Math.min(targetW, targetH);
            setCropRect(
                cropFits && savedCrop
                    ? { x: savedCrop.x, y: savedCrop.y, width: savedCrop.width, height: savedCrop.height }
                    : squareCrop
                        ? {
                            x: Math.round((targetW - centeredSquareSide) / 2),
                            y: Math.round((targetH - centeredSquareSide) / 2),
                            width: centeredSquareSide,
                            height: centeredSquareSide,
                        }
                        : { x: 0, y: 0, width: targetW, height: targetH }
            );
            setImageLoaded(true);
        };

        img.onerror = () => {
            console.error('Error loading image in ImageEditorModal');
        };

        img.src = objectUrl;

        return () => {
            isMounted = false;
            URL.revokeObjectURL(objectUrl);
        };
    }, [imageFile, squareCrop]);

    const getRenderRegion = useCallback((): CropRect => {
        const cropApplied = isCropped && activeTool !== 'crop' && cropRect.width > 0 && cropRect.height > 0;
        return cropApplied
            ? { x: cropRect.x, y: cropRect.y, width: cropRect.width, height: cropRect.height }
            : { x: 0, y: 0, width: imgNaturalSize.width, height: imgNaturalSize.height };
    }, [isCropped, activeTool, cropRect, imgNaturalSize]);

    const applyRegionTransform = useCallback((ctx: CanvasRenderingContext2D) => {
        const region = getRenderRegion();
        ctx.beginPath();
        ctx.rect(region.x, region.y, region.width, region.height);
        ctx.clip();
        ctx.translate(-region.x, -region.y);
    }, [getRenderRegion]);

    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !imgElement) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const region = getRenderRegion();
        const w = Math.round(region.width);
        const h = Math.round(region.height);
        if (w <= 0 || h <= 0) return;

        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }

        ctx.clearRect(0, 0, w, h);
        const naturalW = imgElement.naturalWidth || imgElement.width || w;
        const naturalH = imgElement.naturalHeight || imgElement.height || h;
        const sourceScaleX = naturalW / (imgNaturalSize.width || naturalW);
        const sourceScaleY = naturalH / (imgNaturalSize.height || naturalH);
        ctx.drawImage(
            imgElement,
            region.x * sourceScaleX,
            region.y * sourceScaleY,
            region.width * sourceScaleX,
            region.height * sourceScaleY,
            0,
            0,
            w,
            h,
        );

        ctx.save();
        applyRegionTransform(ctx);

        const activeStroke = currentStrokeRef.current;
        const strokesToDraw = activeStroke ? [...strokesRef.current, activeStroke] : strokesRef.current;

        for (const stroke of strokesToDraw) {
            drawStroke(ctx, stroke);
        }

        ctx.restore();

        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            setCanvasDisplaySize((prev) =>
                Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
                    ? prev
                    : { width: rect.width, height: rect.height }
            );
        }
    }, [imgElement, imgNaturalSize, getRenderRegion, applyRegionTransform]);

    const rafRef = useRef<number | null>(null);
    const scheduleRedraw = useCallback(() => {
        if (rafRef.current != null) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            redrawCanvas();
        });
    }, [redrawCanvas]);

    useEffect(() => {
        return () => {
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    useEffect(() => {
        if (!imgElement) return;
        redrawCanvas();
    }, [imgElement, redrawCanvas]);

    useEffect(() => {
        const onResize = () => {
            if (canvasRef.current) {
                const rect = canvasRef.current.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    setCanvasDisplaySize({ width: rect.width, height: rect.height });
                }
            }
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const getCanvasCoordinatesFromClient = useCallback(
        (clientX: number, clientY: number): Point | null => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;

            const region = getRenderRegion();
            const scaleX = region.width / rect.width;
            const scaleY = region.height / rect.height;

            const x = region.x + (clientX - rect.left) * scaleX;
            const y = region.y + (clientY - rect.top) * scaleY;

            return { x, y };
        },
        [getRenderRegion]
    );

    const recordSnapshot = (snapshot: EditorSnapshot) => {
        setUndoHistory((prev) => [...prev, snapshot]);
        redoHistoryRef.current = [];
        setRedoHistory([]);
    };

    const handleDrawingPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        if (activeTool !== 'draw' || currentStrokeRef.current) return;
        e.preventDefault();
        e.stopPropagation();

        const pt = getCanvasCoordinatesFromClient(e.clientX, e.clientY);
        if (!pt) return;

        const pointerId = e.pointerId;
        const strokeWidth = selectedThickness * (imgNaturalSize.width / 1000 || 1);
        currentStrokeRef.current = {
            points: [pt],
            color: selectedColor,
            width: strokeWidth,
        };

        scheduleRedraw();

        const onPointerMove = (ev: PointerEvent) => {
            if (ev.pointerId !== pointerId) return;
            ev.preventDefault();
            const stroke = currentStrokeRef.current;
            if (!stroke) return;

            const events = ev.getCoalescedEvents?.() ?? [ev];
            let changed = false;
            for (const coalesced of events) {
                const movePt = getCanvasCoordinatesFromClient(coalesced.clientX, coalesced.clientY);
                if (!movePt) continue;

                const lastPt = stroke.points[stroke.points.length - 1];
                if (lastPt) {
                    const dx = movePt.x - lastPt.x;
                    const dy = movePt.y - lastPt.y;
                    if (dx * dx + dy * dy < 2.25) continue;
                }
                stroke.points.push(movePt);
                changed = true;
            }

            if (changed) scheduleRedraw();
        };

        const onPointerEnd = (ev: PointerEvent) => {
            if (ev.pointerId !== pointerId) return;
            ev.preventDefault();
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerEnd);
            window.removeEventListener('pointercancel', onPointerEnd);

            const finished = currentStrokeRef.current;
            currentStrokeRef.current = null;
            if (finished && finished.points.length > 0) {
                recordSnapshot({ strokes: strokesRef.current, cropRect: cropRectRef.current });
                const updated = [...strokesRef.current, finished];
                strokesRef.current = updated;
                setStrokes(updated);
            }
            redrawCanvas();
        };

        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerEnd, { passive: false });
        window.addEventListener('pointercancel', onPointerEnd, { passive: false });
    };

    const handleUndo = useCallback(() => {
        const history = undoHistoryRef.current;
        if (history.length === 0) return;
        triggerHaptic();
        const previous = history[history.length - 1];
        const remaining = history.slice(0, -1);
        undoHistoryRef.current = remaining;
        setUndoHistory(remaining);
        const currentSnapshot = { strokes: strokesRef.current, cropRect: cropRectRef.current };
        const redo = [...redoHistoryRef.current, currentSnapshot];
        redoHistoryRef.current = redo;
        setRedoHistory(redo);
        strokesRef.current = previous.strokes;
        setStrokes(previous.strokes);
        setCropRect(previous.cropRect);
        redrawCanvas();
    }, [redrawCanvas]);

    const handleRedo = useCallback(() => {
        const history = redoHistoryRef.current;
        if (history.length === 0) return;
        triggerHaptic();
        const next = history[history.length - 1];
        const remaining = history.slice(0, -1);
        redoHistoryRef.current = remaining;
        setRedoHistory(remaining);
        const currentSnapshot = { strokes: strokesRef.current, cropRect: cropRectRef.current };
        const undo = [...undoHistoryRef.current, currentSnapshot];
        undoHistoryRef.current = undo;
        setUndoHistory(undo);
        strokesRef.current = next.strokes;
        setStrokes(next.strokes);
        setCropRect(next.cropRect);
        redrawCanvas();
    }, [redrawCanvas]);

    const handleCropPointerDown = (handle: string, e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        triggerHaptic();

        cropDragRef.current = {
            handle,
            startX: e.clientX,
            startY: e.clientY,
            initialCrop: { ...cropRect },
        };

        let latestCrop: CropRect = { ...cropRect };

        const onPointerMove = (ev: PointerEvent) => {
            ev.preventDefault();
            if (!cropDragRef.current || !canvasRef.current) return;
            const { handle: dragHandle, startX, startY, initialCrop } = cropDragRef.current;

            const rect = canvasRef.current.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const scaleX = imgNaturalSize.width / rect.width;
            const scaleY = imgNaturalSize.height / rect.height;

            const dx = (ev.clientX - startX) * scaleX;
            const dy = (ev.clientY - startY) * scaleY;

            const MIN_DIM = 40;
            const nw = imgNaturalSize.width;
            const nh = imgNaturalSize.height;

            if (squareCrop) {
                latestCrop = getSquareCrop(dragHandle, initialCrop, dx, dy, nw, nh);
                setCropRect(latestCrop);
                return;
            }

            let newX = initialCrop.x;
            let newY = initialCrop.y;
            let newW = initialCrop.width;
            let newH = initialCrop.height;

            if (dragHandle === 'move') {
                newX = Math.max(0, Math.min(nw - newW, initialCrop.x + dx));
                newY = Math.max(0, Math.min(nh - newH, initialCrop.y + dy));
            }

            if (dragHandle === 'top' || dragHandle === 'tl' || dragHandle === 'tr') {
                const bottomEdge = initialCrop.y + initialCrop.height;
                newY = Math.max(0, Math.min(bottomEdge - MIN_DIM, initialCrop.y + dy));
                newH = bottomEdge - newY;
            }

            if (dragHandle === 'bottom' || dragHandle === 'bl' || dragHandle === 'br') {
                newH = Math.max(MIN_DIM, Math.min(nh - newY, initialCrop.height + dy));
            }

            if (dragHandle === 'left' || dragHandle === 'tl' || dragHandle === 'bl') {
                const rightEdge = initialCrop.x + initialCrop.width;
                newX = Math.max(0, Math.min(rightEdge - MIN_DIM, initialCrop.x + dx));
                newW = rightEdge - newX;
            }

            if (dragHandle === 'right' || dragHandle === 'tr' || dragHandle === 'br') {
                newW = Math.max(MIN_DIM, Math.min(nw - newX, initialCrop.width + dx));
            }

            latestCrop = {
                x: Math.round(newX),
                y: Math.round(newY),
                width: Math.round(newW),
                height: Math.round(newH),
            };
            setCropRect(latestCrop);
        };

        const onPointerUp = (ev: PointerEvent) => {
            ev.preventDefault();
            const drag = cropDragRef.current;
            cropDragRef.current = null;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);

            if (
                drag
                && (latestCrop.x !== drag.initialCrop.x
                    || latestCrop.y !== drag.initialCrop.y
                    || latestCrop.width !== drag.initialCrop.width
                    || latestCrop.height !== drag.initialCrop.height)
            ) {
                recordSnapshot({ strokes: strokesRef.current, cropRect: drag.initialCrop });
            }
        };

        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp, { passive: false });
        window.addEventListener('pointercancel', onPointerUp, { passive: false });
    };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeEditor();
                return;
            }

            const isCtrlOrMeta = e.ctrlKey || e.metaKey;
            if (!isCtrlOrMeta) return;

            const isZ =
                e.code === 'KeyZ' ||
                e.key === 'z' ||
                e.key === 'Z' ||
                e.key === 'ظ';

            const isY =
                e.code === 'KeyY' ||
                e.key === 'y' ||
                e.key === 'Y' ||
                e.key === 'غ';

            if (e.shiftKey && isZ) {
                e.preventDefault();
                e.stopPropagation();
                handleRedo();
            } else if (!e.shiftKey && isY) {
                e.preventDefault();
                e.stopPropagation();
                handleRedo();
            } else if (!e.shiftKey && isZ) {
                e.preventDefault();
                e.stopPropagation();
                handleUndo();
            }
        };

        window.addEventListener('keydown', onKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
    }, [handleUndo, handleRedo, closeEditor]);

    const handleSend = async () => {
        triggerHaptic();

        const hasDrawn = strokes.length > 0;
        const isEdited = hasDrawn || isCropped;

        const currentEditorState = {
            strokes,
            cropRect: {
                ...cropRect,
                naturalWidth: imgNaturalSize.width,
                naturalHeight: imgNaturalSize.height,
            },
            undoHistory,
            redoHistory,
        };

        if (!isEdited) {
            closeHistoryEntry();
            onSend(imageFile, false, currentEditorState);
            return;
        }

        const canvas = canvasRef.current;

        if (!imgElement || !canvas) {
            closeHistoryEntry();
            onSend(imageFile, isEdited, currentEditorState);
            return;
        }

        const cropRendered = isCropped && activeTool !== 'crop';
        const hasCropRegion = isCropped && cropRect.width > 0 && cropRect.height > 0;

        const targetW = cropRendered || !hasCropRegion ? canvas.width : Math.round(cropRect.width);
        const targetH = cropRendered || !hasCropRegion ? canvas.height : Math.round(cropRect.height);
        const sourceX = cropRendered || !hasCropRegion ? 0 : Math.round(cropRect.x);
        const sourceY = cropRendered || !hasCropRegion ? 0 : Math.round(cropRect.y);

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = targetW;
        exportCanvas.height = targetH;

        const ctx = exportCanvas.getContext('2d');
        if (!ctx) {
            closeHistoryEntry();
            onSend(imageFile, isEdited, currentEditorState);
            return;
        }

        ctx.drawImage(canvas, sourceX, sourceY, targetW, targetH, 0, 0, targetW, targetH);

        exportCanvas.toBlob(
            (blob) => {
                if (!blob) {
                    closeHistoryEntry();
                    onSend(imageFile, isEdited, currentEditorState);
                    return;
                }
                const cleanName = imageFile.name.replace(/\.[^/.]+$/, '') + '.jpg';
                const finalFile = new File([blob], cleanName, {
                    type: 'image/jpeg',
                    lastModified: Date.now(),
                });
                closeHistoryEntry();
                onSend(finalFile, true, currentEditorState);
            },
            'image/jpeg',
            0.92,
        );
    };

    const scaleToDisplayX = canvasDisplaySize.width / (imgNaturalSize.width || 1);
    const scaleToDisplayY = canvasDisplaySize.height / (imgNaturalSize.height || 1);

    const screenCrop = {
        left: cropRect.x * scaleToDisplayX,
        top: cropRect.y * scaleToDisplayY,
        width: cropRect.width * scaleToDisplayX,
        height: cropRect.height * scaleToDisplayY,
    };

    const modalContent = (
        <div className="image-editor-overlay" role="dialog" aria-modal="true">
            <button
                type="button"
                className="image-editor-close-btn"
                onClick={closeEditor}
                title="بستن (Esc)"
                aria-label="Close image preview"
            >
                <X size={20} />
            </button>

            <div className="image-editor-body">
                <div className="image-editor-canvas-stage" ref={stageRef}>
                    <canvas
                        ref={canvasRef}
                        className={`image-editor-canvas ${activeTool === 'draw' ? 'image-editor-canvas--drawable' : ''}`}
                        onPointerDown={handleDrawingPointerDown}
                    />

                    {activeTool === 'crop' && canvasDisplaySize.width > 0 && (
                        <div className="image-editor-crop-overlay" style={{ pointerEvents: 'auto' }}>
                            <div
                                className="image-editor-crop-shade"
                                style={{
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    height: `${screenCrop.top}px`,
                                    pointerEvents: 'auto',
                                }}
                            />
                            <div
                                className="image-editor-crop-shade"
                                style={{
                                    top: `${screenCrop.top + screenCrop.height}px`,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    pointerEvents: 'auto',
                                }}
                            />
                            <div
                                className="image-editor-crop-shade"
                                style={{
                                    top: `${screenCrop.top}px`,
                                    height: `${screenCrop.height}px`,
                                    left: 0,
                                    width: `${screenCrop.left}px`,
                                    pointerEvents: 'auto',
                                }}
                            />
                            <div
                                className="image-editor-crop-shade"
                                style={{
                                    top: `${screenCrop.top}px`,
                                    height: `${screenCrop.height}px`,
                                    left: `${screenCrop.left + screenCrop.width}px`,
                                    right: 0,
                                    pointerEvents: 'auto',
                                }}
                            />

                            <div
                                className="image-editor-crop-box"
                                style={{
                                    left: `${screenCrop.left}px`,
                                    top: `${screenCrop.top}px`,
                                    width: `${screenCrop.width}px`,
                                    height: `${screenCrop.height}px`,
                                }}
                                onPointerDown={(e) => handleCropPointerDown('move', e)}
                            >
                                <div className="image-editor-crop-grid-h1" />
                                <div className="image-editor-crop-grid-h2" />
                                <div className="image-editor-crop-grid-v1" />
                                <div className="image-editor-crop-grid-v2" />

                                <div
                                    className="image-editor-crop-edge image-editor-crop-edge--top"
                                    onPointerDown={(e) => handleCropPointerDown('top', e)}
                                >
                                    <div className="image-editor-crop-edge-bar-h" />
                                </div>
                                <div
                                    className="image-editor-crop-edge image-editor-crop-edge--bottom"
                                    onPointerDown={(e) => handleCropPointerDown('bottom', e)}
                                >
                                    <div className="image-editor-crop-edge-bar-h" />
                                </div>
                                <div
                                    className="image-editor-crop-edge image-editor-crop-edge--left"
                                    onPointerDown={(e) => handleCropPointerDown('left', e)}
                                >
                                    <div className="image-editor-crop-edge-bar-v" />
                                </div>
                                <div
                                    className="image-editor-crop-edge image-editor-crop-edge--right"
                                    onPointerDown={(e) => handleCropPointerDown('right', e)}
                                >
                                    <div className="image-editor-crop-edge-bar-v" />
                                </div>

                                <div
                                    className="image-editor-crop-corner image-editor-crop-corner--tl"
                                    onPointerDown={(e) => handleCropPointerDown('tl', e)}
                                />
                                <div
                                    className="image-editor-crop-corner image-editor-crop-corner--tr"
                                    onPointerDown={(e) => handleCropPointerDown('tr', e)}
                                />
                                <div
                                    className="image-editor-crop-corner image-editor-crop-corner--bl"
                                    onPointerDown={(e) => handleCropPointerDown('bl', e)}
                                />
                                <div
                                    className="image-editor-crop-corner image-editor-crop-corner--br"
                                    onPointerDown={(e) => handleCropPointerDown('br', e)}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="image-editor-bottom-bar" onPointerDown={(e) => e.stopPropagation()}>
                {activeTool === 'draw' && (
                    <div className="image-editor-sub-dock">
                        <div className="image-editor-colors">
                            {COLOR_PALETTE.map((c) => (
                                <div
                                    key={c.value}
                                    className={`image-editor-color-circle ${selectedColor === c.value ? 'image-editor-color-circle--selected' : ''}`}
                                    style={{ backgroundColor: c.value }}
                                    onClick={() => {
                                        triggerHaptic();
                                        setSelectedColor(c.value);
                                    }}
                                    title={c.label}
                                />
                            ))}
                        </div>

                        <div className="image-editor-slider-wrap">
                            <span className="image-editor-slider-preview-box">
                                <span
                                    className="image-editor-slider-preview"
                                    style={{
                                        width: `${Math.max(6, Math.min(22, selectedThickness))}px`,
                                        height: `${Math.max(6, Math.min(22, selectedThickness))}px`,
                                        backgroundColor: selectedColor,
                                    }}
                                />
                            </span>
                            <input
                                type="range"
                                min={3}
                                max={30}
                                value={selectedThickness}
                                onChange={(e) => setSelectedThickness(Number(e.target.value))}
                                className="image-editor-slider"
                                aria-label="ضخامت قلم"
                            />
                        </div>
                    </div>
                )}

                <div className="image-editor-bottom-row">
                    <div className="image-editor-tools-dock">
                        <button
                            type="button"
                            className={`image-editor-icon-btn ${activeTool === 'crop' ? 'image-editor-icon-btn--active' : ''}`}
                            onClick={() => {
                                triggerHaptic();
                                setActiveTool((prev) => (prev === 'crop' ? 'none' : 'crop'));
                            }}
                            title="کراپ"
                        >
                            <Crop size={18} />
                        </button>

                        <button
                            type="button"
                            className={`image-editor-icon-btn ${activeTool === 'draw' ? 'image-editor-icon-btn--active' : ''}`}
                            onClick={() => {
                                triggerHaptic();
                                setActiveTool((prev) => (prev === 'draw' ? 'none' : 'draw'));
                            }}
                            title="قلمو"
                        >
                            <Brush size={18} />
                        </button>

                        <button
                            type="button"
                            className="image-editor-icon-btn"
                            onClick={handleUndo}
                            disabled={undoHistory.length === 0}
                            title="واگرد (Ctrl+Z)"
                        >
                            <TelegramUndoIcon size={18} />
                        </button>

                        <button
                            type="button"
                            className="image-editor-icon-btn"
                            onClick={handleRedo}
                            disabled={redoHistory.length === 0}
                            title="از نو (Ctrl+Y)"
                        >
                            <TelegramRedoIcon size={18} />
                        </button>
                    </div>

                    <button
                        type="button"
                        className="image-editor-check-btn"
                        onClick={handleSend}
                        title="تایید و ارسال"
                        aria-label="تایید و ارسال"
                    >
                        <Check size={22} strokeWidth={2.6} />
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
