import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { copyText } from './clipboard';

const HIGHLIGHT_NAME = 'nova-selection';
const HIGHLIGHT_MINE_NAME = 'nova-selection-mine';
const ROOT_SELECTOR = '.message-text--selectable';
const TEXT_SELECTOR = '.message-text:not(.message-text--emoji-only)';
const EMOJI_ONLY_CLASS = 'message-text--emoji-only';
const LONG_PRESS_MS = 350;
const MOVE_TOLERANCE = 8;

type Caret = { node: Node; offset: number };
type HandleSide = 'start' | 'end';

export type CustomSelectionUi = {
    start: { x: number; y: number; height: number };
    end: { x: number; y: number; height: number };
    bar: { top: number; left: number };
    isRtl: boolean;
    isMine: boolean;
    startDir: 'left' | 'right';
    endDir: 'left' | 'right';
    messageId: string | null;
};

type Options = {
    enabled: boolean;
    containerRef: { current: HTMLElement | null };
};

const isSupported = () =>
    typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

function caretFromPoint(x: number, y: number): Caret | null {
    const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (doc.caretPositionFromPoint) {
        const pos = doc.caretPositionFromPoint(x, y);
        return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
    }
    if (doc.caretRangeFromPoint) {
        const range = doc.caretRangeFromPoint(x, y);
        return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }
    return null;
}

function resolveNearestTextCaret(root: HTMLElement, x: number, y: number): Caret | null {
    const direct = caretFromPoint(x, y);
    if (direct && root.contains(direct.node) && direct.node.nodeType === Node.TEXT_NODE) {
        return direct;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const probe = document.createRange();
    let bestNode: Node | null = null;
    let bestOffset = 0;
    let bestDist = Infinity;
    let current = walker.nextNode();
    while (current) {
        const len = (current.textContent || '').length;
        for (let i = 0; i <= len; i += 1) {
            probe.setStart(current, i);
            probe.setEnd(current, i);
            const r = probe.getClientRects()[0];
            if (!r) continue;
            const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
            const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
            const dist = dy * 2.5 + dx;
            if (dist < bestDist) {
                bestDist = dist;
                bestNode = current;
                bestOffset = i;
            }
        }
        current = walker.nextNode();
    }
    return bestNode ? { node: bestNode, offset: bestOffset } : null;
}

function caretInRoot(root: HTMLElement, x: number, y: number): Caret | null {
    const rect = root.getBoundingClientRect();
    const cx = Math.min(rect.right - 2, Math.max(rect.left + 2, x));
    const cy = Math.min(rect.bottom - 2, Math.max(rect.top + 2, y));
    return resolveNearestTextCaret(root, cx, cy);
}

function orderedRange(a: Caret, b: Caret): { range: Range; flipped: boolean } {
    const probe = document.createRange();
    probe.setStart(a.node, a.offset);
    probe.setEnd(a.node, a.offset);
    const flipped = probe.comparePoint(b.node, b.offset) < 0;
    const first = flipped ? b : a;
    const second = flipped ? a : b;
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(second.node, second.offset);
    return { range, flipped };
}

function wordRangeAt(root: HTMLElement, caret: Caret): Range | null {
    let node = caret.node;
    let offset = caret.offset;
    if (node.nodeType !== Node.TEXT_NODE) {
        const first = document.createTreeWalker(root, NodeFilter.SHOW_TEXT).nextNode();
        if (!first) return null;
        node = first;
        offset = 0;
    }
    const text = node.textContent || '';
    if (!text) return null;
    let start = 0;
    let end = text.length;
    const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text));
    const hit = segments.find((seg) => offset < seg.index + seg.segment.length) || segments[segments.length - 1];
    if (hit) {
        start = hit.index;
        end = hit.index + hit.segment.length;
    }
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
}

function snapCaret(caret: Caret, _side: HandleSide, speed: number): Caret {
    if (speed <= 0.25 || caret.node.nodeType !== Node.TEXT_NODE) return caret;
    const text = caret.node.textContent || '';
    if (!text) return caret;
    const segments = Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text));
    const seg = segments.find((s) => caret.offset > s.index && caret.offset < s.index + s.segment.length);
    if (!seg || !seg.isWordLike || seg.segment.length <= 2) return caret;
    const rel = (caret.offset - seg.index) / seg.segment.length;
    if (rel <= 0.25) return { node: caret.node, offset: seg.index };
    if (rel >= 0.75) return { node: caret.node, offset: seg.index + seg.segment.length };
    return caret;
}

function edgeRect(range: Range, atStart: boolean): DOMRect | null {
    const probe = document.createRange();
    try {
        if (atStart) {
            const node = range.startContainer;
            const max = node.nodeType === Node.TEXT_NODE ? (node.textContent || '').length : node.childNodes.length;
            probe.setStart(node, range.startOffset);
            probe.setEnd(node, Math.min(max, range.startOffset + 1));
        } else {
            const node = range.endContainer;
            probe.setStart(node, Math.max(0, range.endOffset - 1));
            probe.setEnd(node, range.endOffset);
        }
        const rect = probe.getClientRects()[0];
        if (rect && (rect.width > 0 || rect.height > 0)) return rect;
    } catch {
        return null;
    }
    const rects = range.getClientRects();
    if (!rects.length) return null;
    return atStart ? rects[0] : rects[rects.length - 1];
}

export function useCustomTextSelection({ enabled, containerRef }: Options) {
    const [ui, setUi] = useState<CustomSelectionUi | null>(null);
    const rangeRef = useRef<Range | null>(null);
    const rootRef = useRef<HTMLElement | null>(null);
    const activeHandleRef = useRef<HandleSide>('end');
    const rafRef = useRef<number | null>(null);
    const velocityRef = useRef({ x: 0, y: 0, time: 0 });
    const fixedCaretRef = useRef<Caret | null>(null);
    const dragOffsetRef = useRef({ dx: 0, dy: 0 });
    const didMouseDragRef = useRef(false);

    const trackSpeed = useCallback((x: number, y: number) => {
        const now = performance.now();
        const last = velocityRef.current;
        velocityRef.current = { x, y, time: now };
        if (!last.time) return 0;
        const dt = Math.max(1, now - last.time);
        return Math.hypot(x - last.x, y - last.y) / dt;
    }, []);

    const refresh = useCallback(() => {
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const range = rangeRef.current;
            const container = containerRef.current;
            if (!range || !container || range.collapsed) {
                setUi(null);
                return;
            }
            const startRect = edgeRect(range, true);
            const endRect = edgeRect(range, false);
            if (!startRect || !endRect) {
                setUi(null);
                return;
            }
            const cr = container.getBoundingClientRect();
            const root = rootRef.current;
            const isRtl = root ? getComputedStyle(root).direction === 'rtl' : true;
            const startEdgeX = isRtl ? startRect.right : startRect.left;
            const endEdgeX = isRtl ? endRect.left : endRect.right;
            const startPoint = {
                x: startEdgeX - cr.left,
                y: startRect.bottom - cr.top,
                height: Math.max(18, Math.min(28, startRect.height || 20)),
            };
            const endPoint = {
                x: endEdgeX - cr.left,
                y: endRect.bottom - cr.top,
                height: Math.max(18, Math.min(28, endRect.height || 20)),
            };
            const rawLeft = (startPoint.x + endPoint.x) / 2;
            const halfBar = ((container.querySelector<HTMLElement>('.selection-bar')?.offsetWidth || 260) / 2) + 12;
            const left = Math.min(Math.max(halfBar, cr.width - halfBar), Math.max(halfBar, rawLeft));
            const aboveTop = Math.min(startPoint.y - startPoint.height, endPoint.y - endPoint.height) - 56;
            const top = aboveTop < 72 ? Math.max(endPoint.y, startPoint.y) + 36 : aboveTop;
            const isMine = Boolean(root?.closest('.message-bubble--mine'));
            const messageId = root?.closest<HTMLElement>('[data-message-id]')?.dataset.messageId || null;
            const rootRect = root?.getBoundingClientRect();
            const defaultStartDir: 'left' | 'right' = isRtl ? 'right' : 'left';
            const defaultEndDir: 'left' | 'right' = isRtl ? 'left' : 'right';
            const startNearEdge = rootRect
                ? (isRtl ? (rootRect.right - startEdgeX < 14) : (startEdgeX - rootRect.left < 14))
                : false;
            const endNearEdge = rootRect
                ? (isRtl ? (endEdgeX - rootRect.left < 14) : (rootRect.right - endEdgeX < 14))
                : false;
            const startDir = startNearEdge ? (defaultStartDir === 'right' ? 'left' : 'right') : defaultStartDir;
            const endDir = endNearEdge ? (defaultEndDir === 'right' ? 'left' : 'right') : defaultEndDir;
            setUi({ start: startPoint, end: endPoint, bar: { top, left }, isRtl, isMine, startDir, endDir, messageId });
        });
    }, [containerRef]);

    const apply = useCallback((range: Range | null) => {
        rangeRef.current = range;
        if (isSupported()) {
            const isMine = Boolean(rootRef.current?.closest('.message-bubble--mine'));
            CSS.highlights.delete(HIGHLIGHT_NAME);
            CSS.highlights.delete(HIGHLIGHT_MINE_NAME);
            if (range && !range.collapsed) {
                CSS.highlights.set(isMine ? HIGHLIGHT_MINE_NAME : HIGHLIGHT_NAME, new Highlight(range));
            }
        }
        refresh();
    }, [refresh]);

    const clear = useCallback(() => {
        rootRef.current = null;
        apply(null);
    }, [apply]);

    const getText = useCallback(() => rangeRef.current?.toString() || '', []);

    const copySelection = useCallback(async () => {
        const text = getText();
        if (!text) return false;
        await copyText(text).catch(() => undefined);
        clear();
        return true;
    }, [getText, clear]);

    const getQuoteSelection = useCallback((): { messageId: string; text: string } | null => {
        const text = (rangeRef.current?.toString() || '').trim();
        const messageId = rootRef.current?.closest<HTMLElement>('[data-message-id]')?.dataset.messageId || null;
        if (!text || !messageId) return null;
        return { messageId, text };
    }, []);

    const selectAll = useCallback(() => {
        const root = rootRef.current;
        if (!root) return;
        const range = document.createRange();
        range.selectNodeContents(root);
        apply(range);
    }, [apply]);

    useEffect(() => {
        if (!enabled) clear();
    }, [enabled, clear]);

    useEffect(() => {
        if (!isSupported()) return;

        let pressTimer: number | null = null;
        let pressStart = { x: 0, y: 0 };
        let mouseAnchor: Caret | null = null;
        let mouseRoot: HTMLElement | null = null;

        const cancelPress = () => {
            if (pressTimer !== null) {
                window.clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        const onPointerDown = (e: PointerEvent) => {
            const target = e.target;
            if (!(target instanceof Element)) return;
            if (target.closest('.cs-handle, .selection-bar')) return;
            if (e.pointerType === 'mouse') {
                if (e.button !== 0) return;
                const rawRoot = target.closest<HTMLElement>(TEXT_SELECTOR);
                const root = rawRoot && !rawRoot.classList.contains(EMOJI_ONLY_CLASS) ? rawRoot : null;
                if (!root) {
                    clear();
                    return;
                }
                mouseRoot = root;
                mouseAnchor = caretInRoot(root, e.clientX, e.clientY);
                pressStart = { x: e.clientX, y: e.clientY };
                didMouseDragRef.current = false;
                trackSpeed(e.clientX, e.clientY);
                return;
            }
            const rawRoot = target.closest<HTMLElement>(ROOT_SELECTOR);
            const root = rawRoot && !rawRoot.classList.contains(EMOJI_ONLY_CLASS) ? rawRoot : null;
            if (!root) {
                clear();
                return;
            }
            if (rootRef.current && rootRef.current !== root) clear();
            pressStart = { x: e.clientX, y: e.clientY };
            cancelPress();
            pressTimer = window.setTimeout(() => {
                pressTimer = null;
                const caret = caretInRoot(root, pressStart.x, pressStart.y);
                if (!caret) return;
                const range = wordRangeAt(root, caret);
                if (!range) return;
                rootRef.current = root;
                apply(range);
            }, LONG_PRESS_MS);
        };

        const onPointerMove = (e: PointerEvent) => {
            if (pressTimer !== null && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > MOVE_TOLERANCE) {
                cancelPress();
            }
            if (e.pointerType !== 'mouse' || !mouseAnchor || !mouseRoot || e.buttons !== 1) return;
            if (!didMouseDragRef.current) {
                if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) <= 4) return;
                didMouseDragRef.current = true;
                rootRef.current = mouseRoot;
                apply(null);
            }
            const caret = caretInRoot(mouseRoot, e.clientX, e.clientY);
            if (!caret) return;
            const speed = trackSpeed(e.clientX, e.clientY);
            apply(orderedRange(mouseAnchor, snapCaret(caret, 'end', speed)).range);
        };

        const onPointerEnd = () => {
            cancelPress();
            mouseAnchor = null;
            mouseRoot = null;
            velocityRef.current = { x: 0, y: 0, time: 0 };
        };

        const onClickCapture = (ev: MouseEvent) => {
            if (!didMouseDragRef.current) return;
            didMouseDragRef.current = false;
            ev.stopPropagation();
            ev.preventDefault();
        };

        const onDoubleClick = (e: MouseEvent) => {
            const target = e.target;
            if (!(target instanceof Element)) return;
            const rawRoot = target.closest<HTMLElement>(TEXT_SELECTOR);
            const root = rawRoot && !rawRoot.classList.contains(EMOJI_ONLY_CLASS) ? rawRoot : null;
            if (!root) return;
            const caret = caretInRoot(root, e.clientX, e.clientY);
            if (!caret) return;
            const range = wordRangeAt(root, caret);
            if (!range) return;
            rootRef.current = root;
            apply(range);
        };

        const onContextMenu = (e: MouseEvent) => {
            if (e.target instanceof Element && e.target.closest(`${TEXT_SELECTOR}, .cs-handle`)) e.preventDefault();
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && rangeRef.current) clear();
        };

        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerup', onPointerEnd, true);
        document.addEventListener('pointercancel', onPointerEnd, true);
        document.addEventListener('dblclick', onDoubleClick, true);
        document.addEventListener('contextmenu', onContextMenu, true);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('click', onClickCapture, true);
        document.addEventListener('scroll', refresh, true);
        window.addEventListener('resize', refresh);

        return () => {
            cancelPress();
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('pointermove', onPointerMove, true);
            document.removeEventListener('pointerup', onPointerEnd, true);
            document.removeEventListener('pointercancel', onPointerEnd, true);
            document.removeEventListener('dblclick', onDoubleClick, true);
            document.removeEventListener('contextmenu', onContextMenu, true);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('click', onClickCapture, true);
            document.removeEventListener('scroll', refresh, true);
            window.removeEventListener('resize', refresh);
            clear();
        };
    }, [apply, clear, refresh, trackSpeed]);

    const handleProps = useCallback((side: HandleSide) => ({
        onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const range = rangeRef.current;
            const root = rootRef.current;
            if (!range || !root) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            activeHandleRef.current = side;
            fixedCaretRef.current = side === 'start'
                ? { node: range.endContainer, offset: range.endOffset }
                : { node: range.startContainer, offset: range.startOffset };
            const activeRect = edgeRect(range, side === 'start');
            const isRtl = getComputedStyle(root).direction === 'rtl';
            if (activeRect) {
                const targetX = side === 'start'
                    ? (isRtl ? activeRect.right : activeRect.left)
                    : (isRtl ? activeRect.left : activeRect.right);
                const targetY = activeRect.top + activeRect.height / 2;
                dragOffsetRef.current = {
                    dx: targetX - e.clientX,
                    dy: targetY - e.clientY,
                };
            } else {
                dragOffsetRef.current = { dx: 0, dy: -18 };
            }
            trackSpeed(e.clientX, e.clientY);
        },
        onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const fixed = fixedCaretRef.current;
            const root = rootRef.current;
            if (!fixed || !root) return;
            const sampleX = e.clientX + dragOffsetRef.current.dx;
            const sampleY = e.clientY + dragOffsetRef.current.dy;
            const rawCaret = caretInRoot(root, sampleX, sampleY);
            if (!rawCaret) return;
            const speed = trackSpeed(e.clientX, e.clientY);
            const caret = snapCaret(rawCaret, activeHandleRef.current, speed);
            const next = orderedRange(fixed, caret);
            if (next.range.collapsed) return;
            apply(next.range);
        },
        onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
            fixedCaretRef.current = null;
            velocityRef.current = { x: 0, y: 0, time: 0 };
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        },
        onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
            fixedCaretRef.current = null;
            velocityRef.current = { x: 0, y: 0, time: 0 };
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        },
    }), [apply, trackSpeed]);

    return { ui, hasActiveSelection: Boolean(ui), clear, copySelection, getQuoteSelection, selectAll, handleProps };
}
