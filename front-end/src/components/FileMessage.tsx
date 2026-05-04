import type { FileMetadata } from '../types';
import { formatFileSize, getFileIcon, isImageFile } from '../utils/fileUtils';
import { Play, Pause } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { useState, useEffect, useRef } from 'react';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';
import { decryptFileBytesClientSide } from '../utils/e2ee';
import { getOrCacheBlob } from '../utils/mediaCache';

interface FileMessageProps {
    file: FileMetadata;
    token: string;
    chatId: string;
    onMediaLoad?: () => void;
    onImageClick?: (imageUrl: string, file: FileMetadata) => void;
    onVideoClick?: (videoUrl: string, file: FileMetadata) => void;
}

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function FileMessage({ file, token, chatId, onMediaLoad, onImageClick, onVideoClick }: FileMessageProps) {
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageLoading, setImageLoading] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioLoading, setAudioLoading] = useState(false);
    const [audioError, setAudioError] = useState(false);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [videoLoading, setVideoLoading] = useState(false);
    const [videoError, setVideoError] = useState(false);
    const [videoDuration, setVideoDuration] = useState(0);
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const musicPlayer = useMusicPlayer();
    const isImage = isImageFile(file.mimeType);
    const isAudio = (file.mimeType || '').startsWith('audio/');
    const isVideo = (file.mimeType || '').startsWith('video/');
    const isCurrentTrack = musicPlayer.track?.fileId === file.fileId;
    const isThisPlaying = isCurrentTrack && musicPlayer.isPlaying;
    const rawTitle = String(file.title || (file as any)?.meta?.title || (file as any)?.metadata?.title || '').trim();
    const rawArtist = String(file.artist || (file as any)?.meta?.artist || (file as any)?.metadata?.artist || '').trim();
    const displayAudioTitle = rawTitle || file.fileName;
    const audioArtist = rawArtist || 'Unknown';
    const audioSubtitle = audioArtist;
    const rawCoverFileId = (file as any).coverArtFileId || (file as any)?.meta?.coverArtFileId || (file as any)?.metadata?.coverArtFileId;
    const rawCoverUrl = (file.coverArtUrl || (file as any).coverUrl || (file as any)?.meta?.coverArtUrl || (file as any)?.metadata?.coverArtUrl || '').trim();
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
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to load media file');
        return decodeResponseBlob(response, preferredType);
    };

    useEffect(() => {
        if (!isImage) return;
        let objectUrl: string | null = null;
        let cancelled = false;
        const loadImage = async () => {
            try {
                setImageLoading(true);
                setImageError(false);
                const blob = await getOrCacheBlob({
                    cacheKey: `chat:${chatId}:file:${file.fileId}`,
                    loadBlob: async () => fetchAndDecryptBlob(file.fileId, file.mimeType),
                });
                if (!cancelled) {
                    objectUrl = window.URL.createObjectURL(blob);
                    setImageUrl(objectUrl);
                }
            } catch (error) {
                console.error('Failed to load image:', error);
                if (!cancelled) {
                    setImageError(true);
                    onMediaLoad?.();
                }
            } finally {
                if (!cancelled) setImageLoading(false);
            }
        };
        loadImage();
        return () => {
            cancelled = true;
            if (objectUrl) window.URL.revokeObjectURL(objectUrl);
        };
    }, [chatId, file.fileId, file.mimeType, token, isImage]);

    useEffect(() => {
        if (!isAudio) return;
        let objectUrl: string | null = null;
        let cancelled = false;
        const loadAudio = async () => {
            try {
                setAudioLoading(true);
                setAudioError(false);
                const blob = await getOrCacheBlob({
                    cacheKey: `chat:${chatId}:file:${file.fileId}`,
                    loadBlob: async () => fetchAndDecryptBlob(file.fileId, file.mimeType),
                });
                if (!cancelled) {
                    objectUrl = window.URL.createObjectURL(blob);
                    setAudioUrl(objectUrl);
                }
            } catch (error) {
                console.error('Failed to load audio:', error);
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

    // Load video with auth header
    useEffect(() => {
        if (!isVideo) return;
        let objectUrl: string | null = null;
        let cancelled = false;
        const loadVideo = async () => {
            try {
                setVideoLoading(true);
                setVideoError(false);
                const blob = await getOrCacheBlob({
                    cacheKey: `chat:${chatId}:file:${file.fileId}`,
                    loadBlob: async () => fetchAndDecryptBlob(file.fileId, file.mimeType),
                });
                if (!cancelled) {
                    objectUrl = window.URL.createObjectURL(blob);
                    setVideoUrl(objectUrl);
                    setVideoDuration(0);
                }
            } catch (error) {
                console.error('Failed to load video:', error);
                if (!cancelled) {
                    setVideoError(true);
                    onMediaLoad?.();
                }
            } finally {
                if (!cancelled) setVideoLoading(false);
            }
        };
        loadVideo();
        return () => {
            cancelled = true;
            if (objectUrl) window.URL.revokeObjectURL(objectUrl);
        };
    }, [chatId, file.fileId, file.mimeType, isVideo, token]);



    return (
        <div className="file-message">
            {isImage ? (
                <div className="file-image-preview">
                    {imageLoading ? (
                        <div className="file-loading" style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="spinner" />
                        </div>
                    ) : imageError || !imageUrl ? (
                        <div className="file-error" style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px' }}>
                            <span>⚠️</span>
                            <span style={{ fontSize: '12px' }}>خطا در بارگذاری تصویر</span>
                        </div>
                    ) : (
                        <img
                            src={imageUrl}
                            alt={file.fileName}
                            onClick={(e) => {
                                e.stopPropagation();
                                onImageClick?.(imageUrl, file);
                            }}
                            style={{ cursor: 'zoom-in' }}
                            onLoad={onMediaLoad}
                        />
                    )}
                </div>
            ) : isVideo ? (
                <div className="file-video-card">
                    {videoLoading ? (
                        <div style={{ minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="spinner" />
                        </div>
                    ) : videoError || !videoUrl ? (
                        <div style={{ minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                            <span>⚠️</span>
                            <span style={{ fontSize: 12 }}>خطا در بارگذاری ویدیو</span>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="file-video-thumb"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (videoUrl) onVideoClick?.(videoUrl, file);
                            }}
                        >
                            <video
                                ref={videoRef}
                                src={videoUrl}
                                className="file-video-player"
                                preload="metadata"
                                playsInline
                                muted
                                onLoadedMetadata={(e) => {
                                    setVideoDuration(e.currentTarget.duration || 0);
                                    onMediaLoad?.();
                                }}
                            />
                            <span className="file-video-duration">{formatDuration(videoDuration)}</span>
                            <span className="file-video-play-badge" aria-hidden="true">
                                <Play size={20} fill="currentColor" />
                            </span>
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
                                    title: rawTitle || undefined,
                                    artist: audioArtist || undefined,
                                    coverArtUrl: coverUrl || undefined,
                                });
                            }
                        }}
                        disabled={audioLoading || audioError || !audioUrl}
                        style={{
                            width: 40, height: 40,
                            borderRadius: '50%',
                            background: isThisPlaying ? 'var(--accent-primary)' : 'color-mix(in srgb, var(--accent-primary) 16%, transparent)',
                            border: 'none',
                            cursor: (audioLoading || audioError || !audioUrl) ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: isThisPlaying ? '#fff' : 'var(--accent-primary)',
                            flexShrink: 0,
                            transition: 'background 0.2s',
                        }}
                        type="button"
                    >
                        {audioLoading ? (
                            <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--accent-primary)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                        ) : isThisPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <div className="file-audio-cover" aria-hidden="true">
                        {coverUrl ? <img src={coverUrl} alt={displayAudioTitle} /> : <span>🎵</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="file-audio-title">{displayAudioTitle}</div>
                        <div className="file-audio-artist">{audioSubtitle}</div>
                        {audioError && <div style={{ fontSize: 11, color: '#e55' }}>پخش ممکن نشد</div>}
                        <div style={{ fontSize: 11, color: 'inherit', opacity: 0.78 }}>
                            {isCurrentTrack ? `${formatDuration(musicPlayer.currentTime)} / ` : ''}{formatDuration(musicPlayer.duration || Number((file as any)?.duration || 0))}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="file-attachment">
                    <div className="file-icon">{getFileIcon(file.mimeType)}</div>
                    <div className="file-info">
                        <div className="file-name">{file.fileName}</div>
                        <div className="file-size">{formatFileSize(file.fileSize)}</div>
                    </div>
                </div>
            )}
        </div>
    );
}
