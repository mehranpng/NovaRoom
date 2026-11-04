import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { screenVariants } from '../utils/screenMotion';
import { AnimatePresence, motion } from 'framer-motion';
import { clearAllMediaCache, getMediaCacheUsageBytes } from '../utils/mediaCache';
import { autoDownloadCookieKeys, isAutoDownloadEnabled, setAutoDownloadCookie } from '../utils/autoDownloadPrefs';
import { notify } from '../utils/notificationBus';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';

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
    const { scrolled, handleScroll } = useScrollFade();
    const [cacheUsageBytes, setCacheUsageBytes] = useState(0);
    const [showClearModal, setShowClearModal] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [imageAutoDownload, setImageAutoDownload] = useState(false);
    const [videoAutoDownload, setVideoAutoDownload] = useState(false);
    const [audioAutoDownload, setAudioAutoDownload] = useState(false);
    const [fileAutoDownload, setFileAutoDownload] = useState(false);
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
        setFileAutoDownload(isAutoDownloadEnabled(autoDownloadCookieKeys.file));
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

    const onToggleAutoDownload = (kind: 'image' | 'video' | 'audio' | 'file') => {
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
        if (kind === 'audio') {
            const next = !audioAutoDownload;
            setAudioAutoDownload(next);
            setAutoDownloadCookie(autoDownloadCookieKeys.audio, next ? '1' : '0');
            return;
        }
        const next = !fileAutoDownload;
        setFileAutoDownload(next);
        setAutoDownloadCookie(autoDownloadCookieKeys.file, next ? '1' : '0');
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

    const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark-mode');
    const panelBorder = '1px solid var(--glass-border)';
    const panelBg = 'var(--glass-surface-soft)';

    return <motion.div className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
        <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
        <div className="profile__header">
            <div className="profile__header-side">
                <button onClick={onBack} className="profile__header-back back-icon-btn" aria-label="بازگشت به تنظیمات">
                    <ChevronLeft size={22} />
                </button>
            </div>
            <h1 className="profile__header-title">داده‌ها و ذخیره‌ سازی</h1>
        </div>

        <div className="profile__content" onScroll={handleScroll} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingInline: 14, paddingTop: 68, flex: '0 0 auto' }}>
            <div style={{ border: panelBorder, borderRadius: 9999, overflow: 'hidden', background: panelBg, backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-xs), var(--glass-specular)' }}>
                <button type="button" className="popover__item" onClick={() => setShowClearModal(true)} style={{ width: '100%', minHeight: 56, justifyContent: 'space-between', direction: 'rtl', padding: '10px 20px', borderRadius: 9999 }}>
                    <span style={{ fontWeight: 600 }}>رسانه‌های کش شده</span>
                    <span style={{ color: 'var(--accent-primary)', fontWeight: 700, direction: 'ltr' }}>{humanSize}</span>
                </button>
            </div>

            <div style={{ border: panelBorder, borderRadius: 20, overflow: 'hidden', background: panelBg, backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-xs), var(--glass-specular)' }}>
                <div style={{ padding: '12px 14px', fontSize: 15, fontWeight: 700, direction: 'rtl', borderBottom: panelBorder }}>دانلود خودکار</div>

                {[
                    { key: 'image' as const, label: 'تصاویر', enabled: imageAutoDownload },
                    { key: 'video' as const, label: 'ویدیو ها', enabled: videoAutoDownload },
                    { key: 'audio' as const, label: 'آهنگ ها', enabled: audioAutoDownload },
                    { key: 'file' as const, label: 'فایل ها', enabled: fileAutoDownload },
                ].map((row) => (
                    <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, fontWeight: 600, direction: 'rtl', padding: '10px 14px', borderTop: panelBorder }}>
                        <span>{row.label}</span>
                        <button type="button" onClick={() => onToggleAutoDownload(row.key)} aria-label={`toggle ${row.label}`} style={{ width: 48, height: 28, borderRadius: 999, border: isDarkMode ? (row.enabled ? '1px solid color-mix(in srgb, var(--accent-primary) 70%, var(--border-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 35%, var(--border-primary))') : (row.enabled ? '1px solid color-mix(in srgb, var(--text-primary) 28%, var(--accent-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 24%, var(--border-primary))'), background: row.enabled ? 'var(--accent-primary)' : (isDarkMode ? 'var(--bg-tertiary)' : 'color-mix(in srgb, var(--text-primary) 24%, var(--bg-primary))'), position: 'relative', transition: 'all .2s ease' }}>
                            <span style={{ position: 'absolute', top: 2, right: row.enabled ? 2 : 22, width: 22, height: 22, borderRadius: '50%', background: isDarkMode ? '#fff' : (row.enabled ? '#fff' : '#d3d3d3'), transition: 'all .2s ease' }} />
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
