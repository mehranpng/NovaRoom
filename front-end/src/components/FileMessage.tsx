import type { FileMetadata } from '../types';
import { formatFileSize, isImageFile } from '../utils/fileUtils';
import { API_BASE_URL } from '../config/api';
import { useEffect, useRef, useState } from 'react';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';
import { decryptFileBytesClientSide } from '../utils/e2ee';
import { getCachedBlob, getOrCacheBlob, deleteCachedBlob } from '../utils/mediaCache';
import { autoDownloadCookieKeys, isAutoDownloadEnabled } from '../utils/autoDownloadPrefs';
import { isLocalBlobUrl, localBlobUrls } from '../utils/chatFileUploader';
import { useUploadProgress } from '../utils/uploadProgressStore';
import { getFileExtension, getColorFromExtension } from '../utils/documentInfo';
import { useShowTransition } from '../hooks/useShowTransition';
import { useAudioMetadata } from '../hooks/useAudioMetadata';
import { ProgressSpinner } from './ProgressSpinner';
import { MediaBadge } from './MediaBadge';
import { AnimatedFileSize } from './AnimatedFileSize';
import { DownloadIcon, PlayIcon, PauseIcon } from './icons/TelegramIcons';

interface FileMessageProps { file: FileMetadata; token: string; chatId: string; uploading?: boolean; uploadId?: string; hideCancel?: boolean; overlayMeta?: React.ReactNode; flushBottom?: boolean; onCancelUpload?: () => void; onMediaLoad?: () => void; onMediaError?: () => void; onImageClick?: (imageUrl: string, file: FileMetadata) => void; onVideoClick?: (videoUrl: string, file: FileMetadata) => void; }
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

const stripFileExtension = (name: string): string => name.replace(/\.[^/.]+$/, '');

const MAX_CONCURRENT_DOWNLOADS = 2;
let activeDownloadCount = 0;
const downloadQueue: Array<() => void> = [];

const acquireDownloadSlot = (): Promise<void> => {
  if (activeDownloadCount < MAX_CONCURRENT_DOWNLOADS) {
    activeDownloadCount += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    downloadQueue.push(resolve);
  });
};

const releaseDownloadSlot = (): void => {
  const next = downloadQueue.shift();
  if (next) {
    next();
  } else {
    activeDownloadCount = Math.max(0, activeDownloadCount - 1);
  }
};

const visibilityCallbacks = new WeakMap<Element, (visible: boolean) => void>();
let sharedVisibilityObserver: IntersectionObserver | null = null;
const observeVisibility = (el: Element, cb: (visible: boolean) => void) => {
  if (typeof IntersectionObserver === 'undefined') {
    cb(true);
    return () => undefined;
  }
  if (!sharedVisibilityObserver) {
    sharedVisibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) visibilityCallbacks.get(entry.target)?.(entry.isIntersecting);
    }, { rootMargin: '400px 0px' });
  }
  visibilityCallbacks.set(el, cb);
  sharedVisibilityObserver.observe(el);
  return () => {
    visibilityCallbacks.delete(el);
    sharedVisibilityObserver?.unobserve(el);
  };
};

export function FileMessage({ file, token, chatId, uploading = false, uploadId = '', hideCancel = false, overlayMeta, flushBottom = false, onCancelUpload, onMediaLoad, onMediaError, onImageClick, onVideoClick }: FileMessageProps) {
  const upload = useUploadProgress(uploading ? uploadId : '');
  const [mediaUrl, setMediaUrl] = useState<string | null>(file.localUrl ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number | null>(null);
  const [actualAspectRatio, setActualAspectRatio] = useState<number | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>(file.localUrl ? 'done' : 'idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [cacheChecked, setCacheChecked] = useState(false);
  const [resolvedAudioDuration, setResolvedAudioDuration] = useState(0);
  const [nearViewport, setNearViewport] = useState(false);
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const seekTrackRef = useRef<HTMLDivElement | null>(null);
  const isSeekingRef = useRef(false);
  const recoveredRef = useRef(false);
  const musicPlayer = useMusicPlayer();
  const isImage = isImageFile(file.mimeType); const isAudio = (file.mimeType || '').startsWith('audio/'); const isVideo = (file.mimeType || '').startsWith('video/');
  const audioMeta = useAudioMetadata(isAudio ? mediaUrl : null, !file.audioCover);
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
  const isUploading = uploading === true;
  const uploadPct = upload ? Math.max(0, Math.min(100, upload.progress)) : 0;
  const isTransferring = isUploading || downloadState === 'downloading' || downloadState === 'decrypting';
  const rawTransferProgress = isUploading ? uploadPct / 100 : downloadProgress / 100;
  const isTransferParked = isUploading && uploadPct >= 100;
  const transferProgress = isTransferParked ? 0.25 : rawTransferProgress;
  const isDone = !isUploading && (downloadState === 'done' || mediaUrl != null);
  const isIdle = !isUploading && !isDone && !isTransferring;
  const isEncrypting = upload?.phase === 'encrypting' || downloadState === 'decrypting';
  const spinnerTransition = useShowTransition(isTransferring);
  const fileExtension = getFileExtension(file.fileName, file.mimeType);
  const fileColor = getColorFromExtension(fileExtension);
  const audioTitle = audioMeta?.title || file.title || stripFileExtension(file.fileName);
  const audioArtist = audioMeta?.artist || file.artist || '';
  const audioCover = file.audioCover || audioMeta?.coverUrl || '';
  const isActiveTrack = musicPlayer.track?.fileId === file.fileId;
  const isPlayingThis = isActiveTrack && musicPlayer.isPlaying;
  const trackDuration = isActiveTrack && musicPlayer.duration > 0 ? musicPlayer.duration : audioTotalDuration;
  const seekPercent = isActiveTrack && musicPlayer.duration > 0 ? Math.min(100, (musicPlayer.currentTime / musicPlayer.duration) * 100) : 0;
  const audioSubtitle = audioArtist
    ? `${formatDuration(trackDuration)} • ${audioArtist}`
    : audioMeta === undefined
      ? (trackDuration > 0 ? `${formatDuration(trackDuration)} • ${formatFileSize(file.fileSize, 1)}` : formatFileSize(file.fileSize, 1))
      : formatDuration(trackDuration);

  const seekFromClientX = (clientX: number) => {
    const track = seekTrackRef.current;
    if (!track || musicPlayer.duration <= 0) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    musicPlayer.seek(ratio * musicPlayer.duration);
  };

  const decodeResponseBlob = async (response: Response): Promise<Blob> => {
    const encryptedBytes = new Uint8Array(await response.arrayBuffer());
    const plainBytes = await decryptFileBytesClientSide(encryptedBytes, token, chatId, file.encryptedFileKey);
    return new Blob([plainBytes as BlobPart], { type: file.mimeType || response.headers.get('content-type') || 'application/octet-stream' });
  };

  const ensureObjectUrl = async () => {
    const localUrl = localBlobUrls.get(file.fileId);
    if (localUrl) {
      setMediaUrl(localUrl); setDownloadState('done');
      return true;
    }
    const cached = await getCachedBlob(cacheKey);
    if (!cached) return false;
    const object = URL.createObjectURL(cached);
    setMediaUrl(object); setDownloadState('done');
    
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
        await acquireDownloadSlot();
        const progressTimer = window.setInterval(() => {
          task!.progress = Math.min(92, task!.progress + 4); notify(task!);
        }, 180);
        try {
          if (task!.abortController?.signal.aborted) throw new Error('aborted');
          const res = await fetch(`${API_BASE_URL}/files/${file.fileId}`, { headers: { Authorization: `Bearer ${token}` }, signal: task!.abortController?.signal });
          if (!res.ok) throw new Error('download failed');
          window.clearInterval(progressTimer);
          if (!isAudio) {
            task!.progress = 100; task!.state = 'decrypting'; notify(task!);
          }
          const blob = isAudio
            ? new Blob([new Uint8Array(await res.arrayBuffer()) as BlobPart], { type: file.mimeType || res.headers.get('content-type') || 'application/octet-stream' })
            : await decodeResponseBlob(res);
          task!.blob = blob;
          await getOrCacheBlob({ cacheKey, loadBlob: async () => blob });
          
          void deleteCachedBlob(`chat:${chatId}:preview:${file.fileId}`);
          task!.state = 'done'; notify(task!);
        } catch {
          window.clearInterval(progressTimer);
          task!.state = task!.abortController?.signal.aborted ? 'idle' : 'error'; notify(task!);
        } finally {
          releaseDownloadSlot();
          task!.promise = null;
          task!.abortController = null;
        }
      })();
    }
    await task.promise;
    const finalBlob = task.blob || await getCachedBlob(cacheKey);
    if (finalBlob) {
      const object = URL.createObjectURL(finalBlob);
      setMediaUrl(object); setDownloadState('done');
    }
  };

  const cancelDownload = () => {
    const task = fileDownloadTasks.get(file.fileId);
    task?.abortController?.abort();
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    return observeVisibility(el, (visible) => {
      if (visible) setNearViewport(true);
    });
  }, []);

  useEffect(() => {
    if (file.localUrl) return;
    if (!nearViewport) return;
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
  }, [cacheKey, file.fileId, nearViewport, file.localUrl]);

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
      || (isAudio && isAutoDownloadEnabled(autoDownloadCookieKeys.audio))
      || (!isImage && !isVideo && !isAudio && isAutoDownloadEnabled(autoDownloadCookieKeys.file));
    if (shouldAutoDownload) void startDownload();
  }, [cacheChecked, mediaUrl, downloadState, isImage, isVideo, isAudio]);

  useEffect(() => {
    if (!nearViewport) return;
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
    }).catch(() => undefined);
    return () => { 
      cancelled = true; 
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [isImage, isVideo, previewDirectUrl, token, chatId, file.fileId, nearViewport]);

  useEffect(() => {
    const oldMediaUrl = mediaUrl;
    const oldPreviewUrl = previewUrl;
    const mappedUrl = file.localUrl ?? localBlobUrls.get(file.fileId) ?? null;
    recoveredRef.current = false;
    
    setMediaUrl(mappedUrl);
    setPreviewUrl(null);
    setPreviewAspectRatio(null);
    setActualAspectRatio(null);
    setResolvedAudioDuration(0);
    if (mappedUrl !== oldMediaUrl) setMediaLoaded(false);
    setDownloadState(mappedUrl ? 'done' : 'idle');

    return () => {
      if (oldMediaUrl && oldMediaUrl.startsWith('blob:') && oldMediaUrl !== mappedUrl && !isLocalBlobUrl(oldMediaUrl)) URL.revokeObjectURL(oldMediaUrl);
      if (oldPreviewUrl && oldPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(oldPreviewUrl);
    };
  }, [file.fileId]);

  const metadataWidth = Number(file.width || (file as any)?.meta?.width || (file as any)?.metadata?.width || 0);
  const metadataHeight = Number(file.height || (file as any)?.meta?.height || (file as any)?.metadata?.height || 0);
  const metadataAspectRatio = metadataWidth > 0 && metadataHeight > 0 ? (metadataWidth / metadataHeight) : null;
  const fallbackRatio = isVideo ? (16 / 9) : 0.75;
  const rawAspectRatio = metadataAspectRatio || actualAspectRatio || previewAspectRatio || fallbackRatio;
  
  
  const effectiveAspectRatio = isImage
    ? Math.max(0.5, Math.min(2.0, rawAspectRatio))
    : Math.max(0.45, Math.min(2.2, rawAspectRatio));

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

  const handleMediaRendered = (e?: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => {
    if (e?.currentTarget) {
      const target = e.currentTarget;
      let w = 0;
      let h = 0;
      if (target instanceof HTMLImageElement) {
        w = target.naturalWidth;
        h = target.naturalHeight;
      } else if (target instanceof HTMLVideoElement) {
        w = target.videoWidth;
        h = target.videoHeight;
      }
      if (w > 0 && h > 0) {
        const nextRatio = w / h;
        
        const currentRatio = rawAspectRatio;
        if (metadataAspectRatio === null && (!actualAspectRatio || Math.abs(nextRatio - currentRatio) > currentRatio * 0.01)) {
          setActualAspectRatio(nextRatio);
        }
      }
    }
    setMediaLoaded(true);
    onMediaLoad?.();
  };

  const handleMediaFailed = () => {
    setMediaLoaded(true);
    (onMediaError ?? onMediaLoad)?.();
  };

  const handleImageError = () => {
    if (mediaUrl && mediaUrl.startsWith('blob:') && !recoveredRef.current) {
      recoveredRef.current = true;
      setMediaUrl(null);
      setMediaLoaded(false);
      setDownloadState('idle');
      void ensureObjectUrl().then((restored) => {
        if (!restored) void startDownload();
      });
      return;
    }
    handleMediaFailed();
  };

  
  const maxWidth = 280;
  const maxHeight = 440;
  const renderSpinner = (size: 's' | 'm' | 'l') => (
    <div className="transfer-spinner" onPointerDown={isUploading && hideCancel ? undefined : (e) => e.stopPropagation()} onTouchStart={isUploading && hideCancel ? undefined : (e) => e.stopPropagation()}>
      <ProgressSpinner
        size={size}
        progress={isEncrypting || isTransferParked ? 0.25 : transferProgress}
        noCross={isUploading ? hideCancel : downloadState !== 'downloading'}
        ariaLabel={isUploading ? 'لغو آپلود' : downloadState === 'downloading' ? 'لغو دانلود' : 'در حال انتقال'}
        onClick={(e) => {
          e.stopPropagation();
          if (isUploading) {
            if (!hideCancel) onCancelUpload?.();
            return;
          }
          if (downloadState === 'downloading') cancelDownload();
        }}
      />
    </div>
  );
  const containerStyle: React.CSSProperties = {
    background: 'transparent',
    aspectRatio: String(effectiveAspectRatio),
    maxWidth: '100%',
  };

  if (effectiveAspectRatio < maxWidth / maxHeight) {
    
    containerStyle.height = `${maxHeight}px`;
    containerStyle.width = `${Math.round(maxHeight * effectiveAspectRatio)}px`;
  } else {
    
    containerStyle.width = `${maxWidth}px`;
    containerStyle.height = `${Math.round(maxWidth / effectiveAspectRatio)}px`;
  }

  return <div className={`file-message${isAudio ? ' file-message--audio' : ''}`} ref={rootRef}>
    {(isImage || isVideo) && (
      <div className={flushBottom ? 'file-image-preview file-image-preview--flush-bottom' : 'file-image-preview'} style={containerStyle} onClick={(e) => {
        e.stopPropagation();
        if (isUploading) return;
        if (!mediaUrl && isTransferring) return;
        if (!mediaUrl) void startDownload();
      }}>
        {!mediaLoaded && <div className="media-skeleton skeleton-glass" aria-hidden />}
        {mediaUrl ? (
          isImage ? (
            <img src={mediaUrl} alt={file.fileName} style={{ objectFit: shouldContain ? 'contain' : 'cover' }} onLoad={handleMediaRendered} onError={handleImageError} onClick={isUploading ? undefined : () => onImageClick?.(mediaUrl, file)} />
          ) : (
            <button type="button" className="file-video-thumb" disabled={isUploading} onClick={isUploading ? undefined : () => onVideoClick?.(mediaUrl, file)}>
              <video src={mediaUrl} preload="metadata" muted playsInline onLoadedData={handleMediaRendered} onError={handleMediaFailed} style={{ width: '100%', height: '100%', objectFit: shouldContain ? 'contain' : 'cover', background: 'transparent' }} />
            </button>
          )
        ) : (
          previewUrl
            ? <img src={previewUrl} alt="preview" style={{ filter: 'blur(4px)', objectFit: shouldContain ? 'contain' : 'cover' }} onLoad={handleMediaRendered} onError={handleMediaFailed} />
            : <div className="media-skeleton skeleton-glass" aria-hidden />
        )}
        {spinnerTransition.shouldRender && (
          <div className={`media-loading ${spinnerTransition.className}`}>{renderSpinner('l')}</div>
        )}
        {isIdle && (
          <button type="button" className="media-control-btn" onClick={(e) => { e.stopPropagation(); void startDownload(); }} aria-label="دانلود">
            <DownloadIcon size={24} />
          </button>
        )}
        {isVideo && isDone && mediaUrl && (
          <button type="button" className="media-control-btn" onClick={(e) => { e.stopPropagation(); onVideoClick?.(mediaUrl, file); }} aria-label="پخش ویدئو">
            <PlayIcon size={28} />
          </button>
        )}
        {isTransferring ? (
          <MediaBadge>{isEncrypting ? '...' : `${Math.round(transferProgress * 100)}%`}</MediaBadge>
        ) : isVideo ? (
          <MediaBadge>{formatDuration(mediaDuration)}</MediaBadge>
        ) : null}
        {overlayMeta}
      </div>
    )}

    {isAudio && <div className="audio-row">
      <button
        type="button"
        className="audio-toggle"
        onClick={(e) => {
          e.stopPropagation();
          if (isTransferring) return;
          if (!mediaUrl) {
            void startDownload();
            return;
          }
          musicPlayer.playTrack({
            fileId: file.fileId,
            fileName: file.fileName,
            audioUrl: mediaUrl,
            mimeType: file.mimeType,
            title: audioTitle,
            artist: audioArtist || undefined,
            coverArtUrl: audioCover || undefined,
          });
        }}
        aria-label={mediaUrl ? (isPlayingThis ? 'توقف' : 'پخش') : 'دانلود'}
      >
        <span className="audio-cover">
          {audioCover ? <img src={audioCover} alt="" /> : null}
        </span>
        <span className={`audio-toggle-icon${isTransferring ? ' is-hidden' : ''}`}>
          {isPlayingThis ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </span>
        {spinnerTransition.shouldRender && (
          <span className={`audio-progress ${spinnerTransition.className}`}>{renderSpinner('s')}</span>
        )}
        {!mediaUrl && !isTransferring && (
          <span className="audio-download-badge"><DownloadIcon size={11} /></span>
        )}
      </button>
      <div className="audio-content">
        <div className="audio-title" title={audioTitle}>{audioTitle}</div>
        {isActiveTrack && trackDuration > 0 ? (
          <div className={`audio-seek${isSeeking ? ' is-seeking' : ''}`} dir="ltr">
            <span className="audio-seek__time">{formatDuration(musicPlayer.currentTime)}</span>
            <div
              className="audio-seek__hit"
              data-no-message-gesture
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                isSeekingRef.current = true;
                setIsSeeking(true);
                seekFromClientX(e.clientX);
              }}
              onPointerMove={(e) => {
                e.stopPropagation();
                if (isSeekingRef.current) seekFromClientX(e.clientX);
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                isSeekingRef.current = false;
                setIsSeeking(false);
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={(e) => {
                e.stopPropagation();
                isSeekingRef.current = false;
                setIsSeeking(false);
              }}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <div ref={seekTrackRef} className="audio-seek__track">
                <span className="audio-seek__fill" style={{ width: `${seekPercent}%` }} />
                <span className="audio-seek__thumb" style={{ left: `${seekPercent}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <div className="audio-subtitle">
            {isTransferring ? <AnimatedFileSize size={file.fileSize} progress={transferProgress} /> : audioSubtitle}
          </div>
        )}
      </div>
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
      <div className={`file-icon-container${!isDone && !isUploading ? ' is-interactive' : ''}`} onClick={(e) => {
        e.stopPropagation();
        if (isUploading) return;
        if (isIdle || downloadState === 'error') void startDownload();
      }}>
        <div className={`file-icon ${fileColor}`}>
          {fileExtension.length <= 4 && <span className="file-ext">{fileExtension}</span>}
        </div>
        {spinnerTransition.shouldRender && (
          <div className={`file-progress ${fileColor} ${spinnerTransition.className}`}>{renderSpinner('s')}</div>
        )}
        {!isDone && <DownloadIcon className={`action-icon${isTransferring ? ' hidden' : ''}`} size={20} />}
      </div>
      <div className="file-info">
        <div className="file-title" title={file.fileName}>{file.fileName}</div>
        <div className="file-subtitle">
          <AnimatedFileSize size={file.fileSize} progress={isTransferring ? transferProgress : undefined} />
        </div>
      </div>
    </div>}
  </div>;
}
