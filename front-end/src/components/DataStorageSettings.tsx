import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { clearAllMediaCache, getMediaCacheUsageBytes } from '../utils/mediaCache';
import { autoDownloadCookieKeys, isAutoDownloadEnabled, setAutoDownloadCookie } from '../utils/autoDownloadPrefs';
import { notify } from '../utils/notificationBus';

const formatCacheSize = (bytes: number): string => {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(0, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb <= 1024) return `${Math.max(0, Math.round(mb * 10) / 10)} MB`;
  const gb = mb / 1024;
  return `${Math.max(0, Math.round(gb * 10) / 10)} GB`;
};

interface Props {
  onBack: () => void;
}

export function DataStorageSettings({ onBack }: Props) {
  const [cacheUsageBytes, setCacheUsageBytes] = useState(0);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [imageAutoDownload, setImageAutoDownload] = useState(false);
  const [videoAutoDownload, setVideoAutoDownload] = useState(false);
  const [audioAutoDownload, setAudioAutoDownload] = useState(false);
  const confirmOverlayRef = useRef<HTMLDivElement | null>(null);

  const loadCacheUsage = async () => {
    const usage = await getMediaCacheUsageBytes();
    setCacheUsageBytes(usage);
  };

  useEffect(() => {
    void loadCacheUsage();
    setImageAutoDownload(isAutoDownloadEnabled(autoDownloadCookieKeys.image));
    setVideoAutoDownload(isAutoDownloadEnabled(autoDownloadCookieKeys.video));
    setAudioAutoDownload(isAutoDownloadEnabled(autoDownloadCookieKeys.audio));
  }, []);

  useEffect(() => {
    if (!showClearModal) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const modal = confirmOverlayRef.current?.querySelector('.chat-room-confirm-modal');
      if (modal && !modal.contains(target)) setShowClearModal(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowClearModal(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showClearModal]);

  const onToggleAutoDownload = (kind: 'image' | 'video' | 'audio') => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
    if (kind === 'image') {
      const next = !imageAutoDownload;
      setImageAutoDownload(next);
      setAutoDownloadCookie(autoDownloadCookieKeys.image, next ? '1' : '0');
      return;
    }
    if (kind === 'video') {
      const next = !videoAutoDownload;
      setVideoAutoDownload(next);
      setAutoDownloadCookie(autoDownloadCookieKeys.video, next ? '1' : '0');
      return;
    }
    const next = !audioAutoDownload;
    setAudioAutoDownload(next);
    setAutoDownloadCookie(autoDownloadCookieKeys.audio, next ? '1' : '0');
  };

  const humanSize = useMemo(() => formatCacheSize(cacheUsageBytes), [cacheUsageBytes]);

  const clearCache = async () => {
    if (clearing) return;
    setClearing(true);
    await clearAllMediaCache();
    await loadCacheUsage();
    setClearing(false);
    setShowClearModal(false);
    notify({ type: 'success', message: 'کش رسانه با موفقیت پاک شد.' });
  };

  return <motion.div className="profile" style={{ fontFamily: 'Vazir, sans-serif' }} initial={{ opacity: 0, y: 8, scale: 0.995 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
    <div className="profile__header" style={{ direction: 'ltr' }}>
      <button onClick={onBack} className="profile__header-back"><ArrowLeft size={22} /></button>
      <h1 className="profile__header-title">داده‌ ها و ذخیره‌سازی</h1>
      <div className="profile__header-spacer" />
    </div>

    <div className="profile__content" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingInline: 14, paddingTop: 12, flex: '0 0 auto' }}>
      <div style={{ border: '1px solid var(--border-primary)', borderRadius: 14, overflow: 'hidden' }}>
        <button type="button" className="popover__item" onClick={() => setShowClearModal(true)} style={{ width: '100%', minHeight: 56, justifyContent: 'space-between', direction: 'rtl', padding: '10px 14px', borderRadius: 0 }}>
          <span style={{ fontWeight: 800 }}>رسانه های کش شده</span>
          <span style={{ color: 'var(--accent-primary)', fontWeight: 700, direction: 'ltr' }}>{humanSize}</span>
        </button>
      </div>

      <div style={{ border: '1px solid var(--border-primary)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', fontWeight: 700, direction: 'rtl', borderBottom: '1px solid var(--border-primary)' }}>دانلود خودکار</div>

        {[
          { key: 'image' as const, label: 'تصاویر', enabled: imageAutoDownload },
          { key: 'video' as const, label: 'ویدیو ها', enabled: videoAutoDownload },
          { key: 'audio' as const, label: 'آهنگ ها', enabled: audioAutoDownload },
        ].map((row) => (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', direction: 'rtl', padding: '10px 14px', borderTop: '1px solid var(--border-primary)' }}>
            <span>{row.label}</span>
            <button type="button" onClick={() => onToggleAutoDownload(row.key)} aria-label={`toggle ${row.label}`} style={{ width: 48, height: 28, borderRadius: 999, border: '1px solid var(--border-primary)', background: row.enabled ? 'var(--accent-primary)' : 'var(--surface-tertiary)', position: 'relative', transition: 'all .2s ease' }}>
              <span style={{ position: 'absolute', top: 2, right: row.enabled ? 2 : 22, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'all .2s ease' }} />
            </button>
          </div>
        ))}
      </div>
    </div>

    <AnimatePresence>
      {showClearModal && (
        <motion.div className="chat-room-modal-overlay" ref={confirmOverlayRef} style={{ zIndex: 120 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
          <motion.div className="chat-room-confirm-modal" onMouseDown={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
            <h3 className="chat-room-confirm-modal__title">حذف کش رسانه؟</h3>
            <p className="chat-room-confirm-modal__text">آیا می‌خواهید تمام کش ذخیره‌شده پاک شود؟</p>
            <div className="chat-room-confirm-modal__actions">
              <button className="chat-room-confirm-modal__btn" onClick={() => setShowClearModal(false)} disabled={clearing} type="button">لغو</button>
              <button className="chat-room-confirm-modal__btn" onClick={clearCache} disabled={clearing} type="button">تایید</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  </motion.div>;
}
