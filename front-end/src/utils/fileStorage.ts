import type { FileMetadata } from '../types';
import { API_BASE_URL } from '../config/api';

interface PresignSlot {
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType?: string;
    contentType: string;
    uploadUrl: string;
}

interface PresignResponse {
    direct: boolean;
    file?: PresignSlot;
    preview?: PresignSlot | null;
}

export function extractFileIdFromUrlOrId(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const marker = '/files/';
    const idx = raw.indexOf(marker);
    if (idx !== -1) {
        const tail = raw.slice(idx + marker.length).split('?')[0].split('#')[0].replace(/^\/+/, '');
        if (tail && !tail.includes('/')) {
            try {
                return decodeURIComponent(tail);
            } catch {
                return tail;
            }
        }
        return '';
    }
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
        return '';
    }
    return raw.includes('/') ? '' : raw;
}

export function deleteUploadedFileQuietly(fileId: string, token: string): Promise<void> {
    const cleanId = extractFileIdFromUrlOrId(fileId);
    if (!cleanId || !token) return Promise.resolve();
    return fetch(`${API_BASE_URL}/files/${encodeURIComponent(cleanId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
    })
        .then(() => undefined)
        .catch(() => undefined);
}

function xhrPutBlob(args: {
    url: string;
    blob: Blob;
    contentType: string;
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
}): Promise<void> {
    const { url, blob, contentType, signal, onProgress } = args;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
        }
        const xhr = new XMLHttpRequest();
        let lastReportTime = 0;
        let lastReported = -1;
        const onAbort = () => xhr.abort();
        const detach = () => signal?.removeEventListener('abort', onAbort);

        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (!e.lengthComputable) return;
                const progress = Math.min(100, Math.round((e.loaded / e.total) * 100));
                const now = performance.now();
                if (progress === 100 || progress >= lastReported + 2 || now - lastReportTime > 200) {
                    lastReportTime = now;
                    lastReported = progress;
                    onProgress(progress);
                }
            });
        }
        xhr.addEventListener('load', () => {
            detach();
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`s3 upload failed ${xhr.status}`));
            }
        });
        xhr.addEventListener('error', () => {
            detach();
            reject(new Error('s3 upload failed'));
        });
        xhr.addEventListener('abort', () => {
            detach();
            reject(new Error('aborted'));
        });

        signal?.addEventListener('abort', onAbort);
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
        xhr.send(blob);
    });
}

function xhrPostFormUpload(args: {
    blob: Blob;
    fileName: string;
    token: string;
    signal?: AbortSignal;
    previewBlob?: Blob | null;
    previewFileName?: string;
    duration?: number;
    onProgress?: (progress: number) => void;
}): Promise<FileMetadata> {
    const { blob, fileName, token, signal, previewBlob, previewFileName, duration, onProgress } = args;
    const formData = new FormData();
    formData.append('file', blob, fileName);
    if (duration && duration > 0) formData.append('duration', String(duration));
    if (previewBlob) {
        formData.append(
            'preview',
            new window.File([previewBlob], previewFileName || `preview-${fileName}.jpg`, {
                type: previewBlob.type || 'image/jpeg',
            })
        );
    }

    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
        }
        const xhr = new XMLHttpRequest();
        let lastReportTime = 0;
        let lastReported = -1;
        const onAbort = () => xhr.abort();
        const detach = () => signal?.removeEventListener('abort', onAbort);

        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (!e.lengthComputable) return;
                const progress = Math.min(100, Math.round((e.loaded / e.total) * 100));
                const now = performance.now();
                if (progress === 100 || progress >= lastReported + 2 || now - lastReportTime > 200) {
                    lastReportTime = now;
                    lastReported = progress;
                    onProgress(progress);
                }
            });
        }
        xhr.addEventListener('load', () => {
            detach();
            if (xhr.status !== 200) {
                reject(new Error(`upload failed ${xhr.status}`));
                return;
            }
            try {
                const parsed = JSON.parse(xhr.responseText);
                if (!parsed?.success || !parsed?.file) {
                    reject(new Error('invalid upload response'));
                    return;
                }
                resolve(parsed.file as FileMetadata);
            } catch (error) {
                reject(error);
            }
        });
        xhr.addEventListener('error', () => {
            detach();
            reject(new Error('upload failed'));
        });
        xhr.addEventListener('abort', () => {
            detach();
            reject(new Error('aborted'));
        });

        signal?.addEventListener('abort', onAbort);
        xhr.open('POST', `${API_BASE_URL}/files/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
    });
}

export async function uploadBlobDirectOrLegacy(args: {
    blob: Blob;
    fileName: string;
    token: string;
    signal?: AbortSignal;
    previewBlob?: Blob | null;
    previewFileName?: string;
    duration?: number;
    onProgress?: (progress: number) => void;
}): Promise<FileMetadata> {
    const { blob, fileName, token, signal, previewBlob, previewFileName, duration, onProgress } = args;
    if (signal?.aborted) throw new Error('aborted');

    const presignRes = await fetch(`${API_BASE_URL}/files/presign-upload`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            fileName,
            fileSize: blob.size,
            mimeType: blob.type || 'application/octet-stream',
            preview: previewBlob
                ? {
                      fileName: previewFileName || `preview-${fileName}.jpg`,
                      fileSize: previewBlob.size,
                      mimeType: previewBlob.type || 'image/jpeg',
                  }
                : undefined,
        }),
        signal,
    });

    if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        throw new Error(err?.detail || `presign failed ${presignRes.status}`);
    }

    const presign = (await presignRes.json()) as PresignResponse;
    if (!presign.direct || !presign.file) {
        return xhrPostFormUpload(args);
    }

    const uploadedIds: string[] = [];
    try {
        await xhrPutBlob({
            url: presign.file.uploadUrl,
            blob,
            contentType: presign.file.contentType,
            signal,
            onProgress,
        });
        uploadedIds.push(presign.file.fileId);

        if (previewBlob && presign.preview) {
            await xhrPutBlob({
                url: presign.preview.uploadUrl,
                blob: previewBlob,
                contentType: presign.preview.contentType,
                signal,
            });
            uploadedIds.push(presign.preview.fileId);
        }

        const confirmRes = await fetch(`${API_BASE_URL}/files/confirm-upload`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                fileId: presign.file.fileId,
                fileName,
                previewFileId: presign.preview?.fileId,
                duration: duration && duration > 0 ? duration : undefined,
            }),
            signal,
        });

        if (!confirmRes.ok) {
            const err = await confirmRes.json().catch(() => ({}));
            throw new Error(err?.detail || `confirm failed ${confirmRes.status}`);
        }
        const confirmed = (await confirmRes.json()) as { success?: boolean; file?: FileMetadata };
        if (!confirmed?.success || !confirmed?.file) {
            throw new Error('invalid confirm response');
        }
        return confirmed.file;
    } catch (error) {
        for (const id of uploadedIds) {
            void deleteUploadedFileQuietly(id, token);
        }
        throw error;
    }
}

async function readResponseWithProgress(
    res: Response,
    onProgress?: (progress: number) => void
): Promise<Uint8Array> {
    if (!onProgress || !res.body) {
        return new Uint8Array(await res.arrayBuffer());
    }
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (!contentLength || !Number.isFinite(contentLength)) {
        return new Uint8Array(await res.arrayBuffer());
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            received += value.byteLength;
            onProgress(Math.min(99, Math.max(1, Math.round((received / contentLength) * 100))));
        }
    }
    const combined = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return combined;
}

export async function fetchProtectedFileBytes(
    fileIdOrUrl: string,
    token: string,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void
): Promise<{ bytes: Uint8Array; contentType: string }> {
    const fileId = extractFileIdFromUrlOrId(fileIdOrUrl);
    if (!fileId) {
        const res = await fetch(fileIdOrUrl, { signal });
        if (!res.ok) throw new Error('download failed');
        const bytes = await readResponseWithProgress(res, onProgress);
        return {
            bytes,
            contentType: res.headers.get('content-type') || 'application/octet-stream',
        };
    }

    const resolveRes = await fetch(
        `${API_BASE_URL}/files/${encodeURIComponent(fileId)}?resolve=1`,
        {
            headers: { Authorization: `Bearer ${token}` },
            signal,
        }
    );
    if (!resolveRes.ok) throw new Error('download failed');

    const resolved = (await resolveRes.json()) as { direct?: boolean; url?: string };
    let dataRes: Response;
    if (resolved?.direct && resolved.url) {
        dataRes = await fetch(resolved.url, { signal });
    } else {
        const fallbackPath = resolved?.url || `/files/${encodeURIComponent(fileId)}?proxy=1`;
        const fallbackUrl = fallbackPath.startsWith('http')
            ? fallbackPath
            : `${API_BASE_URL}${fallbackPath.startsWith('/') ? '' : '/'}${fallbackPath}`;
        dataRes = await fetch(fallbackUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal,
        });
    }

    if (!dataRes.ok) throw new Error('download failed');
    const bytes = await readResponseWithProgress(dataRes, onProgress);
    return {
        bytes,
        contentType: dataRes.headers.get('content-type') || 'application/octet-stream',
    };
}
