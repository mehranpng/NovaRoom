import { useEffect, useRef, useState } from 'react';
import { ChevronsLeft, ChevronsRight, Download, Maximize, Minimize, Pause, Play, X } from 'lucide-react';
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
    const containerRef = useRef<HTMLDivElement | null>(null);
    const clickTimeoutRef = useRef<number | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [seekFeedback, setSeekFeedback] = useState<null | { delta: 5 | -5; side: 'left' | 'right'; id: number }>(null);
    const playbackControlsVisible = !isPlaying;

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
        const video = videoRef.current;
        if (!video) return;
        void video.play().catch(() => {
            // autoplay may fail without user gesture; keep paused controls visible
        });
    }, []);

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        };

        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);

    useEffect(() => {
        return () => {
            if (clickTimeoutRef.current !== null) {
                window.clearTimeout(clickTimeoutRef.current);
                clickTimeoutRef.current = null;
            }
        };
    }, []);

    const seekBy = (delta: number) => {
        const video = videoRef.current;
        if (!video) return false;
        const durationSafe = Number.isFinite(video.duration) ? video.duration : 0;
        if (durationSafe <= 0) return false;
        const current = video.currentTime;
        const atStart = current <= 0.05;
        const atEnd = durationSafe - current <= 0.05;
        if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return false;

        const next = Math.min(Math.max(0, current + delta), durationSafe);
        if (Math.abs(next - current) < 0.001) return false;
        video.currentTime = next;
        setCurrentTime(next);
        setSeekFeedback({ delta: delta > 0 ? 5 : -5, side: delta > 0 ? 'right' : 'left', id: Date.now() });
        return true;
    };

    const toggleFullscreen = async () => {
        if (document.fullscreenElement === containerRef.current) {
            await document.exitFullscreen();
            return;
        }
        if (containerRef.current) {
            await containerRef.current.requestFullscreen();
        }
    };

    const togglePlay = async () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            await video.play();
        } else {
            video.pause();
        }
    };

    const handleSurfaceClick = () => {
        if (clickTimeoutRef.current !== null) window.clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = window.setTimeout(async () => {
            const video = videoRef.current;
            if (!video) return;
            if (video.paused) {
                await video.play();
            } else {
                video.pause();
            }
            clickTimeoutRef.current = null;
        }, 220);
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
        >
            <div className="video-media-viewer__header">
                <button type="button" className="image-media-viewer__btn" onClick={handleDownload} aria-label="Download video">
                    <Download size={18} />
                </button>
                <button type="button" className="image-media-viewer__btn image-media-viewer__btn--close" onClick={onClose} aria-label="Close">
                    <X size={18} />
                </button>
            </div>
            <div className="video-media-viewer__stage" ref={containerRef}>
                <div
                    className="video-media-viewer__surface"
                    onClick={handleSurfaceClick}
                >
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className="video-media-viewer__video"
                        playsInline
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                        onEnded={() => setIsPlaying(false)}
                    />

                    <button
                        type="button"
                        className="video-media-viewer__seek video-media-viewer__seek--left"
                        onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (clickTimeoutRef.current !== null) {
                                window.clearTimeout(clickTimeoutRef.current);
                                clickTimeoutRef.current = null;
                            }
                            seekBy(-5);
                        }}
                        aria-label="Seek backward 5 seconds"
                    />
                    <button
                        type="button"
                        className="video-media-viewer__seek video-media-viewer__seek--right"
                        onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (clickTimeoutRef.current !== null) {
                                window.clearTimeout(clickTimeoutRef.current);
                                clickTimeoutRef.current = null;
                            }
                            seekBy(5);
                        }}
                        aria-label="Seek forward 5 seconds"
                    />
                    {seekFeedback && (
                        <div
                            key={seekFeedback.id}
                            className={`video-media-viewer__seek-feedback video-media-viewer__seek-feedback--${seekFeedback.side}`}
                            onAnimationEnd={() => setSeekFeedback(null)}
                        >
                            {seekFeedback.delta > 0 ? <ChevronsRight size={34} /> : <ChevronsLeft size={34} />}
                            <span>{seekFeedback.delta > 0 ? '+5' : '-5'}</span>
                        </div>
                    )}
                </div>

                <div className={`video-media-viewer__controls ${playbackControlsVisible ? 'is-visible' : ''}`}>
                    <div className="video-media-viewer__overlay">
                        <button type="button" className="video-media-viewer__play-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
                            {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
                        </button>
                    </div>

                    <div className="video-media-viewer__timeline-wrap">
                        <div className="video-media-viewer__timeline-meta">
                            <div className="video-media-viewer__timeline-time">
                                <span>{formatDuration(currentTime)}</span>
                                <span>{formatDuration(duration)}</span>
                            </div>
                            <button
                                type="button"
                                className="video-media-viewer__fullscreen-btn"
                                onClick={toggleFullscreen}
                                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                            >
                                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                            </button>
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
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
