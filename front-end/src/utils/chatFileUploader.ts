import type { FileMetadata, PendingAttachment } from '../types';
import { API_BASE_URL } from '../config/api';
import { encryptFileWithRandomKey } from './e2ee';
import { saveBlobToCache } from './mediaCache';

export type UploadPhase = 'uploading' | 'encrypting';

const queues = new Map<string, Promise<unknown>>();
const controllers = new Map<string, AbortController>();
export const localBlobUrls = new Map<string, string>();

const yieldToMain = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

export function enqueueUpload<T>(chatId: string, job: () => Promise<T>): Promise<T> {
    const previous = queues.get(chatId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(job);
    queues.set(chatId, next.catch(() => undefined));
    return next;
}

export function registerUpload(clientId: string, controller: AbortController) {
    controllers.set(clientId, controller);
}

export function releaseUpload(clientId: string) {
    controllers.delete(clientId);
}

export function cancelUpload(clientId: string) {
    controllers.get(clientId)?.abort();
    controllers.delete(clientId);
}

export function registerLocalBlobUrl(fileId: string, url: string) {
    localBlobUrls.set(fileId, url);
}

export function isLocalBlobUrl(url: string) {
    for (const value of localBlobUrls.values()) {
        if (value === url) return true;
    }
    return false;
}

export async function readMediaInfo(file: File): Promise<{ width: number; height: number; duration: number }> {
    const type = file.type || '';
    if (type.startsWith('image/')) {
        try {
            const bitmap = await createImageBitmap(file);
            const size = { width: bitmap.width, height: bitmap.height, duration: 0 };
            bitmap.close();
            return size;
        } catch {
            return { width: 0, height: 0, duration: 0 };
        }
    }
    if (!type.startsWith('video/') && !type.startsWith('audio/')) {
        return { width: 0, height: 0, duration: 0 };
    }
    try {
        const objectUrl = URL.createObjectURL(file);
        return await new Promise<{ width: number; height: number; duration: number }>((resolve) => {
            const media = document.createElement(type.startsWith('video/') ? 'video' : 'audio');
            media.preload = 'metadata';
            if (media instanceof HTMLVideoElement) media.muted = true;
            const cleanup = () => URL.revokeObjectURL(objectUrl);
            const timer = window.setTimeout(() => {
                cleanup();
                resolve({ width: 0, height: 0, duration: 0 });
            }, 1500);
            media.onloadedmetadata = () => {
                window.clearTimeout(timer);
                cleanup();
                resolve({
                    width: media instanceof HTMLVideoElement ? media.videoWidth : 0,
                    height: media instanceof HTMLVideoElement ? media.videoHeight : 0,
                    duration: Number.isFinite(media.duration) ? media.duration : 0,
                });
            };
            media.onerror = () => {
                window.clearTimeout(timer);
                cleanup();
                resolve({ width: 0, height: 0, duration: 0 });
            };
            media.src = objectUrl;
        });
    } catch {
        return { width: 0, height: 0, duration: 0 };
    }
}

export async function createBlurredPreview(file: File): Promise<Blob | null> {
    try {
        const bitmap = await createImageBitmap(file);
        const maxWidth = 480;
        const minAspect = 0.5;
        const maxAspect = 2.0;
        const srcAspect = bitmap.width / bitmap.height;
        const targetAspect = Math.min(maxAspect, Math.max(minAspect, srcAspect));
        let cropW = bitmap.width;
        let cropH = bitmap.height;
        if (srcAspect > targetAspect) cropW = Math.round(bitmap.height * targetAspect);
        else if (srcAspect < targetAspect) cropH = Math.round(bitmap.width / targetAspect);
        const cropX = Math.max(0, Math.floor((bitmap.width - cropW) / 2));
        const cropY = Math.max(0, Math.floor((bitmap.height - cropH) / 2));
        const ratio = Math.min(1, maxWidth / cropW);
        const width = Math.max(1, Math.round(cropW * ratio));
        const height = Math.max(1, Math.round(cropH * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.filter = 'blur(8px)';
        ctx.drawImage(bitmap, cropX, cropY, cropW, cropH, 0, 0, width, height);
        return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72));
    } catch {
        return null;
    }
}

export async function uploadChatFile(args: {
    attachment: PendingAttachment;
    token: string;
    chatId: string;
    signal: AbortSignal;
    onPhase: (phase: UploadPhase, progress: number) => void;
}): Promise<FileMetadata> {
    const { attachment, token, chatId, signal, onPhase } = args;
    const file = attachment.file;
    const type = file.type || '';
    const isAudio = type.startsWith('audio/');
    let reported = 0;
    const report = (next: number) => {
        const value = Math.max(reported, Math.min(100, Math.round(next)));
        if (value === reported) return;
        reported = value;
        onPhase('uploading', value);
    };

    try {
        if (signal.aborted) throw new Error('aborted');
        if (!isAudio) onPhase('encrypting', 0);
        let imagePreviewBlob: Blob | null = null;
        if (type.startsWith('image/')) {
            imagePreviewBlob = await createBlurredPreview(file);
        }

        await yieldToMain();
        const plainBytes = isAudio ? null : new Uint8Array(await file.arrayBuffer());
        await yieldToMain();
        const encryptedFile = plainBytes ? await encryptFileWithRandomKey(plainBytes, token, chatId) : null;
        const fileBytes = encryptedFile?.encryptedBytes ?? null;
        if (signal.aborted) throw new Error('aborted');

        await yieldToMain();
        onPhase('uploading', 0);
        const formData = new FormData();
        if (isAudio) {
            formData.append('file', file, file.name);
        } else if (fileBytes) {
            formData.append('file', new Blob([fileBytes as BlobPart], { type: 'application/octet-stream' }), file.name);
        }
        if (attachment.duration > 0) formData.append('duration', String(attachment.duration));
        if (imagePreviewBlob) {
            formData.append('preview', new window.File([imagePreviewBlob], `preview-${file.name}.jpg`, { type: 'image/jpeg' }));
        }

        const response = await new Promise<{ success?: boolean; file?: FileMetadata }>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            let lastReportTime = 0;
            const onAbort = () => xhr.abort();
            const detach = () => signal.removeEventListener('abort', onAbort);

            xhr.upload.addEventListener('progress', (e) => {
                if (!e.lengthComputable) return;
                const progress = (e.loaded / e.total) * 100;
                const now = performance.now();
                if (progress === 100 || progress >= reported + 2 || now - lastReportTime > 200) {
                    lastReportTime = now;
                    report(progress);
                }
            });
            xhr.addEventListener('load', () => {
                detach();
                if (xhr.status !== 200) {
                    reject(new Error(`upload failed ${xhr.status}`));
                    return;
                }
                try {
                    resolve(JSON.parse(xhr.responseText));
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

            if (signal.aborted) {
                reject(new Error('aborted'));
                return;
            }
            signal.addEventListener('abort', onAbort);
            xhr.open('POST', `${API_BASE_URL}/files/upload`);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send(formData);
        });

        if (!response.success || !response.file) throw new Error('invalid upload response');

        const result: FileMetadata = {
            ...response.file,
            fileName: file.name,
            fileSize: file.size,
            mimeType: type || response.file.mimeType,
            width: attachment.width,
            height: attachment.height,
            duration: attachment.duration,
            encryptedFileKey: encryptedFile?.encryptedFileKey,
        };

        report(100);
        void saveBlobToCache(`chat:${chatId}:file:${result.fileId}`, file);

        return result;
    } catch (error) {
        if (signal.aborted) throw new Error('aborted');
        throw error;
    }
}
