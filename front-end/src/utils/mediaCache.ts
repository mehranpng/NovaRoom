const MEDIA_DB_NAME = 'novaroom_media_cache_v1';
const MEDIA_STORE_NAME = 'media_assets';

const TEXT_DB_NAME = 'novaroom_text_cache_v1';
const TEXT_STORE_NAME = 'text_messages';

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

let mediaDbPromise: Promise<IDBDatabase | null> | null = null;
let textDbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (
    dbName: string,
    storeName: string,
    dbPromiseRef: 'media' | 'text',
): Promise<IDBDatabase | null> => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
        return Promise.resolve(null);
    }

    const currentPromise = dbPromiseRef === 'media' ? mediaDbPromise : textDbPromise;
    if (currentPromise) return currentPromise;

    const nextPromise = new Promise<IDBDatabase | null>((resolve) => {
        const request = window.indexedDB.open(dbName, 1);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: 'cacheKey' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });

    if (dbPromiseRef === 'media') mediaDbPromise = nextPromise;
    else textDbPromise = nextPromise;

    return nextPromise;
};

const openMediaDb = () => openDb(MEDIA_DB_NAME, MEDIA_STORE_NAME, 'media');
const openTextDb = () => openDb(TEXT_DB_NAME, TEXT_STORE_NAME, 'text');

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
