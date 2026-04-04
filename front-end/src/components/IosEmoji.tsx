import type { CSSProperties, ReactNode } from 'react';

const EMOJI_CDN_BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64';

const emojiRegex = /(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;

function toUnified(emoji: string): string {
    return Array.from(emoji)
        .map((char) => char.codePointAt(0)?.toString(16).toUpperCase())
        .filter((codePoint): codePoint is string => Boolean(codePoint))
        .join('-');
}

export function IosEmoji({ emoji, size = 18, className, style }: { emoji: string; size?: number; className?: string; style?: CSSProperties }) {
    const unified = toUnified(emoji);

    return (
        <img
            src={`${EMOJI_CDN_BASE}/${unified}.png`}
            alt={emoji}
            width={size}
            height={size}
            className={className}
            style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
            loading="lazy"
            draggable={false}
        />
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
