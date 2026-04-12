import { useRef, type PointerEvent } from 'react';

interface ReactionPickerProps {
    messageId: string;
    currentReaction?: string;
    onReact: (messageId: string, emoji: string) => void;
    onDeleteReaction: (messageId: string) => void;
    onClose: () => void;
}

const EMOJIS = ['👍', '👎', '🤣', '😢', '❤️', '💔', '😐', '😍', '🤔', '✅️', '❌️', '💩', '😡', '😰'];

export function ReactionPicker({ messageId, currentReaction, onReact, onDeleteReaction }: ReactionPickerProps) {
    const emojisRef = useRef<HTMLDivElement | null>(null);
    const isPointerDownRef = useRef(false);
    const isDraggingRef = useRef(false);
    const dragStartXRef = useRef(0);
    const startScrollLeftRef = useRef(0);
    const dragFactorRef = useRef(1.2);
    const dragThresholdRef = useRef(6);

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        // Desktop users mostly click reactions; avoid hijacking click with drag logic.
        if (e.pointerType === 'mouse') return;
        const container = emojisRef.current;
        if (!container) return;
        isPointerDownRef.current = true;
        isDraggingRef.current = false;
        dragStartXRef.current = e.clientX;
        startScrollLeftRef.current = container.scrollLeft;
        dragFactorRef.current = 2.4;
        container.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        if (!isPointerDownRef.current) return;
        const container = emojisRef.current;
        if (!container) return;
        const dx = e.clientX - dragStartXRef.current;
        if (!isDraggingRef.current && Math.abs(dx) < dragThresholdRef.current) return;
        if (!isDraggingRef.current) {
            isDraggingRef.current = true;
            container.classList.add('reaction-picker__emojis--dragging');
        }
        container.scrollLeft = startScrollLeftRef.current - (dx * dragFactorRef.current);
    };

    const stopDragging = (e: PointerEvent<HTMLDivElement>) => {
        const container = emojisRef.current;
        isPointerDownRef.current = false;
        isDraggingRef.current = false;
        container?.releasePointerCapture?.(e.pointerId);
        container?.classList.remove('reaction-picker__emojis--dragging');
    };

    return (
        <div className="reaction-picker">
            <div
                ref={emojisRef}
                className="reaction-picker__emojis"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
            >
                {EMOJIS.map((emoji) => (
                    <button
                        key={emoji}
                        className={currentReaction === emoji ? 'reaction-picker__emoji reaction-picker__emoji--active' : 'reaction-picker__emoji'}
                        onClick={() => {
                            if (currentReaction === emoji) {
                                onDeleteReaction(messageId);
                            } else {
                                onReact(messageId, emoji);
                            }
                        }}
                        type="button"
                    >
                        {emoji}
                    </button>
                ))}
            </div>
        </div>
    );
}
