import { useEffect, useState } from 'react';
import { BellOff, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import TelegramIcon from './TelegramIcon';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';
import {
    getPermission,
    getPushSupport,
    playNotificationSound,
    requestPermissionAndSubscribe,
    updateNotificationPrefs,
    useNotificationPrefs,
} from '../utils/pushNotifications';

interface Props {
    onBack: () => void;
}

function Switch({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            aria-pressed={enabled}
            aria-label="toggle"
            className={cx('tg-switch', enabled && 'tg-switch--on')}
        >
            <span className="tg-switch__thumb" />
        </button>
    );
}

export function NotificationSettings({ onBack }: Props) {
    const { scrolled, handleScroll } = useScrollFade();
    const prefs = useNotificationPrefs();
    const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(getPermission());
    const support = getPushSupport();

    useEffect(() => {
        const refresh = () => setPermission(getPermission());
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('focus', refresh);
        let status: PermissionStatus | null = null;
        let cancelled = false;
        const watch = async () => {
            try {
                const result = await navigator.permissions?.query({ name: 'notifications' as PermissionName });
                if (!result || cancelled) return;
                status = result;
                result.onchange = refresh;
            } catch {
                void 0;
            }
        };
        void watch();
        return () => {
            cancelled = true;
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('focus', refresh);
            if (status) status.onchange = null;
        };
    }, []);

    const requestAccess = async () => {
        const result = await requestPermissionAndSubscribe();
        setPermission(result);
    };

    const anyEnabled = prefs.enabled || prefs.chess;

    const toggleEnabled = async () => {
        const next = !prefs.enabled;
        if (next && getPermission() === 'default') {
            const result = await requestPermissionAndSubscribe();
            setPermission(result);
        }
        await updateNotificationPrefs({ enabled: next });
    };

    const toggleChess = async () => {
        const next = !prefs.chess;
        if (next && getPermission() === 'default') {
            const result = await requestPermissionAndSubscribe();
            setPermission(result);
        }
        await updateNotificationPrefs({ chess: next });
    };

    const toggleSound = async () => {
        if (!anyEnabled) return;
        const next = !prefs.sound;
        await updateNotificationPrefs({ sound: next });
        if (next) playNotificationSound();
    };

    const toggleSmart = async () => {
        if (!prefs.enabled) return;
        await updateNotificationPrefs({ smart: !prefs.smart });
    };

    const testNotification = async () => {
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification('NovaRoom', {
                body: 'اعلان‌ها به درستی کار می‌کنند',
                icon: '/logo/icon-192.png',
                badge: '/logo/badge.png',
                dir: 'rtl',
                lang: 'fa',
                tag: 'nr-test',
            });
            playNotificationSound();
        } catch {
            void 0;
        }
    };

    const renderStatus = () => {
        if (support === 'needs-install') {
            return (
                <div className="tg-row" style={{ alignItems: 'flex-start' }}>
                    <span className="tg-icon-backdrop tg-icon-backdrop--orange" aria-hidden="true">
                        <TelegramIcon name="notifications-filled" size={20} />
                    </span>
                    <div className="tg-list-item__copy">
                        <span className="tg-list-item__title">نصب برای دریافت اعلان</span>
                        <span className="tg-list-item__subtitle" style={{ lineHeight: 1.75 }}>
                            در Safari روی دکمه اشتراک‌گذاری بزنید و «Add to Home Screen» را انتخاب کنید، سپس برنامه را از صفحه اصلی باز کنید.
                        </span>
                    </div>
                </div>
            );
        }
        if (support === 'unsupported') {
            return (
                <div className="tg-row">
                    <span className="tg-icon-backdrop tg-icon-backdrop--gray" aria-hidden="true">
                        <BellOff size={18} />
                    </span>
                    <div className="tg-list-item__copy">
                        <span className="tg-list-item__title">پشتیبانی نمی‌شود</span>
                        <span className="tg-list-item__subtitle">مرورگر شما از اعلان‌ها پشتیبانی نمی‌کند.</span>
                    </div>
                </div>
            );
        }
        if (permission === 'denied') {
            return (
                <div className="tg-row" style={{ alignItems: 'flex-start' }}>
                    <span className="tg-icon-backdrop tg-icon-backdrop--red" aria-hidden="true">
                        <BellOff size={18} />
                    </span>
                    <div className="tg-list-item__copy">
                        <span className="tg-list-item__title">دسترسی اعلان مسدود است</span>
                        <span className="tg-list-item__subtitle" style={{ lineHeight: 1.75 }}>
                            شما دسترسی اعلان را برای این سایت مسدود کرده‌اید. برای فعال‌سازی، روی آیکون قفل کنار آدرس سایت بزنید، بخش Notifications را روی Allow بگذارید و صفحه را دوباره بارگذاری کنید.
                        </span>
                    </div>
                </div>
            );
        }
        if (permission === 'default') {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 12px', direction: 'rtl' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                        <span className="tg-icon-backdrop tg-icon-backdrop--orange" aria-hidden="true">
                            <TelegramIcon name="notifications-filled" size={20} />
                        </span>
                        <div className="tg-list-item__copy">
                            <span className="tg-list-item__title">دسترسی اعلان داده نشده است</span>
                            <span className="tg-list-item__subtitle" style={{ lineHeight: 1.7 }}>
                                برای دریافت اعلان پیام‌های جدید، اجازه دسترسی بدهید.
                            </span>
                        </div>
                    </div>
                    <button type="button" className="tg-action-btn" onClick={requestAccess} style={{ alignSelf: 'flex-start', marginInlineStart: 48 }}>
                        اجازه دسترسی
                    </button>
                </div>
            );
        }
        return (
            <div className="tg-row">
                <span className="tg-icon-backdrop tg-icon-backdrop--green" aria-hidden="true">
                    <TelegramIcon name="notifications-filled" size={20} />
                </span>
                <div className="tg-list-item__copy">
                    <span className="tg-list-item__title">اعلان‌ها فعال هستند</span>
                    <span className="tg-list-item__subtitle">اعلان‌ها روی این دستگاه با موفقیت فعال شده است</span>
                </div>
            </div>
        );
    };

    return (
        <motion.div className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
            <div className="profile__header">
                <div className="profile__header-side">
                    <button onClick={onBack} className="profile__header-back back-icon-btn" aria-label="بازگشت به تنظیمات">
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">اعلان‌ها</h1>
            </div>

            <div className="profile__content tg-settings-scroll" onScroll={handleScroll}>
                <div className="tg-island">{renderStatus()}</div>

                <div className="tg-island-title">تنظیمات اعلان</div>
                <div className="tg-island">
                    <div className="tg-row">
                        <div className="tg-list-item__copy">
                            <span className="tg-list-item__title">اعلان پیام‌ها</span>
                            <span className="tg-list-item__subtitle">دریافت اعلان پیام‌های جدید در گفتگوها</span>
                        </div>
                        <Switch enabled={prefs.enabled} onToggle={() => void toggleEnabled()} />
                    </div>

                    <div className="tg-island__divider tg-island__divider--plain" aria-hidden="true" />

                    <div className="tg-row">
                        <div className="tg-list-item__copy">
                            <span className="tg-list-item__title">اعلان شطرنج</span>
                            <span className="tg-list-item__subtitle">دریافت اعلان شروع بازی و هشدار تایمر شطرنج</span>
                        </div>
                        <Switch enabled={prefs.chess} onToggle={() => void toggleChess()} />
                    </div>
                </div>

                <div className="tg-island-title">صدا و هوشمندی</div>
                <div className="tg-island">
                    <div className={cx('tg-row', !anyEnabled && 'tg-row--disabled')}>
                        <div className="tg-list-item__copy">
                            <span className="tg-list-item__title">صدای اعلان</span>
                            <span className="tg-list-item__subtitle">پخش صدا داخل برنامه هنگام دریافت اعلان (جدا از صدای دستگاه)</span>
                        </div>
                        <Switch enabled={prefs.sound} onToggle={() => void toggleSound()} disabled={!anyEnabled} />
                    </div>

                    <div className="tg-island__divider tg-island__divider--plain" aria-hidden="true" />

                    <div className={cx('tg-row', !prefs.enabled && 'tg-row--disabled')}>
                        <div className="tg-list-item__copy">
                            <span className="tg-list-item__title">اعلان هوشمند</span>
                            <span className="tg-list-item__subtitle">کاهش صدای اعلان در پیام‌های پشت‌سرهم از یک گفتگو</span>
                        </div>
                        <Switch enabled={prefs.smart} onToggle={() => void toggleSmart()} disabled={!prefs.enabled} />
                    </div>
                </div>

                {permission === 'granted' && (
                    <div className="tg-island">
                        <button
                            type="button"
                            className={cx('tg-list-item', !anyEnabled && 'tg-list-item--disabled')}
                            onClick={() => void testNotification()}
                            disabled={!anyEnabled}
                        >
                            <span className="tg-icon-backdrop tg-icon-backdrop--blue" aria-hidden="true">
                                <TelegramIcon name="notifications-filled" size={20} />
                            </span>
                            <span className="tg-list-item__copy">
                                <span className="tg-list-item__title">آزمایش اعلان</span>
                                <span className="tg-list-item__subtitle">ارسال یک اعلان آزمایشی به دستگاه</span>
                            </span>
                        </button>
                    </div>
                )}
            </div>
        </motion.div>
    );
}
