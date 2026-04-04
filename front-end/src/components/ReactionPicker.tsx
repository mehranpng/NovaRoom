import { type MouseEvent, useRef } from 'react';
import { IosEmoji } from './IosEmoji';

interface ReactionPickerProps {
    messageId: string;
    currentReaction?: string;
    onReact: (messageId: string, emoji: string) => void;
    onDeleteReaction: (messageId: string) => void;
    onClose: () => void;
}

const EMOJIS = ['👍', '👎', '🤣', '😢', '❤️', '💔', '😐', '😍', '🤔', '✅️', '❌️', '💩', '😡', '🖕'];

export function ReactionPicker({ messageId, currentReaction, onReact, onDeleteReaction }: ReactionPickerProps) {
    const emojiListRef = useRef<HTMLDivElement | null>(null);
    const dragStateRef = useRef({ isDragging: false, startX: 0, startScrollLeft: 0 });

    const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
        if (!emojiListRef.current) return;
        dragStateRef.current = {
            isDragging: true,
            startX: event.clientX,
            startScrollLeft: emojiListRef.current.scrollLeft,
        };
    };

    const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
        if (!emojiListRef.current || !dragStateRef.current.isDragging) return;
        event.preventDefault();
        const distance = event.clientX - dragStateRef.current.startX;
        emojiListRef.current.scrollLeft = dragStateRef.current.startScrollLeft - distance;
    };

    const handleMouseUpOrLeave = () => {
        dragStateRef.current.isDragging = false;
    };

    return (
        <div className="reaction-picker">
            <div
                ref={emojiListRef}
                className="reaction-picker__emojis"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave}
                onMouseLeave={handleMouseUpOrLeave}
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
                        <IosEmoji emoji={emoji} size={20} />
                    </button>
                ))}
            </div>
        </div>
    );
}
