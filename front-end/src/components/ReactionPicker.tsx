import { useRef, type PointerEvent } from 'react';

interface ReactionPickerProps {
    messageId: string;
    currentReaction?: string;
    onReact: (messageId: string, emoji: string) => void;
    onDeleteReaction: (messageId: string) => void;
    onClose: () => void;
}

const EMOJIS = ['👍', '👎', '🤣', '😢', '❤️', '💔', '😐', '😍', '🤔', '✅️', '❌️', '💩', '😡', '🖕'];

export function ReactionPicker({ messageId, currentReaction, onReact, onDeleteReaction }: ReactionPickerProps) {
    const emojisRef = useRef<HTMLDivElement | null>(null);
    const isPointerDownRef = useRef(false);
    const dragStartXRef = useRef(0);
    const startScrollLeftRef = useRef(0);

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        const container = emojisRef.current;
        if (!container) return;
        isPointerDownRef.current = true;
        dragStartXRef.current = e.clientX;
        startScrollLeftRef.current = container.scrollLeft;
        container.setPointerCapture?.(e.pointerId);
        container.classList.add('reaction-picker__emojis--dragging');
    };

    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        if (!isPointerDownRef.current) return;
        const container = emojisRef.current;
        if (!container) return;
        const dx = e.clientX - dragStartXRef.current;
        container.scrollLeft = startScrollLeftRef.current - dx;
    };

    const stopDragging = (e: PointerEvent<HTMLDivElement>) => {
        const container = emojisRef.current;
        isPointerDownRef.current = false;
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
