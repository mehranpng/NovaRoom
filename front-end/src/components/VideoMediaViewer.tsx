import { useEffect, useRef, useState } from 'react';
import { Download, Pause, Play, X } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import type { FileMetadata } from '../types';

interface VideoMediaViewerProps {
    videoUrl: string;
    onClose: () => void;
    downloadFile?: Pick<FileMetadata, 'fileId' | 'fileName'> | null;
    token?: string;
}

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function VideoMediaViewer({ videoUrl, onClose, downloadFile, token = '' }: VideoMediaViewerProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hideControlsTimerRef = useRef<number | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [showControls, setShowControls] = useState(true);

    const resetHideTimer = () => {
        if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current);
        if (isPlaying) {
            hideControlsTimerRef.current = window.setTimeout(() => {
                setShowControls(false);
            }, 1600);
        }
    };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === ' ') {
                e.preventDefault();
                const video = videoRef.current;
                if (!video) return;
                if (video.paused) void video.play();
                else video.pause();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    useEffect(() => {
        resetHideTimer();
        return () => {
            if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPlaying]);

    const seekBy = (delta: number) => {
        const video = videoRef.current;
        if (!video) return;
        const next = Math.min(Math.max(0, video.currentTime + delta), video.duration || 0);
        video.currentTime = next;
        setCurrentTime(next);
        setShowControls(true);
        resetHideTimer();
    };

    const togglePlay = async () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            await video.play();
        } else {
            video.pause();
        }
        setShowControls(true);
        resetHideTimer();
    };

    const handleDownload = async () => {
        try {
            const response = downloadFile?.fileId
                ? await fetch(`${API_BASE_URL}/files/${downloadFile.fileId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                : await fetch(videoUrl);
            if (!response.ok) throw new Error('Download failed');
            const blob = await response.blob();
            const extension = blob.type.split('/')[1] || 'mp4';
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = downloadFile?.fileName || `video.${extension}`;
            document.body.appendChild(link);
            link.click();
            window.URL.revokeObjectURL(url);
            link.remove();
        } catch (error) {
            console.error('Error downloading video:', error);
            alert('خطا در دانلود ویدیو');
        }
    };

    return (
        <div
            className="video-media-viewer"
            role="dialog"
            aria-modal="true"
            onMouseMove={() => {
                setShowControls(true);
                resetHideTimer();
            }}
        >
            <div className="video-media-viewer__header">
                <button type="button" className="image-media-viewer__btn" onClick={handleDownload} aria-label="Download video">
                    <Download size={18} />
                </button>
                <button type="button" className="image-media-viewer__btn image-media-viewer__btn--close" onClick={onClose} aria-label="Close">
                    <X size={18} />
                </button>
            </div>

            <div className="video-media-viewer__stage">
                <video
                    ref={videoRef}
                    src={videoUrl}
                    className="video-media-viewer__video"
                    playsInline
                    onClick={() => {
                        if (!isPlaying) return;
                        videoRef.current?.pause();
                        setShowControls(true);
                    }}
                    onPlay={() => {
                        setIsPlaying(true);
                        resetHideTimer();
                    }}
                    onPause={() => {
                        setIsPlaying(false);
                        setShowControls(true);
                    }}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                    onEnded={() => {
                        setIsPlaying(false);
                        setShowControls(true);
                    }}
                />

                <button type="button" className="video-media-viewer__seek video-media-viewer__seek--left" onDoubleClick={() => seekBy(-5)} aria-label="Seek backward 5 seconds" />
                <button type="button" className="video-media-viewer__seek video-media-viewer__seek--right" onDoubleClick={() => seekBy(5)} aria-label="Seek forward 5 seconds" />

                <div className={`video-media-viewer__overlay ${showControls ? 'is-visible' : ''}`}>
                    <button type="button" className="video-media-viewer__play-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
                        {isPlaying ? <Pause size={28} /> : <Play size={28} />}
                    </button>
                </div>
            </div>

            <div className={`video-media-viewer__timeline-wrap ${showControls ? 'is-visible' : ''}`}>
                <div className="video-media-viewer__timeline-time">
                    <span>{formatDuration(currentTime)}</span>
                    <span>{formatDuration(duration)}</span>
                </div>
                <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    value={Math.min(currentTime, duration || 0)}
                    step={0.1}
                    className="video-media-viewer__timeline"
                    onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) return;
                        if (videoRef.current) videoRef.current.currentTime = next;
                        setCurrentTime(next);
                        setShowControls(true);
                        resetHideTimer();
                    }}
                />
            </div>
        </div>
    );
}
