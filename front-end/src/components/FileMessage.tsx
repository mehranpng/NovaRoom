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
type DownloadSubscriber = (state: DownloadState, progress: number) => void;
type DownloadTask = {
  subscribers: Set<DownloadSubscriber>;
  state: DownloadState;
  progress: number;
  promise: Promise<void> | null;
  blob?: Blob | null;
  abortController?: AbortController | null;
};
const fileDownloadTasks = new Map<string, DownloadTask>();

export function FileMessage({ file, token, chatId, onMediaLoad, onImageClick, onVideoClick }: FileMessageProps) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [resolvedAudioDuration, setResolvedAudioDuration] = useState(0);
  const pendingOpenAfterDownloadRef = useRef(false);
  const musicPlayer = useMusicPlayer();
  const isImage = isImageFile(file.mimeType); const isAudio = (file.mimeType || '').startsWith('audio/'); const isVideo = (file.mimeType || '').startsWith('video/');
  const cacheKey = `chat:${chatId}:file:${file.fileId}`;
  const previewDirectUrl = String((file as any).previewUrl || (file as any).thumbUrl || (file as any).imagePreviewUrl || '').trim();
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

  const startDownload = async (openAfterDownload = false) => {
    if (downloadState === 'decrypting' || downloadState === 'downloading') return;
    if (openAfterDownload && isImage) pendingOpenAfterDownloadRef.current = true;
    const taskKey = file.fileId;
    const subscriber: DownloadSubscriber = (state, progress) => { setDownloadState(state); setDownloadProgress(progress); };
    const notify = (task: DownloadTask) => task.subscribers.forEach((fn) => fn(task.state, task.progress));
    let task = fileDownloadTasks.get(taskKey);
    if (!task) {
      task = { subscribers: new Set(), state: 'idle', progress: 0, promise: null, blob: null };
      fileDownloadTasks.set(taskKey, task);
    }
    task.subscribers.add(subscriber);
    setDownloadState(task.state);
    setDownloadProgress(task.progress);
    if (!task.promise) {
      task.abortController = new AbortController();
      task.state = 'downloading'; task.progress = 6; notify(task);
      task.promise = (async () => {
        const progressTimer = window.setInterval(() => {
          task!.progress = Math.min(92, task!.progress + 4); notify(task!);
        }, 180);
        try {
          const res = await fetch(`${API_BASE_URL}/files/${file.fileId}`, { headers: { Authorization: `Bearer ${token}` }, signal: task!.abortController?.signal });
          if (!res.ok) throw new Error('download failed');
          window.clearInterval(progressTimer);
          task!.progress = 100; task!.state = 'decrypting'; notify(task!);
          const blob = await decodeResponseBlob(res);
          task!.blob = blob;
          await getOrCacheBlob({ cacheKey, loadBlob: async () => blob });
          task!.state = 'done'; notify(task!);
        } catch {
          window.clearInterval(progressTimer);
          task!.state = task!.abortController?.signal.aborted ? 'idle' : 'error'; notify(task!);
        } finally {
          task!.promise = null;
          task!.abortController = null;
        }
      })();
    }
    await task.promise;
    const finalBlob = task.blob || await getCachedBlob(cacheKey);
    if (finalBlob) {
      const object = URL.createObjectURL(finalBlob);
      setMediaUrl(object); setDownloadState('done'); onMediaLoad?.();
      if (pendingOpenAfterDownloadRef.current && isImage) {
        pendingOpenAfterDownloadRef.current = false;
        onImageClick?.(object, file);
      }
    }
  };

  const cancelDownload = () => {
    const task = fileDownloadTasks.get(file.fileId);
    task?.abortController?.abort();
  };

  useEffect(() => {
    void ensureObjectUrl().then((cached) => {
      if (!cached) setDownloadState('idle');
    });
  }, [cacheKey]);

  useEffect(() => {
    const taskKey = file.fileId;
    const task = fileDownloadTasks.get(taskKey);
    if (!task) return;
    const subscriber: DownloadSubscriber = (state, progress) => { setDownloadState(state); setDownloadProgress(progress); };
    task.subscribers.add(subscriber);
    setDownloadState(task.state);
    setDownloadProgress(task.progress);
    return () => { task.subscribers.delete(subscriber); };
  }, [chatId, file.fileId]);

  useEffect(() => {
    if (!(isImage || isVideo) || !previewDirectUrl) return;
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
  }, [isImage, isVideo, previewDirectUrl, token, chatId, file.fileId]);

  const actionIcon = downloadState === 'downloading' ? <X size={16} /> : downloadState === 'decrypting' ? <LockOpen size={16} /> : <Download size={16} />;

  useEffect(() => {
    setMediaUrl(null);
    setPreviewUrl(null);
    setPreviewAspectRatio(null);
    setResolvedAudioDuration(0);
  }, [file.fileId]);

  const metadataWidth = Number((file as any)?.meta?.width || (file as any)?.metadata?.width || (file as any)?.width || 0);
  const metadataHeight = Number((file as any)?.meta?.height || (file as any)?.metadata?.height || (file as any)?.height || 0);
  const metadataAspectRatio = metadataWidth > 0 && metadataHeight > 0 ? (metadataWidth / metadataHeight) : null;
  const fallbackRatio = isVideo ? (16 / 9) : 0.75;
  const effectiveAspectRatio = Math.max(0.35, Math.min(2.4, previewAspectRatio || metadataAspectRatio || fallbackRatio));
  const shouldContain = effectiveAspectRatio < 0.5 || effectiveAspectRatio > 2.05;

  return <div className="file-message">
    {(isImage || isVideo) && (
      <div className="file-image-preview" style={{ background: '#000', width: isImage ? undefined : '100%', minWidth: isVideo ? 220 : undefined, maxWidth: '100%', aspectRatio: (isImage || isVideo) ? effectiveAspectRatio : undefined }} onClick={(e) => { e.stopPropagation(); if (!mediaUrl && downloadState !== 'decrypting' && downloadState !== 'downloading') void startDownload(false); }}>
        {mediaUrl ? (isImage ? <img src={mediaUrl} alt={file.fileName} style={{ objectFit: shouldContain ? 'contain' : 'cover' }} onClick={() => onImageClick?.(mediaUrl, file)} /> : <button type="button" className="file-video-thumb" onClick={() => onVideoClick?.(mediaUrl, file)}><video src={mediaUrl} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: shouldContain ? 'contain' : 'cover', background: '#000' }} /><span className="file-video-duration">{formatDuration(mediaDuration)}</span><span className="file-video-play-badge"><Play size={20} fill="currentColor" /></span></button>) :
          (<>
            {previewUrl ? <img src={previewUrl} alt="preview" style={{ filter: 'blur(4px)', objectFit: shouldContain ? 'contain' : 'cover' }} /> : <div style={{ width: '100%', height: '100%', background: '#000' }} />}
            {isVideo && <button type="button" className="file-video-center-play" onClick={(e) => { e.stopPropagation(); startDownload(); }}><Play size={20} fill="currentColor" /></button>}
            {isVideo && <span className="file-video-duration file-video-duration--top">{formatDuration(mediaDuration || 0)}</span>}
            <div className={`manual-download-wrap ${isImage ? 'manual-download-wrap--center' : ''} ${isVideo ? 'manual-download-wrap--video' : ''}`}>
              <button type="button" className={`manual-download-btn ${downloadState === 'downloading' ? 'is-downloading' : ''} ${downloadState === 'decrypting' ? 'is-decrypting' : ''}`} style={{ ['--download-progress' as any]: `${downloadProgress}%` }} onClick={(e) => { e.stopPropagation(); if (downloadState === 'decrypting') return; if (downloadState === 'downloading') cancelDownload(); else startDownload(); }}>{actionIcon}</button>
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
