import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

const EMOJI_CDN_BASE = 'https://emojicdn.elk.sh';
const emojiRegex = /(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;
const FE0F = 'fe0f';
const preloadCache = new Set<string>();

function toCodePoints(emoji: string): string[] {
    return Array.from(emoji)
        .map((char) => char.codePointAt(0)?.toString(16).toLowerCase())
        .filter((codePoint): codePoint is string => Boolean(codePoint));
}

function buildEmojiUrls(emoji: string): string[] {
    if (!emoji) return [];
    const variants = new Set<string>();
    variants.add(emoji);

    const noVs16 = toCodePoints(emoji).filter((cp) => cp !== FE0F);
    if (noVs16.length > 0) {
        const stripped = String.fromCodePoint(...noVs16.map((cp) => parseInt(cp, 16)));
        variants.add(stripped);
    }

    return Array.from(variants).map((value) => `${EMOJI_CDN_BASE}/${encodeURIComponent(value)}?style=apple`);
}

export function preloadIosEmojiAssets(emojis: string[]): void {
    emojis.forEach((emoji) => {
        const [firstUrl] = buildEmojiUrls(emoji);
        if (!firstUrl || preloadCache.has(firstUrl)) return;

        preloadCache.add(firstUrl);
        const image = new Image();
        image.decoding = 'async';
        image.src = firstUrl;
    });
}

export const COMMON_IOS_EMOJIS_TO_PRELOAD = [
    '👍', '👎', '🤣', '😢', '❤️', '💔', '😐',
    '⚠️', '🎬', '🎵', '✅',
    '🖼️', '🎥', '📄', '📦', '📝', '📊', '📽️', '📃', '📎',
    '☕', '🧘‍♀️', '🎨', '👋', '🙏', '😀', '😁', '😂', '😅', '😊', '😍', '😘', '😎', '😡', '😭',
    '🤔', '🙌', '👏', '🔥', '✨', '✅', '❌', '⭐', '🎉', '💯',
];

export function IosEmoji({ emoji, size = 18, className, style }: { emoji: string; size?: number; className?: string; style?: CSSProperties }) {
    const urls = useMemo(() => buildEmojiUrls(emoji), [emoji]);
    const [urlIndex, setUrlIndex] = useState(0);
    const [showNative, setShowNative] = useState(false);


    useEffect(() => {
        setUrlIndex(0);
        setShowNative(false);
    }, [emoji]);
    const activeUrl = urls[urlIndex];

    if (showNative || !activeUrl) {
        return <span style={{ fontSize: size, lineHeight: 1, ...style }}>{emoji}</span>;
    }

    return (
        <img
            src={activeUrl}
            alt={emoji}
            width={size}
            height={size}
            className={className}
            style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
            loading="eager"
            decoding="async"
            draggable={false}
            onError={() => {
                const next = urlIndex + 1;
                if (next < urls.length) {
                    setUrlIndex(next);
                    return;
                }
                setShowNative(true);
            }}
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
