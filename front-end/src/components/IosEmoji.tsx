import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

const emojiRegex = /(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/gu;
const FE0F = 'fe0f';
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function toCodePoints(emoji: string): string[] {
    return Array.from(emoji)
        .map((char) => char.codePointAt(0)?.toString(16).toLowerCase())
        .filter((codePoint): codePoint is string => Boolean(codePoint));
}

function buildEmojiVariants(emoji: string): string[] {
    if (!emoji) return [];

    const variants = new Set<string>();
    variants.add(emoji);

    const noVs16 = toCodePoints(emoji).filter((cp) => cp !== FE0F);
    if (noVs16.length > 0) {
        variants.add(String.fromCodePoint(...noVs16.map((cp) => parseInt(cp, 16))));
    }

    return Array.from(variants);
}

function buildUrls(emoji: string): string[] {
    const variants = buildEmojiVariants(emoji);
    const urls: string[] = [];

    for (const variant of variants) {
        const encoded = encodeURIComponent(variant);
        urls.push(`https://emojicdn.elk.sh/${encoded}?style=apple`);
    }

    const unifiedVariants = variants.map((item) => toCodePoints(item).join('-')).filter(Boolean);
    for (const unified of unifiedVariants) {
        urls.push(`https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/${unified}.png`);
        urls.push(`https://unpkg.com/emoji-datasource-apple@15.1.2/img/apple/64/${unified}.png`);
    }

    return Array.from(new Set(urls));
}

function loadImage(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = url;
    });
}

async function resolveEmojiUrl(emoji: string): Promise<string | null> {
    if (cache.has(emoji)) return cache.get(emoji) ?? null;
    if (pending.has(emoji)) return pending.get(emoji)!;

    const task = (async () => {
        const urls = buildUrls(emoji);
        for (const url of urls) {
            const ok = await loadImage(url);
            if (ok) {
                cache.set(emoji, url);
                return url;
            }
        }

        cache.set(emoji, null);
        return null;
    })();

    pending.set(emoji, task);
    const result = await task;
    pending.delete(emoji);
    return result;
}

export async function preloadIosEmojiAssets(emojis: string[]): Promise<void> {
    const unique = Array.from(new Set(emojis));
    await Promise.all(unique.map((emoji) => resolveEmojiUrl(emoji)));
}

export const COMMON_IOS_EMOJIS_TO_PRELOAD = [
    '👍', '👎', '🤣', '😢', '❤️', '💔', '😐',
    '⚠️', '🎬', '🎵', '✅',
    '🖼️', '🎥', '📄', '📦', '📝', '📊', '📽️', '📃', '📎',
    '☕', '🧘‍♀️', '🎨', '👋', '🙏', '😀', '😁', '😂', '😅', '😊', '😍', '😘', '😎', '😡', '😭',
    '🤔', '🙌', '👏', '🔥', '✨', '❌', '⭐', '🎉', '💯',
];

export function IosEmoji({ emoji, size = 18, className, style }: { emoji: string; size?: number; className?: string; style?: CSSProperties }) {
    const [resolvedUrl, setResolvedUrl] = useState<string | null>(() => cache.get(emoji) ?? null);

    useEffect(() => {
        let cancelled = false;
        setResolvedUrl(cache.get(emoji) ?? null);

        resolveEmojiUrl(emoji).then((url) => {
            if (!cancelled) setResolvedUrl(url);
        });

        return () => { cancelled = true; };
    }, [emoji]);

    if (!resolvedUrl) {
        return <span style={{ fontSize: size, lineHeight: 1, ...style }}>{emoji}</span>;
    }

    return (
        <img
            src={resolvedUrl}
            alt={emoji}
            width={size}
            height={size}
            className={className}
            style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
            loading="eager"
            decoding="async"
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
