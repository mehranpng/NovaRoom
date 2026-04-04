import type { CSSProperties, ReactNode } from 'react';

const emojiRegex = /(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;

const LOCAL_EMOJI_STYLE: CSSProperties = {
    fontFamily: 'Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif',
    fontVariantEmoji: 'emoji',
    lineHeight: 1,
};

export async function preloadIosEmojiAssets(_emojis: string[]): Promise<void> {
    // Local-only mode: no network calls are needed.
}

export const COMMON_IOS_EMOJIS_TO_PRELOAD = [
    '👍', '👎', '🤣', '😢', '❤️', '💔', '😐',
    '⚠️', '🎬', '🎵', '✅',
    '🖼️', '🎥', '📄', '📦', '📝', '📊', '📽️', '📃', '📎',
    '☕', '🧘‍♀️', '🎨', '👋', '🙏', '😀', '😁', '😂', '😅', '😊', '😍', '😘', '😎', '😡', '😭',
    '🤔', '🙌', '👏', '🔥', '✨', '❌', '⭐', '🎉', '💯',
];

export function IosEmoji({ emoji, size = 18, className, style }: { emoji: string; size?: number; className?: string; style?: CSSProperties }) {
    return (
        <span
            className={className}
            style={{
                ...LOCAL_EMOJI_STYLE,
                fontSize: size,
                display: 'inline-block',
                verticalAlign: 'middle',
                ...style,
            }}
        >
            {emoji}
        </span>
    );
}

export function renderTextWithIosEmoji(text: string, size = 18): ReactNode[] {
    const parts = text.split(emojiRegex);

    return parts.filter(Boolean).map((part, index) => {
        if (part.match(emojiRegex)) {
            return <IosEmoji key={`${part}-${index}`} emoji={part} size={size} />;
        }
        return <span key={`text-${index}`}>{part}</span>;
    });
}
