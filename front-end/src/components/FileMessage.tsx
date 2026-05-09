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

export function FileMessage({ file, token, chatId, onMediaLoad, onImageClick, onVideoClick }: FileMessageProps) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const musicPlayer = useMusicPlayer();
  const isImage = isImageFile(file.mimeType); const isAudio = (file.mimeType || '').startsWith('audio/'); const isVideo = (file.mimeType || '').startsWith('video/');
  const cacheKey = `chat:${chatId}:file:${file.fileId}`;
  const previewDirectUrl = String((file as any).previewUrl || (file as any).thumbUrl || '').trim();

  const decodeResponseBlob = async (response: Response): Promise<Blob> => {
    const encryptedBytes = new Uint8Array(await response.arrayBuffer());
    const plainBytes = await decryptFileBytesClientSide(encryptedBytes, token, chatId);
    return new Blob([plainBytes], { type: file.mimeType || response.headers.get('content-type') || 'application/octet-stream' });
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
    abortRef.current = new AbortController();
    setDownloadState('downloading'); setProgress(0);
    try {
      const res = await fetch(`${API_BASE_URL}/files/${file.fileId}`, { headers: { Authorization: `Bearer ${token}` }, signal: abortRef.current.signal });
      if (!res.ok) throw new Error('download failed');
      setProgress(20); setDownloadState('decrypting');
      const blob = await decodeResponseBlob(res);
      setProgress(100);
      const cached = await getOrCacheBlob({ cacheKey, loadBlob: async () => blob });
      const object = URL.createObjectURL(cached);
      setMediaUrl(object); setDownloadState('done'); onMediaLoad?.();
    } catch {
      if (abortRef.current?.signal.aborted) setDownloadState('idle'); else setDownloadState('error');
    }
  };

  const cancelDownload = () => { abortRef.current?.abort(); setProgress(0); };

  useEffect(() => { void ensureObjectUrl(); }, [cacheKey]);

  useEffect(() => {
    if (!isImage || !previewDirectUrl) return;
    let cancelled = false;
    fetch(previewDirectUrl).then(r => r.blob()).then((blob) => {
      if (cancelled) return;
      setPreviewUrl(URL.createObjectURL(blob));
      onMediaLoad?.();
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isImage, previewDirectUrl]);

  const actionIcon = downloadState === 'downloading' ? <X size={16} /> : downloadState === 'decrypting' ? <LockOpen size={16} /> : <Download size={16} />;

  return <div className="file-message">
    {(isImage || isVideo) && (
      <div className="file-image-preview" style={{ background: isVideo ? '#000' : undefined }}>
        {mediaUrl ? (isImage ? <img src={mediaUrl} alt={file.fileName} onClick={() => onImageClick?.(mediaUrl, file)} /> : <button type="button" className="file-video-thumb" onClick={() => onVideoClick?.(mediaUrl, file)}><div style={{ minHeight: 180, background: '#000' }} /><span className="file-video-play-badge"><Play size={20} fill="currentColor" /></span></button>) :
          (<>
            {isImage && previewUrl ? <img src={previewUrl} alt="preview" style={{ filter: 'blur(4px)' }} /> : <div style={{ minHeight: 180, background: '#000' }} />}
            <div className="manual-download-wrap">
              <button type="button" className="manual-download-btn" onClick={downloadState === 'downloading' ? cancelDownload : startDownload} disabled={downloadState === 'decrypting'}>{actionIcon}</button>
              <div className="manual-download-size">{formatFileSize(file.fileSize)}</div>
            </div>
          </>)}
      </div>
    )}

    {isAudio && <div className="file-audio-card">
      {mediaUrl ? <button onClick={() => musicPlayer.playTrack({ fileId: file.fileId, fileName: file.fileName, audioUrl: mediaUrl, mimeType: file.mimeType })} type="button" style={{ width: 40, height: 40, borderRadius: '50%' }}>{musicPlayer.isPlaying && musicPlayer.track?.fileId === file.fileId ? <Pause size={18} /> : <Play size={18} />}</button> : <button type="button" className="manual-download-btn" onClick={downloadState === 'downloading' ? cancelDownload : startDownload} disabled={downloadState === 'decrypting'}>{actionIcon}</button>}
      <div style={{ flex: 1 }}><div className="file-audio-title">{file.fileName}</div><div className="file-audio-artist">{formatFileSize(file.fileSize)}</div></div>
    </div>}

    {!isImage && !isVideo && !isAudio && <div className="file-attachment"><div className="file-icon">{getFileIcon(file.mimeType)}</div><div className="file-info"><div className="file-name">{file.fileName}</div><div className="file-size">{formatFileSize(file.fileSize)}</div></div><button type="button" className="manual-download-btn" onClick={downloadState === 'downloading' ? cancelDownload : startDownload} disabled={downloadState === 'decrypting'}>{actionIcon}</button></div>}
  </div>;
}
