import type { FileMetadata } from '../types';
import { formatFileSize, getFileIcon, isImageFile } from '../utils/fileUtils';
import { Download, Play, Pause, X } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';
import { decryptFileBytesClientSide } from '../utils/e2ee';
import { getCachedBlob, getOrCacheBlob } from '../utils/mediaCache';

interface FileMessageProps {
    file: FileMetadata;
    token: string;
    chatId: string;
    onMediaLoad?: () => void;
    onImageClick?: (imageUrl: string, file: FileMetadata) => void;
    onVideoClick?: (videoUrl: string, file: FileMetadata) => void;
    onMediaOpened?: () => void;
    onRegisterDownloadHandler?: (handler: (() => Promise<void>) | null) => void;
}

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function FileMessage({ file, token, chatId, onMediaLoad, onImageClick, onVideoClick, onMediaOpened, onRegisterDownloadHandler }: FileMessageProps) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioLoading, setAudioLoading] = useState(false);
    const [audioError, setAudioError] = useState(false);
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const [fullMediaUrl, setFullMediaUrl] = useState<string | null>(null);
    const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'done'>('idle');
    const [downloadProgress, setDownloadProgress] = useState(0);
    const downloadAbortRef = useRef<AbortController | null>(null);

    const musicPlayer = useMusicPlayer();
    const isImage = isImageFile(file.mimeType);
    const isAudio = (file.mimeType || '').startsWith('audio/');
    const isVideo = (file.mimeType || '').startsWith('video/');
    const hasPreview = Boolean((file.previewFileId || '').trim());
    const mediaCacheKey = `chat:${chatId}:file:${file.fileId}`;

    const isCurrentTrack = musicPlayer.track?.fileId === file.fileId;
    const isThisPlaying = isCurrentTrack && musicPlayer.isPlaying;
    const audioTitle = (file.title || '').trim();
    const audioArtist = (file.artist || '').trim() || 'unknown';
    const displayAudioTitle = audioTitle || file.fileName;
    const audioSubtitle = audioTitle ? audioArtist : ((file.artist || '').trim() || 'unknown');
    const rawCoverFileId = (file as any).coverArtFileId || (file as any)?.meta?.coverArtFileId || (file as any)?.metadata?.coverArtFileId;
    const rawCoverUrl = (file.coverArtUrl || (file as any).coverUrl || (file as any)?.meta?.coverArtUrl || (file as any)?.metadata?.coverArtUrl || '').trim();

    const circleStyle = useMemo(() => ({
        ['--p' as any]: String(downloadProgress),
    }), [downloadProgress]);

    const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        return copy.buffer;
    };

    const decodeResponseBlob = async (response: Response, preferredType?: string): Promise<Blob> => {
        const encryptedBytes = new Uint8Array(await response.arrayBuffer());
        const plainBytes = await decryptFileBytesClientSide(encryptedBytes, token, chatId);
        const plainBuffer = toArrayBuffer(plainBytes);
        return new Blob([plainBuffer], { type: preferredType || response.headers.get('content-type') || 'application/octet-stream' });
    };

    const fetchAndDecryptBlob = async (fileId: string, preferredType?: string): Promise<Blob> => {
        const response = await fetch(`${API_BASE_URL}/files/${fileId}`, {
            credentials: 'omit',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to load media file');
        return decodeResponseBlob(response, preferredType);
    };

    useEffect(() => {
        if (!isImage && !isVideo) return;
        let previewObjectUrl: string | null = null;
        let fullObjectUrl: string | null = null;
        let cancelled = false;

        const setFullFromBlob = (blob: Blob) => {
            fullObjectUrl = URL.createObjectURL(blob);
            setFullMediaUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return fullObjectUrl;
            });
            setPreviewUrl(null);
            onMediaLoad?.();
        };

        const loadMedia = async () => {
            try {
                const cachedOriginal = await getCachedBlob(mediaCacheKey);
                if (cachedOriginal) {
                    if (cancelled) return;
                    setFullFromBlob(cachedOriginal);
                    return;
                }

                if (!hasPreview) {
                    const legacyBlob = await getOrCacheBlob({
                        cacheKey: mediaCacheKey,
                        loadBlob: async () => fetchAndDecryptBlob(file.fileId, file.mimeType),
                    });
                    if (cancelled) return;
                    setFullFromBlob(legacyBlob);
                    return;
                }

                setPreviewLoading(true);
                const previewBlob = await getOrCacheBlob({
                    cacheKey: `chat:${chatId}:preview:${file.previewFileId}`,
                    loadBlob: async () => {
                        const response = await fetch(`${API_BASE_URL}/files/${file.previewFileId}/preview`, {
                            credentials: 'omit',
                            headers: { Authorization: `Bearer ${token}` },
                        });
                        if (!response.ok) throw new Error('Failed to load preview');
                        return response.blob();
                    },
                });
                if (cancelled) return;
                previewObjectUrl = URL.createObjectURL(previewBlob);
                setPreviewUrl(previewObjectUrl);
                onMediaLoad?.();
            } catch {
                if (cancelled) return;
                // If preview failed, keep compatibility by showing full file.
                try {
                    const fallbackBlob = await getOrCacheBlob({
                        cacheKey: mediaCacheKey,
                        loadBlob: async () => fetchAndDecryptBlob(file.fileId, file.mimeType),
                    });
                    if (!cancelled) {
                        setFullFromBlob(fallbackBlob);
                    }
                } catch {
                    onMediaLoad?.();
                }
            } finally {
                if (!cancelled) setPreviewLoading(false);
            }
        };

        void loadMedia();
        return () => {
            cancelled = true;
            if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
            if (fullObjectUrl) URL.revokeObjectURL(fullObjectUrl);
        };
    }, [chatId, file.fileId, file.mimeType, file.previewFileId, hasPreview, isImage, isVideo, mediaCacheKey, onMediaLoad, token]);

    useEffect(() => {
        if (!isAudio) return;
        let objectUrl: string | null = null;
        let cancelled = false;
        const loadAudio = async () => {
            try {
                setAudioLoading(true);
                setAudioError(false);
                const blob = await getOrCacheBlob({
                    cacheKey: mediaCacheKey,
                    loadBlob: async () => fetchAndDecryptBlob(file.fileId, file.mimeType),
                });
                if (!cancelled) {
                    objectUrl = window.URL.createObjectURL(blob);
                    setAudioUrl(objectUrl);
                }
            } catch {
                if (!cancelled) setAudioError(true);
            } finally {
                if (!cancelled) setAudioLoading(false);
            }
        };
        loadAudio();
        return () => {
            cancelled = true;
            if (objectUrl) window.URL.revokeObjectURL(objectUrl);
        };
    }, [chatId, file.fileId, file.mimeType, isAudio, token]);

    useEffect(() => {
        if (!isAudio) return;
        if (rawCoverUrl) {
            setCoverUrl(rawCoverUrl);
            return;
        }
        if (!rawCoverFileId) {
            setCoverUrl(null);
            return;
        }
        let objectUrl: string | null = null;
        let cancelled = false;
        const loadCover = async () => {
            try {
                const blob = await getOrCacheBlob({
                    cacheKey: `chat:${chatId}:file:${rawCoverFileId}`,
                    loadBlob: async () => fetchAndDecryptBlob(rawCoverFileId),
                });
                if (!cancelled) {
                    objectUrl = window.URL.createObjectURL(blob);
                    setCoverUrl(objectUrl);
                }
            } catch {
                if (!cancelled) setCoverUrl(null);
            }
        };
        loadCover();
        return () => {
            cancelled = true;
            if (objectUrl) window.URL.revokeObjectURL(objectUrl);
        };
    }, [chatId, isAudio, rawCoverFileId, rawCoverUrl, token]);

    const startManualDownload = async () => {
        if (downloadState === 'done') return;
        if (downloadState === 'downloading') {
            downloadAbortRef.current?.abort();
            downloadAbortRef.current = null;
            setDownloadState('idle');
            setDownloadProgress(0);
            return;
        }

        setDownloadState('downloading');
        setDownloadProgress(0);
        const controller = new AbortController();
        downloadAbortRef.current = controller;

        try {
            const cachedOriginal = await getCachedBlob(mediaCacheKey);
            if (cachedOriginal) {
                const nextUrl = URL.createObjectURL(cachedOriginal);
                setFullMediaUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return nextUrl;
                });
                setDownloadProgress(100);
                setDownloadState('done');
                onMediaOpened?.();
                return;
            }

            const response = await fetch(`${API_BASE_URL}/files/${file.fileId}`, {
                credentials: 'omit',
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal,
            });
            if (!response.ok || !response.body) throw new Error('failed to download');
            const total = Number(response.headers.get('content-length') || 0);
            const reader = response.body.getReader();
            let loaded = 0;
            const chunks: Uint8Array[] = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    chunks.push(value);
                    loaded += value.byteLength;
                    if (total > 0) setDownloadProgress(Math.max(1, Math.min(99, Math.round((loaded / total) * 100))));
                }
            }
            const encryptedBytes = new Uint8Array(loaded);
            let offset = 0;
            for (const part of chunks) {
                encryptedBytes.set(part, offset);
                offset += part.byteLength;
            }
            const plainBytes = await decryptFileBytesClientSide(encryptedBytes, token, chatId);
            const blob = new Blob([toArrayBuffer(plainBytes)], { type: file.mimeType || 'application/octet-stream' });
            await getOrCacheBlob({ cacheKey: mediaCacheKey, loadBlob: async () => blob });
            const nextUrl = URL.createObjectURL(blob);
            setFullMediaUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return nextUrl;
            });
            setDownloadProgress(100);
            setDownloadState('done');
            onMediaOpened?.();
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                setDownloadState('idle');
                setDownloadProgress(0);
            }
        } finally {
            if (downloadAbortRef.current === controller) downloadAbortRef.current = null;
        }
    };

    const handleDownloadFileToDisk = async () => {
        try {
            if (downloadState !== 'done' || !fullMediaUrl) {
                await startManualDownload();
            }
            const blob = await getOrCacheBlob({
                cacheKey: mediaCacheKey,
                loadBlob: async () => fetchAndDecryptBlob(file.fileId, file.mimeType),
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.fileName;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch {
            alert('خطا در دانلود فایل');
        }
    };

    useEffect(() => {
        if (!onRegisterDownloadHandler) return;
        onRegisterDownloadHandler(handleDownloadFileToDisk);
        return () => onRegisterDownloadHandler(null);
    });

    useEffect(() => () => {
        if (fullMediaUrl) URL.revokeObjectURL(fullMediaUrl);
    }, [fullMediaUrl]);

    const overlayButton = (
        <button type="button" className="file-manual-download" onClick={(e) => { e.stopPropagation(); void startManualDownload(); }} style={circleStyle}>
            {downloadState === 'downloading' ? <X size={20} /> : <Download size={20} />}
        </button>
    );

    return (
        <div className="file-message">
            {isImage ? (
                <div className="file-image-preview" style={{ width: file.previewWidth || undefined, aspectRatio: file.previewWidth && file.previewHeight ? `${file.previewWidth}/${file.previewHeight}` : undefined }}>
                    {previewLoading ? <div className="file-loading file-loading--skeleton" /> : null}
                    {(previewUrl || fullMediaUrl) && (
                        <img
                            src={fullMediaUrl || previewUrl || ''}
                            alt={file.fileName}
                            className={fullMediaUrl ? 'file-image--ready' : 'file-image--blur'}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (fullMediaUrl) {
                                    onMediaOpened?.();
                                    onImageClick?.(fullMediaUrl, file);
                                }
                            }}
                        />
                    )}
                    {!fullMediaUrl && overlayButton}
                    {!fullMediaUrl && <div className="file-manual-size">{formatFileSize(file.fileSize)}</div>}
                </div>
            ) : isVideo ? (
                <div className="file-video-card" style={{ aspectRatio: file.previewWidth && file.previewHeight ? `${file.previewWidth}/${file.previewHeight}` : undefined }}>
                    {previewLoading ? <div className="file-loading file-loading--skeleton" /> : null}
                    {(previewUrl || fullMediaUrl) && (
                        <button
                            type="button"
                            className="file-video-thumb"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (fullMediaUrl) {
                                    onMediaOpened?.();
                                    onVideoClick?.(fullMediaUrl, file);
                                }
                            }}
                        >
                            <img src={fullMediaUrl || previewUrl || ''} className={fullMediaUrl ? 'file-image--ready' : 'file-image--blur'} alt={file.fileName} />
                            <span className="file-video-duration">{formatDuration(file.durationSec || 0)}</span>
                            {!fullMediaUrl && overlayButton}
                            {!fullMediaUrl && <div className="file-manual-size">{formatFileSize(file.fileSize)}</div>}
                        </button>
                    )}
                </div>
            ) : isAudio ? (
                <div className="file-audio-card">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (audioUrl) {
                                musicPlayer.playTrack({
                                    fileId: file.fileId,
                                    fileName: file.fileName,
                                    audioUrl,
                                    mimeType: file.mimeType,
                                    title: audioTitle || undefined,
                                    artist: audioArtist || undefined,
                                    coverArtUrl: coverUrl || undefined,
                                });
                            }
                        }}
                        disabled={audioLoading || audioError || !audioUrl}
                        style={{ width: 40, height: 40, borderRadius: '50%', background: isThisPlaying ? '#2F80ED' : 'rgba(47,128,237,0.12)', border: 'none', cursor: (audioLoading || audioError || !audioUrl) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isThisPlaying ? '#fff' : '#2F80ED', flexShrink: 0, transition: 'background 0.2s' }}
                        type="button"
                    >
                        {audioLoading ? <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #2F80ED', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} /> : isThisPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <div className="file-audio-cover" aria-hidden="true">
                        {coverUrl ? <img src={coverUrl} alt={displayAudioTitle} /> : <span>🎵</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="file-audio-title">{displayAudioTitle}</div>
                        <div className="file-audio-artist">{audioSubtitle}</div>
                    </div>
                    <button onClick={() => { void handleDownloadFileToDisk(); }} className="file-download-btn" type="button">
                        <Download size={18} />
                    </button>
                </div>
            ) : (
                <div className="file-attachment" onClick={() => { void handleDownloadFileToDisk(); }}>
                    <div className="file-icon">{getFileIcon(file.mimeType)}</div>
                    <div className="file-info">
                        <div className="file-name">{file.fileName}</div>
                        <div className="file-size">{formatFileSize(file.fileSize)}</div>
                    </div>
                    <button className="file-download-btn" type="button">
                        <Download size={18} />
                    </button>
                </div>
            )}
        </div>
    );
}
