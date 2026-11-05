import { API_BASE_URL } from '../../../config/api';

const DB_NAME = 'novaroom_stockfish_db';
const STORE_NAME = 'assets';
const JS_KEY = 'stockfish_js';
const WASM_KEY = 'stockfish_wasm';
const ENGINE_FILES = {
    js: 'stockfish-19-lite-single.js',
    wasm: 'stockfish-19-lite-single.wasm',
} as const;

interface EngineAssets {
    js: ArrayBuffer;
    wasm: ArrayBuffer;
}

const engineUrl = (filename: string) => `${API_BASE_URL}/static/stockfish/${filename}`;

function openAssetDb(): Promise<IDBDatabase> {
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

async function readAsset(key: string): Promise<ArrayBuffer | null> {
    const db = await openAssetDb();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
        request.onsuccess = () => {
            const value = request.result;
            resolve(value instanceof ArrayBuffer ? value : null);
        };
        request.onerror = () => reject(request.error);
    });
}

async function writeAssets(assets: EngineAssets): Promise<void> {
    const db = await openAssetDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(assets.js, JS_KEY);
        store.put(assets.wasm, WASM_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function fetchAsset(
    filename: string,
    onProgress: (loaded: number, total: number) => void,
    signal?: AbortSignal,
): Promise<ArrayBuffer> {
    const response = await fetch(engineUrl(filename), { signal });
    if (!response.ok) throw new Error(`engine_download_failed:${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body?.getReader();
    if (!reader) {
        const buffer = await response.arrayBuffer();
        onProgress(total || buffer.byteLength, total || buffer.byteLength);
        return buffer;
    }
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            loaded += value.length;
            onProgress(loaded, total);
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

export async function getStockfishAssets(): Promise<EngineAssets | null> {
    try {
        const [js, wasm] = await Promise.all([readAsset(JS_KEY), readAsset(WASM_KEY)]);
        return js && wasm ? { js, wasm } : null;
    } catch {
        return null;
    }
}

export async function isStockfishDownloaded(): Promise<boolean> {
    return (await getStockfishAssets()) !== null;
}

export async function downloadStockfishAssets(
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
): Promise<void> {
    let completed = 0;
    let totalSize = 0;
    const report = (loaded: number, total: number) => {
        totalSize = Math.max(totalSize, completed + total);
        const denominator = Math.max(totalSize, completed + loaded);
        const percent = denominator > 0 ? Math.min(99, Math.round(((completed + loaded) / denominator) * 100)) : 0;
        onProgress?.(percent, 100);
    };
    const js = await fetchAsset(ENGINE_FILES.js, report, signal);
    completed = js.byteLength;
    const wasm = await fetchAsset(ENGINE_FILES.wasm, report, signal);
    await writeAssets({ js, wasm });
    onProgress?.(100, 100);
}

let workerUrls: { js: string; wasm: string } | null = null;

export async function createStockfishWorker(): Promise<Worker> {
    const assets = await getStockfishAssets();
    if (!assets) throw new Error('engine_not_downloaded');
    if (!workerUrls) {
        workerUrls = {
            js: URL.createObjectURL(new Blob([assets.js], { type: 'text/javascript' })),
            wasm: URL.createObjectURL(new Blob([assets.wasm], { type: 'application/wasm' })),
        };
    }
    return new Worker(`${workerUrls.js}#${encodeURIComponent(workerUrls.wasm)}`);
}
