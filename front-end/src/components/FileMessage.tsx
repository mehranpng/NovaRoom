import type { FileMetadata } from '../types';
import { formatFileSize, getFileIcon, isImageFile } from '../utils/fileUtils';
import { Play, Pause, Download, X, LockOpen } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { useState, useEffect, useRef } from 'react';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';
import { decryptFileBytesClientSide } from '../utils/e2ee';
import { getCachedBlob, getOrCacheBlob } from '../utils/mediaCache';

interface FileMessageProps { file: FileMetadata; token: string; chatId: string; onMediaLoad?: () => void; onImageClick?: (imageUrl: string, file: FileMetadata) => void; onVideoClick?: (videoUrl: string, file: FileMetadata) => void; }
type DownloadState = 'idle' | 'downloading' | 'decrypting' | 'done' | 'error';

type DownloadTask = {
  promise: Promise<Blob>;
  controller: AbortController;
  listeners: Set<(state: { status: DownloadState; progress?: number }) => void>;
};

const activeDownloadTasks = new Map<string, DownloadTask>();

export function FileMessage({ file, token, chatId, onMediaLoad, onImageClick, onVideoClick }: FileMessageProps) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [resolvedAudioDuration, setResolvedAudioDuration] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const musicPlayer = useMusicPlayer();
  const isImage = isImageFile(file.mimeType); const isAudio = (file.mimeType || '').startsWith('audio/'); const isVideo = (file.mimeType || '').startsWith('video/');
  const cacheKey = `chat:${chatId}:file:${file.fileId}`;
  const previewDirectUrl = String((file as any).previewUrl || (file as any).thumbUrl || (file as any).imagePreviewUrl || '').trim();
  const hasPreview = Boolean(previewDirectUrl);
  const formatDuration = (seconds: number): string => {
    const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };
  const mediaDuration = Number((file as any).duration || (file as any)?.meta?.duration || (file as any)?.metadata?.duration || 0);
  const audioTotalDuration = resolvedAudioDuration > 0 ? resolvedAudioDuration : mediaDuration;

  const decodeResponseBlob = async (response: Response): Promise<Blob> => {
    const encryptedBytes = new Uint8Array(await response.arrayBuffer());
    const plainBytes = await decryptFileBytesClientSide(encryptedBytes, token, chatId);
    const normalizedBytes = new Uint8Array(plainBytes);
    return new Blob([normalizedBytes], { type: file.mimeType || response.headers.get('content-type') || 'application/octet-stream' });
  };

  const ensureObjectUrl = async () => {
    const cached = await getCachedBlob(cacheKey);
    if (!cached) return false;
    const object = URL.createObjectURL(cached);
    setMediaUrl(object); setDownloadState('done'); onMediaLoad?.();
    return true;
  };

  const startDownload = async () => {
    if (downloadState === 'decrypting' || downloadState === 'downloading') return;

    const existingTask = activeDownloadTasks.get(cacheKey);
    if (existingTask) {
      abortRef.current = existingTask.controller;
      existingTask.listeners.add((state) => {
        if (state.progress != null) setDownloadProgress(state.progress);
        setDownloadState(state.status);
      });
      setDownloadState('downloading');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const listeners = new Set<(state: { status: DownloadState; progress?: number }) => void>();
    const emit = (state: { status: DownloadState; progress?: number }) => listeners.forEach((l) => l(state));

    setDownloadState('downloading');
    setDownloadProgress(6);
    const progressTimer = window.setInterval(() => {
      setDownloadProgress((prev) => {
        const next = Math.min(92, prev + 4);
        emit({ status: 'downloading', progress: next });
        return next;
      });
    }, 180);

    const taskPromise = (async () => {
      const res = await fetch(`${API_BASE_URL}/files/${file.fileId}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!res.ok) throw new Error('download failed');
      emit({ status: 'decrypting', progress: 100 });
      const blob = await decodeResponseBlob(res);
      return await getOrCacheBlob({ cacheKey, loadBlob: async () => blob });
    })();

    activeDownloadTasks.set(cacheKey, { promise: taskPromise, controller, listeners });

    try {
      const cached = await taskPromise;
      window.clearInterval(progressTimer);
      activeDownloadTasks.delete(cacheKey);
      const object = URL.createObjectURL(cached);
      setMediaUrl(object); setDownloadState('done'); setDownloadProgress(100); onMediaLoad?.();
    } catch {
      window.clearInterval(progressTimer);
      activeDownloadTasks.delete(cacheKey);
      if (controller.signal.aborted) setDownloadState('idle'); else setDownloadState('error');
    }
  };

  const cancelDownload = () => { abortRef.current?.abort(); };

  useEffect(() => {
    void ensureObjectUrl().then((cached) => {
      if (!cached && isImage && !hasPreview) {
        void startDownload();
      }
    });
  }, [cacheKey, isImage, hasPreview]);

  useEffect(() => {
    if (!isImage || !previewDirectUrl) return;
    let cancelled = false;
    const absolutePreviewUrl = previewDirectUrl.startsWith('http') ? previewDirectUrl : `${API_BASE_URL}${previewDirectUrl}`;
    getOrCacheBlob({
      cacheKey: `chat:${chatId}:preview:${file.fileId}`,
      loadBlob: async () => {
        const res = await fetch(absolutePreviewUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('preview load failed');
        return await res.blob();
      },
    }).then((blob) => {
      if (cancelled) return;
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl(nextUrl);
      const img = new Image();
      img.onload = () => {
        if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
          setPreviewAspectRatio(img.naturalWidth / img.naturalHeight);
        }
      };
      img.src = nextUrl;
      onMediaLoad?.();
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isImage, previewDirectUrl, token]);

  const actionIcon = downloadState === 'downloading' ? <X size={16} /> : downloadState === 'decrypting' ? <LockOpen size={16} /> : <Download size={16} />;

  useEffect(() => {
    const runningTask = activeDownloadTasks.get(cacheKey);
    if (runningTask) {
      const listener = (state: { status: DownloadState; progress?: number }) => {
        if (state.progress != null) setDownloadProgress(state.progress);
        setDownloadState(state.status);
      };
      runningTask.listeners.add(listener);
      void runningTask.promise.then(async () => {
        const cached = await getCachedBlob(cacheKey);
        if (!cached) return;
        setMediaUrl(URL.createObjectURL(cached));
        setDownloadState('done');
      }).catch(() => undefined);
      return () => { runningTask.listeners.delete(listener); };
    }

    setMediaUrl(null);
    setPreviewUrl(null);
    setPreviewAspectRatio(null);
    setDownloadState('idle');
    setDownloadProgress(0);
    setResolvedAudioDuration(0);
  }, [file.fileId]);

  const effectiveAspectRatio = Math.max(0.62, previewAspectRatio || 0.75);

  return <div className="file-message">
    {(isImage || isVideo) && (
      <div className="file-image-preview" style={{ background: isVideo ? '#000' : undefined, width: isImage || isVideo ? 'min(280px, 100%)' : undefined, aspectRatio: isImage ? effectiveAspectRatio : (isVideo ? 16 / 9 : undefined) }} onClick={(e) => { e.stopPropagation(); if (!mediaUrl) void startDownload(); }}>
        {mediaUrl ? (isImage ? <img src={mediaUrl} alt={file.fileName} onClick={() => onImageClick?.(mediaUrl, file)} /> : <button type="button" className="file-video-thumb" onClick={() => onVideoClick?.(mediaUrl, file)}><div style={{ width: '100%', height: '100%', background: '#000' }} /><span className="file-video-duration">{formatDuration(mediaDuration)}</span><span className="file-video-play-badge"><Play size={20} fill="currentColor" /></span></button>) :
          (<>
            {isImage && previewUrl ? <img src={previewUrl} alt="preview" style={{ filter: 'blur(4px)' }} /> : <div style={{ width: '100%', height: '100%', background: '#000' }} />}
            {isVideo && <button type="button" className="file-video-center-play" onClick={(e) => { e.stopPropagation(); startDownload(); }}><Play size={20} fill="currentColor" /></button>}
            {isVideo && <span className="file-video-duration file-video-duration--top">{formatDuration(mediaDuration || 0)}</span>}
            <div className={`manual-download-wrap ${isImage ? 'manual-download-wrap--center' : ''} ${isVideo ? 'manual-download-wrap--video' : ''}`}>
              <button type="button" className={`manual-download-btn ${downloadState === 'downloading' ? 'is-downloading' : ''} ${downloadState === 'decrypting' ? 'is-decrypting' : ''}`} style={{ ['--download-progress' as any]: `${downloadProgress}%` }} onClick={(e) => { e.stopPropagation(); if (downloadState === 'downloading') cancelDownload(); else startDownload(); }} disabled={downloadState === 'decrypting'}>{actionIcon}</button>
              <div className="manual-download-size manual-download-size-box">{isVideo ? (downloadState === 'decrypting' ? 'رمزگشایی' : formatFileSize(file.fileSize)) : (downloadState === 'decrypting' ? 'رمزگشایی' : formatFileSize(file.fileSize))}</div>
            </div>
          </>)}
      </div>
    )}

    {isAudio && <div className="file-audio-card">
      <button type="button" className={`manual-download-btn ${downloadState === 'downloading' ? 'is-downloading' : ''} ${downloadState === 'decrypting' ? 'is-decrypting' : ''}`} style={{ ['--download-progress' as any]: `${downloadProgress}%` }} onClick={(e) => {
        e.stopPropagation();
        if (!mediaUrl) {
          if (downloadState === 'downloading') cancelDownload(); else startDownload();
          return;
        }
        musicPlayer.playTrack({ fileId: file.fileId, fileName: file.fileName, audioUrl: mediaUrl, mimeType: file.mimeType });
      }}>{mediaUrl ? (musicPlayer.isPlaying && musicPlayer.track?.fileId === file.fileId ? <Pause size={16} /> : <Play size={16} />) : actionIcon}</button>
      <div style={{ flex: 1 }}><div className="file-audio-title">{file.fileName}</div><div className="file-audio-artist">{mediaUrl ? formatDuration(audioTotalDuration) : `${formatFileSize(file.fileSize)} • ${formatDuration(audioTotalDuration)}`}</div></div>
      {mediaUrl && (
        <audio
          src={mediaUrl}
          preload="metadata"
          style={{ display: 'none' }}
          onLoadedMetadata={(e) => {
            const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0;
            if (d > 0) setResolvedAudioDuration(d);
          }}
        />
      )}
    </div>}

    {!isImage && !isVideo && !isAudio && <div className="file-attachment"><div className="file-icon">{getFileIcon(file.mimeType)}</div><div className="file-info"><div className="file-name">{file.fileName}</div><div className="file-size">{formatFileSize(file.fileSize)}</div></div></div>}
  </div>;
}
