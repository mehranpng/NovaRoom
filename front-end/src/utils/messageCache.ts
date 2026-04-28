import type { Message } from '../types';

const DB_NAME = 'novaroom_message_cache_v1';
const MESSAGE_STORE = 'chat_messages';

export type MessageRangeSnapshot = {
    hasOlder: boolean;
    hasNewer: boolean;
    loadingOlder: boolean;
    loadingNewer: boolean;
    oldestCursor?: { cursorTs: number; cursorId: string } | null;
    newestCursor?: { cursorTs: number; cursorId: string } | null;
};

type ChatMessageCacheRecord = {
    chatId: string;
    messages: Message[];
    range: MessageRangeSnapshot;
    updatedAt: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
        return Promise.resolve(null);
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
        const request = window.indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(MESSAGE_STORE)) {
                db.createObjectStore(MESSAGE_STORE, { keyPath: 'chatId' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });

    return dbPromise;
};

export const readCachedChatMessages = async (chatId: string): Promise<ChatMessageCacheRecord | null> => {
    const db = await openDb();
    if (!db || !chatId) return null;

    return new Promise((resolve) => {
        const tx = db.transaction(MESSAGE_STORE, 'readonly');
        const store = tx.objectStore(MESSAGE_STORE);
        const req = store.get(chatId);
        req.onsuccess = () => resolve((req.result as ChatMessageCacheRecord | undefined) || null);
        req.onerror = () => resolve(null);
    });
};

export const writeCachedChatMessages = async (
    chatId: string,
    messages: Message[],
    range: MessageRangeSnapshot,
): Promise<void> => {
    const db = await openDb();
    if (!db || !chatId) return;

    const record: ChatMessageCacheRecord = {
        chatId,
        messages,
        range,
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
        const tx = db.transaction(MESSAGE_STORE, 'readwrite');
        const store = tx.objectStore(MESSAGE_STORE);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

export const removeCachedChatMessages = async (chatId: string): Promise<void> => {
    const db = await openDb();
    if (!db || !chatId) return;
    await new Promise<void>((resolve) => {
        const tx = db.transaction(MESSAGE_STORE, 'readwrite');
        const store = tx.objectStore(MESSAGE_STORE);
        const req = store.delete(chatId);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

export const clearCachedMessages = async (): Promise<void> => {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        const tx = db.transaction(MESSAGE_STORE, 'readwrite');
        const store = tx.objectStore(MESSAGE_STORE);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};
