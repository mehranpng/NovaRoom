const DB_NAME = 'novaroom_media_cache_v1';
const STORE_NAME = 'media_assets';

type CacheRecord = {
    cacheKey: string;
    mimeType: string;
    payload: ArrayBuffer;
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
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });

    return dbPromise;
};

const readFromCache = async (cacheKey: string): Promise<Blob | null> => {
    const db = await openDb();
    if (!db) return null;

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
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

const saveToCache = async (cacheKey: string, blob: Blob): Promise<void> => {
    const db = await openDb();
    if (!db) return;

    const record: CacheRecord = {
        cacheKey,
        mimeType: blob.type || 'application/octet-stream',
        payload: await blob.arrayBuffer(),
        updatedAt: Date.now(),
    };

    await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

interface GetOrCacheBlobParams {
    cacheKey: string;
    loadBlob: () => Promise<Blob>;
}

export const getOrCacheBlob = async ({ cacheKey, loadBlob }: GetOrCacheBlobParams): Promise<Blob> => {
    const cached = await readFromCache(cacheKey);
    if (cached) return cached;

    const blob = await loadBlob();
    void saveToCache(cacheKey, blob);
    return blob;
};


const deleteCacheKey = async (cacheKey: string): Promise<void> => {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(cacheKey);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
    });
};

export const deleteCachedBlob = async (cacheKey: string): Promise<void> => deleteCacheKey(cacheKey);

export const cacheTextValue = async (cacheKey: string, text: string): Promise<void> => {
    const db = await openDb();
    if (!db) return;
    const utf8 = new TextEncoder().encode(text);    const payload = new Blob([utf8], { type: 'text/plain;charset=utf-8' });
    await saveToCache(cacheKey, payload);
};

export const getCachedTextValue = async (cacheKey: string): Promise<string | null> => {
    const blob = await readFromCache(cacheKey);
    if (!blob) return null;
    try {
        return await blob.text();
    } catch {
        return null;
    }
};

export const saveBlobToCache = async (cacheKey: string, blob: Blob): Promise<void> => saveToCache(cacheKey, blob);
