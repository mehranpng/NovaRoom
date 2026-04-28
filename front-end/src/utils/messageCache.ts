import type { Message } from '../types';

const CACHE_PREFIX = 'novaroom_message_cache_v1:';

type MessageRangeState = {
    hasOlder: boolean;
    hasNewer: boolean;
    loadingOlder: boolean;
    loadingNewer: boolean;
    oldestCursor?: { cursorTs: number; cursorId: string } | null;
    newestCursor?: { cursorTs: number; cursorId: string } | null;
};

type CachedChatMessages = {
    chatId: string;
    revision: string;
    messages: Message[];
    rangeState: MessageRangeState;
    updatedAt: number;
};

const keyForChat = (chatId: string) => `${CACHE_PREFIX}${chatId}`;

export const getCachedChatMessages = (chatId: string): CachedChatMessages | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(keyForChat(chatId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedChatMessages;
        if (!parsed || parsed.chatId !== chatId || !Array.isArray(parsed.messages)) return null;
        if (typeof parsed.revision !== 'string') return null;
        return parsed;
    } catch {
        return null;
    }
};

export const setCachedChatMessages = (
    chatId: string,
    payload: { revision: string; messages: Message[]; rangeState: MessageRangeState }
): void => {
    if (typeof window === 'undefined') return;
    try {
        const record: CachedChatMessages = {
            chatId,
            revision: String(payload.revision || ''),
            messages: Array.isArray(payload.messages) ? payload.messages : [],
            rangeState: payload.rangeState,
            updatedAt: Date.now(),
        };
        window.localStorage.setItem(keyForChat(chatId), JSON.stringify(record));
    } catch {
        // ignore storage errors
    }
};

export const clearAllMessageCaches = (): void => {
    if (typeof window === 'undefined') return;
    try {
        const keysToDelete: string[] = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach((key) => window.localStorage.removeItem(key));
    } catch {
        // ignore
    }
};
