import { useSyncExternalStore } from 'react';
import type { MessageReply } from '../types';

export type ChatDraftEntry = {
    text: string;
    replyTo?: MessageReply | null;
    updatedAt: number;
};

export type ChatScrollEntry = {
    top: number;
    atBottom: boolean;
    userInteracted: boolean;
    anchorMessageId: string | null;
    anchorOffset: number;
};

const DRAFTS_STORAGE_KEY = 'novaroom:chat-drafts:v1';
const SCROLL_STORAGE_KEY = 'novaroom:chat-scroll:v1';

let draftsCache: Record<string, ChatDraftEntry> = loadDraftsFromStorage();
const draftListeners = new Set<() => void>();

function loadDraftsFromStorage(): Record<string, ChatDraftEntry> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed as Record<string, ChatDraftEntry>;
    } catch {
        return {};
    }
}

function persistDraftsToStorage(next: Record<string, ChatDraftEntry>) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
        return;
    }
}

function emitDraftsChanged() {
    draftListeners.forEach((listener) => listener());
}

export function getChatDraft(chatId: string | null | undefined): ChatDraftEntry | null {
    if (!chatId || chatId === 'pending') return null;
    return draftsCache[chatId] ?? null;
}

export function setChatDraft(
    chatId: string | null | undefined,
    patch: { text?: string; replyTo?: MessageReply | null }
) {
    if (!chatId || chatId === 'pending') return;
    const prev = draftsCache[chatId];
    const nextText = patch.text !== undefined ? patch.text : (prev?.text ?? '');
    const nextReplyTo = patch.replyTo !== undefined ? patch.replyTo : (prev?.replyTo ?? null);
    const trimmed = nextText.trim();

    if (!trimmed && !nextReplyTo) {
        if (!prev) return;
        const next = { ...draftsCache };
        delete next[chatId];
        draftsCache = next;
        persistDraftsToStorage(next);
        emitDraftsChanged();
        return;
    }

    if (
        prev &&
        prev.text === nextText &&
        (prev.replyTo?.id ?? null) === (nextReplyTo?.id ?? null) &&
        (prev.replyTo?.text ?? '') === (nextReplyTo?.text ?? '') &&
        Boolean(prev.replyTo?.isQuote) === Boolean(nextReplyTo?.isQuote)
    ) {
        return;
    }

    const next: Record<string, ChatDraftEntry> = {
        ...draftsCache,
        [chatId]: {
            text: nextText,
            replyTo: nextReplyTo,
            updatedAt: Date.now(),
        },
    };
    draftsCache = next;
    persistDraftsToStorage(next);
    emitDraftsChanged();
}

export function clearChatDraft(chatId: string | null | undefined) {
    if (!chatId || !draftsCache[chatId]) return;
    const next = { ...draftsCache };
    delete next[chatId];
    draftsCache = next;
    persistDraftsToStorage(next);
    emitDraftsChanged();
}

export function clearAllChatDrafts() {
    draftsCache = {};
    if (typeof window !== 'undefined') {
        try {
            localStorage.removeItem(DRAFTS_STORAGE_KEY);
        } catch {
            return;
        }
    }
    emitDraftsChanged();
}

function subscribeDrafts(listener: () => void) {
    draftListeners.add(listener);
    return () => {
        draftListeners.delete(listener);
    };
}

function getDraftsSnapshot() {
    return draftsCache;
}

export function useChatDrafts(): Record<string, ChatDraftEntry> {
    return useSyncExternalStore(subscribeDrafts, getDraftsSnapshot, getDraftsSnapshot);
}

let scrollMemoryCache: Record<string, ChatScrollEntry> = loadScrollFromStorage();

function loadScrollFromStorage(): Record<string, ChatScrollEntry> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = sessionStorage.getItem(SCROLL_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed as Record<string, ChatScrollEntry>;
    } catch {
        return {};
    }
}

function persistScrollToStorage() {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(scrollMemoryCache));
    } catch {
        return;
    }
}

export function getChatScrollMemory(chatId: string | null | undefined): ChatScrollEntry | null {
    if (!chatId || chatId === 'pending') return null;
    return scrollMemoryCache[chatId] ?? null;
}

export function setChatScrollMemory(chatId: string | null | undefined, entry: ChatScrollEntry) {
    if (!chatId || chatId === 'pending') return;
    scrollMemoryCache[chatId] = entry;
    persistScrollToStorage();
}

export function clearChatScrollMemory(chatId?: string | null) {
    if (chatId) {
        delete scrollMemoryCache[chatId];
        persistScrollToStorage();
        return;
    }
    scrollMemoryCache = {};
    if (typeof window !== 'undefined') {
        try {
            sessionStorage.removeItem(SCROLL_STORAGE_KEY);
        } catch {
            return;
        }
    }
}
