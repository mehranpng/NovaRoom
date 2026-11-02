import type { Message } from '../types';

const MEDIA_DB_NAME = 'novaroom_media_cache_v1';
const MEDIA_STORE_NAME = 'media_assets';

const TEXT_DB_NAME = 'novaroom_text_cache_v1';
const TEXT_STORE_NAME = 'text_messages';

const SNAPSHOT_DB_NAME = 'novaroom_chat_snapshots_v1';
const SNAPSHOT_STORE_NAME = 'chat_snapshots';
const SNAPSHOT_MAX_MESSAGES = 50;

type CacheRecord = {
    cacheKey: string;
    mimeType: string;
    payload: ArrayBuffer;
    updatedAt: number;
};

type TextCacheRecord = {
    cacheKey: string;
    text: string;
    updatedAt: number;
};

type ChatSnapshotRecord = {
    chatId: string;
    messages: Message[];
    updatedAt: number;
};

let mediaDbPromise: Promise<IDBDatabase | null> | null = null;
let textDbPromise: Promise<IDBDatabase | null> | null = null;
let snapshotDbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (
    dbName: string,
    storeName: string,
    dbPromiseRef: 'media' | 'text' | 'snapshot',
    keyPath = 'cacheKey',
): Promise<IDBDatabase | null> => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
        return Promise.resolve(null);
    }

    const currentPromise = dbPromiseRef === 'media'
        ? mediaDbPromise
        : dbPromiseRef === 'text' ? textDbPromise : snapshotDbPromise;
    if (currentPromise) return currentPromise;

    const nextPromise = new Promise<IDBDatabase | null>((resolve) => {
        const request = window.indexedDB.open(dbName, 1);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });

    if (dbPromiseRef === 'media') mediaDbPromise = nextPromise;
    else if (dbPromiseRef === 'text') textDbPromise = nextPromise;
    else snapshotDbPromise = nextPromise;

    return nextPromise;
};

const openMediaDb = () => openDb(MEDIA_DB_NAME, MEDIA_STORE_NAME, 'media');
const openTextDb = () => openDb(TEXT_DB_NAME, TEXT_STORE_NAME, 'text');
const openSnapshotDb = () => openDb(SNAPSHOT_DB_NAME, SNAPSHOT_STORE_NAME, 'snapshot', 'chatId');

const hasEncryptionMagic = (payload: ArrayBuffer): boolean => {
    if (payload.byteLength < 4) return false;
    const bytes = new Uint8Array(payload, 0, 4);
    if (bytes[0] !== 0x4e || bytes[1] !== 0x43) return false;
    if (bytes[2] === 0x46) return bytes[3] === 0x31 || bytes[3] === 0x32;
    return bytes[2] === 0x41 && bytes[3] === 0x31;
};

const readBlobFromCache = async (cacheKey: string): Promise<Blob | null> => {
    const db = await openMediaDb();
    if (!db) return null;

    return new Promise((resolve) => {
        const tx = db.transaction(MEDIA_STORE_NAME, 'readonly');
        const store = tx.objectStore(MEDIA_STORE_NAME);
        const req = store.get(cacheKey);

        req.onsuccess = () => {
            const record = req.result as CacheRecord | undefined;
            if (!record?.payload) {
                resolve(null);
                return;
            }
            if (hasEncryptionMagic(record.payload)) {
                void deleteMediaCacheKey(cacheKey);
                resolve(null);
                return;
            }
            resolve(new Blob([record.payload], { type: record.mimeType || 'application/octet-stream' }));
        };
        req.onerror = () => resolve(null);
    });
};

const saveBlobCache = async (cacheKey: string, blob: Blob): Promise<void> => {
    const db = await openMediaDb();
    if (!db) return;

    const record: CacheRecord = {
        cacheKey,
        mimeType: blob.type || 'application/octet-stream',
        payload: await blob.arrayBuffer(),
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
        const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
        const store = tx.objectStore(MEDIA_STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

const deleteMediaCacheKey = async (cacheKey: string): Promise<void> => {
    const db = await openMediaDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
        const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
        const store = tx.objectStore(MEDIA_STORE_NAME);
        const req = store.delete(cacheKey);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

const saveTextCache = async (cacheKey: string, text: string): Promise<void> => {
    const db = await openTextDb();
    if (!db) return;

    const record: TextCacheRecord = {
        cacheKey,
        text,
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
        const tx = db.transaction(TEXT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(TEXT_STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

const readTextCache = async (cacheKey: string): Promise<string | null> => {
    const db = await openTextDb();
    if (!db) return null;

    return new Promise((resolve) => {
        const tx = db.transaction(TEXT_STORE_NAME, 'readonly');
        const store = tx.objectStore(TEXT_STORE_NAME);
        const req = store.get(cacheKey);

        req.onsuccess = () => {
            const record = req.result as TextCacheRecord | undefined;
            resolve(typeof record?.text === 'string' ? record.text : null);
        };
        req.onerror = () => resolve(null);
    });
};

const deleteTextCacheKey = async (cacheKey: string): Promise<void> => {
    const db = await openTextDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
        const tx = db.transaction(TEXT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(TEXT_STORE_NAME);
        const req = store.delete(cacheKey);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

const saveChatSnapshotRecord = async (chatId: string, messages: Message[]): Promise<void> => {
    const db = await openSnapshotDb();
    if (!db || !chatId) return;

    const record: ChatSnapshotRecord = {
        chatId,
        messages: messages.slice(-SNAPSHOT_MAX_MESSAGES),
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
        const tx = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SNAPSHOT_STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

const readChatSnapshotRecord = async (chatId: string): Promise<Message[] | null> => {
    const db = await openSnapshotDb();
    if (!db || !chatId) return null;

    return new Promise((resolve) => {
        const tx = db.transaction(SNAPSHOT_STORE_NAME, 'readonly');
        const store = tx.objectStore(SNAPSHOT_STORE_NAME);
        const req = store.get(chatId);

        req.onsuccess = () => {
            const record = req.result as ChatSnapshotRecord | undefined;
            resolve(Array.isArray(record?.messages) ? record.messages : null);
        };
        req.onerror = () => resolve(null);
    });
};

const clearChatSnapshotRecords = async (): Promise<void> => {
    const db = await openSnapshotDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
        const tx = db.transaction(SNAPSHOT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SNAPSHOT_STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

const clearTextCacheRecords = async (): Promise<void> => {
    const db = await openTextDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
        const tx = db.transaction(TEXT_STORE_NAME, 'readwrite');
        const store = tx.objectStore(TEXT_STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

interface GetOrCacheBlobParams {
    cacheKey: string;
    loadBlob: () => Promise<Blob>;
}

export const getOrCacheBlob = async ({ cacheKey, loadBlob }: GetOrCacheBlobParams): Promise<Blob> => {
    const cached = await readBlobFromCache(cacheKey);
    if (cached) return cached;

    const blob = await loadBlob();
    void saveBlobCache(cacheKey, blob);
    return blob;
};

export const getCachedBlob = async (cacheKey: string): Promise<Blob | null> => readBlobFromCache(cacheKey);

export const saveBlobToCache = async (cacheKey: string, blob: Blob): Promise<void> => saveBlobCache(cacheKey, blob);
export const deleteCachedBlob = async (cacheKey: string): Promise<void> => deleteMediaCacheKey(cacheKey);

export const cacheTextValue = async (cacheKey: string, text: string): Promise<void> => saveTextCache(cacheKey, text);
export const getCachedTextValue = async (cacheKey: string): Promise<string | null> => readTextCache(cacheKey);
export const deleteCachedText = async (cacheKey: string): Promise<void> => deleteTextCacheKey(cacheKey);

export const saveChatSnapshot = async (chatId: string, messages: Message[]): Promise<void> => saveChatSnapshotRecord(chatId, messages);
export const getChatSnapshot = async (chatId: string): Promise<Message[] | null> => readChatSnapshotRecord(chatId);
export const clearChatSnapshots = async (): Promise<void> => clearChatSnapshotRecords();
export const clearCachedTextValues = async (): Promise<void> => clearTextCacheRecords();

export const getMediaCacheUsageBytes = async (): Promise<number> => {
    const db = await openMediaDb();
    if (!db) return 0;

    return new Promise((resolve) => {
        const tx = db.transaction(MEDIA_STORE_NAME, 'readonly');
        const store = tx.objectStore(MEDIA_STORE_NAME);
        const req = store.openCursor();
        let total = 0;

        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) {
                resolve(total);
                return;
            }
            const value = cursor.value as CacheRecord | undefined;
            const payload = value?.payload;
            if (payload?.byteLength) total += payload.byteLength;
            cursor.continue();
        };
        req.onerror = () => resolve(total);
    });
};

export const clearAllMediaCache = async (): Promise<void> => {
    const db = await openMediaDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
        const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
        const store = tx.objectStore(MEDIA_STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};
