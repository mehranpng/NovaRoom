import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import TelegramIcon from './TelegramIcon';
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

        <div className="profile__content tg-settings-scroll" onScroll={handleScroll}>
            <div className="tg-island-title">فضای ذخیره‌سازی</div>
            <div className="tg-island" style={{ borderRadius: 9999, padding: 4 }}>
                <button
                    type="button"
                    className="tg-list-item"
                    onClick={() => setShowClearModal(true)}
                    style={{ borderRadius: 9999, minHeight: 52, padding: '8px 14px' }}
                >
                    <span className="tg-icon-backdrop tg-icon-backdrop--green" aria-hidden="true">
                        <TelegramIcon name="piechart-filled" size={20} />
                    </span>
                    <span className="tg-list-item__copy">
                        <span className="tg-list-item__title">رسانه‌های کش شده</span>
                    </span>
                    <span className="tg-list-item__end">
                        <span className="tg-list-item__value" dir="ltr">{humanSize}</span>
                        <ChevronLeft size={18} />
                    </span>
                </button>
            </div>

            <div className="tg-island-title">دانلود خودکار رسانه</div>
            <div className="tg-island">
                {[
                    { key: 'image' as const, label: 'تصاویر', subtitle: 'دریافت خودکار عکس‌ها در گفتگوها', enabled: imageAutoDownload },
                    { key: 'video' as const, label: 'ویدیوها', subtitle: 'دریافت خودکار ویدیوها در گفتگوها', enabled: videoAutoDownload },
                    { key: 'audio' as const, label: 'آهنگ‌ها', subtitle: 'دریافت خودکار فایل‌های صوتی و موسیقی', enabled: audioAutoDownload },
                    { key: 'file' as const, label: 'فایل‌ها', subtitle: 'دریافت خودکار اسناد و فایل‌ها', enabled: fileAutoDownload },
                ].map((row, idx) => (
                    <div key={row.key}>
                        {idx > 0 && <div className="tg-island__divider tg-island__divider--plain" aria-hidden="true" />}
                        <div className="tg-row">
                            <span className="tg-list-item__copy">
                                <span className="tg-list-item__title">{row.label}</span>
                                <span className="tg-list-item__subtitle">{row.subtitle}</span>
                            </span>
                            <button
                                type="button"
                                onClick={() => onToggleAutoDownload(row.key)}
                                aria-label={`toggle ${row.label}`}
                                aria-pressed={row.enabled}
                                className={cx('tg-switch', row.enabled && 'tg-switch--on')}
                            >
                                <span className="tg-switch__thumb" />
                            </button>
                        </div>
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
