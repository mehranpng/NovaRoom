import type { FileMetadata } from '../types';
import { formatFileSize, getFileIcon, isImageFile } from '../utils/fileUtils';
import { Download, Play, Pause } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { useState, useEffect, useRef } from 'react';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';

interface FileMessageProps {
    file: FileMetadata;
    token: string;
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

export function FileMessage({ file, token, onMediaLoad, onImageClick, onVideoClick }: FileMessageProps) {
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
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const musicPlayer = useMusicPlayer();
    const isImage = isImageFile(file.mimeType);
    const isAudio = (file.mimeType || '').startsWith('audio/');
    const isVideo = (file.mimeType || '').startsWith('video/');
    const isCurrentTrack = musicPlayer.track?.fileId === file.fileId;
    const isThisPlaying = isCurrentTrack && musicPlayer.isPlaying;

    useEffect(() => {
        if (!isImage) return;
        let objectUrl: string | null = null;
        let cancelled = false;
        const loadImage = async () => {
            try {
                setImageLoading(true);
                setImageError(false);
                const response = await fetch(`${API_BASE_URL}/files/${file.fileId}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });
                if (!response.ok) throw new Error('Failed to load image');
                const blob = await response.blob();
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
    }, [file.fileId, token, isImage]);

    useEffect(() => {
        if (!isAudio) return;
        let objectUrl: string | null = null;
        let cancelled = false;
        const loadAudio = async () => {
            try {
                setAudioLoading(true);
                setAudioError(false);
                const response = await fetch(`${API_BASE_URL}/files/${file.fileId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!response.ok) throw new Error('Failed to load audio');
                const blob = await response.blob();
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
    }, [file.fileId, isAudio, token]);

    // Load video with auth header
    useEffect(() => {
        if (!isVideo) return;
        let objectUrl: string | null = null;
        let cancelled = false;
        const loadVideo = async () => {
            try {
                setVideoLoading(true);
                setVideoError(false);
                const response = await fetch(`${API_BASE_URL}/files/${file.fileId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!response.ok) throw new Error('Failed to load video');
                const blob = await response.blob();
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
    }, [file.fileId, isVideo, token]);

    const handleDownload = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/files/${file.fileId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!response.ok) throw new Error('Download failed');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Error downloading file:', error);
            alert('خطا در دانلود فایل');
        }
    };

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
                    <div className="file-image-overlay">
                        <button onClick={handleDownload} className="file-download-btn">
                            <Download size={20} />
                        </button>
                    </div>
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
                <div className="file-audio-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', minWidth: 200 }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (audioUrl) {
                                musicPlayer.playTrack({ fileId: file.fileId, fileName: file.fileName, audioUrl, mimeType: file.mimeType });
                            }
                        }}
                        disabled={audioLoading || audioError || !audioUrl}
                        style={{
                            width: 40, height: 40,
                            borderRadius: '50%',
                            background: isThisPlaying ? '#2F80ED' : 'rgba(47,128,237,0.12)',
                            border: 'none',
                            cursor: (audioLoading || audioError || !audioUrl) ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: isThisPlaying ? '#fff' : '#2F80ED',
                            flexShrink: 0,
                            transition: 'background 0.2s',
                        }}
                        type="button"
                    >
                        {audioLoading ? (
                            <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #2F80ED', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                        ) : isThisPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🎵 {file.fileName}</div>
                        {audioError && <div style={{ fontSize: 11, color: '#e55' }}>پخش ممکن نشد</div>}
                        {isCurrentTrack && musicPlayer.duration > 0 && (
                            <div style={{ fontSize: 11, color: '#888' }}>
                                {Math.floor(musicPlayer.currentTime / 60)}:{Math.floor(musicPlayer.currentTime % 60).toString().padStart(2, '0')} / {Math.floor(musicPlayer.duration / 60)}:{Math.floor(musicPlayer.duration % 60).toString().padStart(2, '0')}
                            </div>
                        )}
                    </div>
                    <button onClick={handleDownload} className="file-download-btn" type="button">
                        <Download size={18} />
                    </button>
                </div>
            ) : (
                <div className="file-attachment" onClick={handleDownload}>
                    <div className="file-icon">{getFileIcon(file.mimeType)}</div>
                    <div className="file-info">
                        <div className="file-name">{file.fileName}</div>
                        <div className="file-size">{formatFileSize(file.fileSize)}</div>
                    </div>
                    <button className="file-download-btn">
                        <Download size={18} />
                    </button>
                </div>
            )}
        </div>
    );
}
