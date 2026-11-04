import { API_BASE_URL } from '../config/api';

const DB_NAME = 'novaroom_assets_db';
const STORE_NAME = 'fonts';
const FONT_KEY = 'apple_color_emoji_ttf';
const STORAGE_KEY = 'novaroom_emoji_font_enabled';

let activeEmojiFace: FontFace | null = null;
let activeBlobUrl: string | null = null;

function openFontDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB not supported'));
            return;
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function getStoredEmojiFont(): Promise<ArrayBuffer | null> {
    try {
        const db = await openFontDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(FONT_KEY);
            req.onsuccess = () => {
                const res = req.result;
                if (!res) {
                    resolve(null);
                    return;
                }
                if (res instanceof ArrayBuffer) {
                    resolve(res);
                } else if (res instanceof Blob) {
                    res.arrayBuffer().then(resolve).catch(reject);
                } else {
                    resolve(null);
                }
            };
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

export async function saveEmojiFontToDb(buffer: ArrayBuffer): Promise<void> {
    const db = await openFontDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(buffer, FONT_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function deleteEmojiFontFromDb(): Promise<void> {
    const db = await openFontDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(FONT_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function isEmojiFontDownloaded(): Promise<boolean> {
    const font = await getStoredEmojiFont();
    return !!font && font.byteLength > 0;
}

export function isEmojiFontActive(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setEmojiFontActive(active: boolean): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, active ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('novaroom_emoji_font_changed', { detail: { active } }));
}

export async function loadEmojiFontIntoDocument(buffer: ArrayBuffer): Promise<boolean> {
    try {
        unloadEmojiFontFromDocument();
        let fontFace: FontFace;
        try {
            fontFace = new FontFace('AppleEmoji', buffer);
            await fontFace.load();
        } catch {
            const blob = new Blob([buffer], { type: 'font/ttf' });
            activeBlobUrl = URL.createObjectURL(blob);
            fontFace = new FontFace('AppleEmoji', `url(${activeBlobUrl})`);
            await fontFace.load();
        }
        document.fonts.add(fontFace);
        activeEmojiFace = fontFace;
        if (typeof document !== 'undefined') {
            document.documentElement.classList.add('has-ios-emoji');
        }
        return true;
    } catch {
        return false;
    }
}

export function unloadEmojiFontFromDocument(): void {
    if (activeEmojiFace) {
        document.fonts.delete(activeEmojiFace);
        activeEmojiFace = null;
    }
    if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
    }
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('has-ios-emoji');
    }
}

export async function initEmojiFont(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (!isEmojiFontActive()) return false;
    const buffer = await getStoredEmojiFont();
    if (!buffer) {
        setEmojiFontActive(false);
        return false;
    }
    return await loadEmojiFontIntoDocument(buffer);
}

export async function downloadEmojiFont(
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal
): Promise<ArrayBuffer> {
    const response = await fetch(`${API_BASE_URL}/static/fonts/NotoColorEmoji.ttf`, {
        signal,
    });
    if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
    }
    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 43170492;
    const reader = response.body?.getReader();
    if (!reader) {
        const buf = await response.arrayBuffer();
        if (onProgress) onProgress(buf.byteLength, buf.byteLength);
        return buf;
    }
    let loaded = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            loaded += value.length;
            if (onProgress) {
                onProgress(loaded, total);
            }
        }
    }
    const combined = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }
    return combined.buffer;
}

export async function saveAndActivateEmojiFont(buffer: ArrayBuffer): Promise<boolean> {
    await saveEmojiFontToDb(buffer);
    setEmojiFontActive(true);
    return await loadEmojiFontIntoDocument(buffer);
}

export async function toggleEmojiFontActive(active: boolean): Promise<boolean> {
    if (active) {
        const buffer = await getStoredEmojiFont();
        if (!buffer) return false;
        const success = await loadEmojiFontIntoDocument(buffer);
        if (success) {
            setEmojiFontActive(true);
        }
        return success;
    } else {
        unloadEmojiFontFromDocument();
        setEmojiFontActive(false);
        return true;
    }
}

export async function removeEmojiFont(): Promise<void> {
    unloadEmojiFontFromDocument();
    setEmojiFontActive(false);
    await deleteEmojiFontFromDb();
}

if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
            if (e.newValue === 'true') {
                getStoredEmojiFont().then((buf) => {
                    if (buf) loadEmojiFontIntoDocument(buf);
                });
            } else {
                unloadEmojiFontFromDocument();
            }
        }
    });
}
