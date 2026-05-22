import type { FileMetadata } from '../types';
import { formatFileSize, getFileIcon, isImageFile } from '../utils/fileUtils';
import { Play, Pause, Download, X, LockOpen } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { useState, useEffect } from 'react';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';
import { decryptFileBytesClientSide } from '../utils/e2ee';
import { getCachedBlob, getOrCacheBlob } from '../utils/mediaCache';
import { autoDownloadCookieKeys, isAutoDownloadEnabled } from '../utils/autoDownloadPrefs';

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
  const [cacheChecked, setCacheChecked] = useState(false);
  const [resolvedAudioDuration, setResolvedAudioDuration] = useState(0);
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
    // Also clear preview cache if we have the full image
    void deleteCachedBlob(`chat:${chatId}:preview:${file.fileId}`);
    return true;
  };

  const startDownload = async () => {
    if (downloadState === 'decrypting' || downloadState === 'downloading') return;
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
          // Clear preview cache since we now have the full image
          void deleteCachedBlob(`chat:${chatId}:preview:${file.fileId}`);
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
    }
  };

  const cancelDownload = () => {
    const task = fileDownloadTasks.get(file.fileId);
    task?.abortController?.abort();
  };

  useEffect(() => {
    setCacheChecked(false);
    const activeTask = fileDownloadTasks.get(file.fileId);
    if (activeTask && (activeTask.state === 'downloading' || activeTask.state === 'decrypting')) {
      setDownloadState(activeTask.state);
      setDownloadProgress(activeTask.progress);
      setCacheChecked(true);
      return;
    }
    void ensureObjectUrl().then((cached) => {
      if (!cached) {
        const latestTask = fileDownloadTasks.get(file.fileId);
        if (latestTask && (latestTask.state === 'downloading' || latestTask.state === 'decrypting')) {
          setDownloadState(latestTask.state);
          setDownloadProgress(latestTask.progress);
          return;
        }
        setDownloadState('idle');
      }
      setCacheChecked(true);
    });
  }, [cacheKey, file.fileId]);

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
    if (!cacheChecked || mediaUrl || downloadState === 'downloading' || downloadState === 'decrypting' || downloadState === 'done') return;
    const shouldAutoDownload = (isImage && isAutoDownloadEnabled(autoDownloadCookieKeys.image))
      || (isVideo && isAutoDownloadEnabled(autoDownloadCookieKeys.video))
      || (isAudio && isAutoDownloadEnabled(autoDownloadCookieKeys.audio));
    if (shouldAutoDownload) void startDownload();
  }, [cacheChecked, mediaUrl, downloadState, isImage, isVideo, isAudio]);

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
    return () => { 
      cancelled = true; 
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [isImage, isVideo, previewDirectUrl, token, chatId, file.fileId]);

  const actionIcon = downloadState === 'downloading' ? <X size={16} /> : downloadState === 'decrypting' ? <LockOpen size={16} /> : <Download size={16} />;

  useEffect(() => {
    const oldMediaUrl = mediaUrl;
    const oldPreviewUrl = previewUrl;
    
    setMediaUrl(null);
    setPreviewUrl(null);
    setPreviewAspectRatio(null);
    setResolvedAudioDuration(0);

    return () => {
      if (oldMediaUrl && oldMediaUrl.startsWith('blob:')) URL.revokeObjectURL(oldMediaUrl);
      if (oldPreviewUrl && oldPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(oldPreviewUrl);
    };
  }, [file.fileId]);

  const metadataWidth = Number((file as any)?.meta?.width || (file as any)?.metadata?.width || (file as any)?.width || 0);
  const metadataHeight = Number((file as any)?.meta?.height || (file as any)?.metadata?.height || (file as any)?.height || 0);
  const metadataAspectRatio = metadataWidth > 0 && metadataHeight > 0 ? (metadataWidth / metadataHeight) : null;
  const fallbackRatio = isVideo ? (16 / 9) : 0.75;
  const rawAspectRatio = previewAspectRatio || metadataAspectRatio || fallbackRatio;
  const effectiveAspectRatio = isImage
    ? Math.max(0.62, Math.min(1.8, rawAspectRatio))
    : Math.max(0.35, Math.min(2.4, rawAspectRatio));
  const shouldContain = isVideo && (effectiveAspectRatio < 0.5 || effectiveAspectRatio > 2.05);

  useEffect(() => {
    if (isImage || isVideo || isAudio) return;

    const onCustomDownload = async (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.fileId === file.fileId) {
        const taskKey = file.fileId;
        let task = fileDownloadTasks.get(taskKey);
        
        if (!task || (task.state !== 'downloading' && task.state !== 'decrypting' && task.state !== 'done')) {
          await startDownload();
          task = fileDownloadTasks.get(taskKey);
        }
        
        if (task && task.promise) {
          await task.promise;
        }

        const finalBlob = await getCachedBlob(cacheKey);
        if (finalBlob) {
          const url = URL.createObjectURL(finalBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.fileName || 'file';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
      }
    };

    window.addEventListener('trigger-file-download', onCustomDownload);
    return () => window.removeEventListener('trigger-file-download', onCustomDownload);
  }, [file.fileId, file.fileName, cacheKey, isImage, isVideo, isAudio]);

  return <div className="file-message">
    {(isImage || isVideo) && (
      <div className="file-image-preview" style={{ background: isVideo ? '#000' : 'transparent', width: isImage ? undefined : '100%', minWidth: isVideo ? 220 : undefined, maxWidth: '100%', aspectRatio: (isImage || isVideo) ? effectiveAspectRatio : undefined }} onClick={(e) => {
        e.stopPropagation();
        if (!mediaUrl && (downloadState === 'decrypting' || downloadState === 'downloading')) {
          return;
        }
        if (!mediaUrl) void startDownload();
      }}>
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
      <div className="file-audio-meta"><div className="file-audio-title">{file.fileName}</div><div className="file-audio-artist">{mediaUrl ? formatDuration(audioTotalDuration) : `${formatFileSize(file.fileSize)} • ${formatDuration(audioTotalDuration)}`}</div></div>
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

    {!isImage && !isVideo && !isAudio && <div className="file-attachment">
      <div className="file-icon" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40 }}>
        {(downloadState === 'downloading' || downloadState === 'decrypting' || downloadState === 'idle') ? (
          <button type="button" className={`manual-download-btn ${downloadState === 'downloading' ? 'is-downloading' : ''} ${downloadState === 'decrypting' ? 'is-decrypting' : ''}`} style={{ ['--download-progress' as any]: `${downloadProgress}%`, margin: 0 }} onClick={(e) => {
            e.stopPropagation();
            if (downloadState === 'downloading') cancelDownload();
            else if (downloadState === 'idle') startDownload();
            else if (downloadState === 'done') {
                // For 'done' state we re-trigger the file-save if needed, though usually 'done' is handled by object URL for media
                // For general files we already handle trigger-file-download. Let's make button work too.
                window.dispatchEvent(new CustomEvent('trigger-file-download', { detail: { fileId: file.fileId } }));
            }
          }}>
            {downloadState === 'done' ? (mediaUrl ? <Download size={16} /> : <Download size={16} />) : actionIcon}
          </button>
        ) : (
          getFileIcon(file.mimeType)
        )}
      </div>
      <div className="file-info">
        <div className="file-name">{file.fileName}</div>
        <div className="file-size">
          {formatFileSize(file.fileSize)}
        </div>
      </div>
    </div>}
  </div>;
}
