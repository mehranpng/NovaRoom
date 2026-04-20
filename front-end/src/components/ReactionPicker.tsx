interface ReactionPickerProps {
    messageId: string;
    currentReaction?: string;
    onReact: (messageId: string, emoji: string) => void;
    onDeleteReaction: (messageId: string) => void;
    onClose: () => void;
}

const EMOJIS = ['👍', '👎', '🤣', '😢', '❤️', '💔', '😐', '😍', '🤔', '🔥', '✅️', '❌️', '💩', '😡', '😰'];

export function ReactionPicker({ messageId, currentReaction, onReact, onDeleteReaction }: ReactionPickerProps) {
    return (
        <div className="reaction-picker">
            <div className="reaction-picker__emojis">
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
