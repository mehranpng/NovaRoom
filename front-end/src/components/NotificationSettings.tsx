import { useEffect, useState, type CSSProperties } from 'react';
import { Bell, BellOff, BellRing, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
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

const panelStyle: CSSProperties = {
    border: '1px solid var(--glass-border)',
    borderRadius: 20,
    overflow: 'hidden',
    background: 'var(--glass-surface-soft)',
    backdropFilter: 'var(--glass-blur)',
    WebkitBackdropFilter: 'var(--glass-blur)',
    boxShadow: 'var(--shadow-xs), var(--glass-specular)',
};

const statusCardStyle: CSSProperties = {
    ...panelStyle,
    borderRadius: 9999,
};

const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    direction: 'rtl',
    padding: '12px 14px',
    borderTop: '1px solid var(--glass-border)',
};

function Switch({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled?: boolean }) {
    const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark-mode');
    return (
        <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            aria-pressed={enabled}
            aria-label="toggle"
            style={{
                width: 48,
                height: 28,
                borderRadius: 999,
                border: isDarkMode
                    ? (enabled ? '1px solid color-mix(in srgb, var(--accent-primary) 70%, var(--border-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 35%, var(--border-primary))')
                    : (enabled ? '1px solid color-mix(in srgb, var(--text-primary) 28%, var(--accent-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 24%, var(--border-primary))'),
                background: enabled ? 'var(--accent-primary)' : (isDarkMode ? 'var(--bg-tertiary)' : 'color-mix(in srgb, var(--text-primary) 24%, var(--bg-primary))'),
                position: 'relative',
                transition: 'all .2s ease',
                flexShrink: 0,
                cursor: disabled ? 'default' : 'pointer',
            }}
        >
            <span
                style={{
                    position: 'absolute',
                    top: 2,
                    right: enabled ? 2 : 22,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: isDarkMode ? '#fff' : (enabled ? '#fff' : '#d3d3d3'),
                    transition: 'all .2s ease',
                }}
            />
        </button>
    );
}

export function NotificationSettings({ onBack }: Props) {
    const { scrolled, handleScroll } = useScrollFade();
    const prefs = useNotificationPrefs();
    const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(getPermission());
    const support = getPushSupport();
    const statusCardPill = support !== 'needs-install' && (permission === 'granted' || support === 'unsupported');

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
                <div style={{ padding: '20px 32px', direction: 'rtl' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                        برای دریافت اعلان، برنامه را به صفحه اصلی اضافه کنید
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--text-secondary)' }}>
                        در Safari روی دکمه اشتراک‌گذاری بزنید و «Add to Home Screen» را انتخاب کنید، سپس برنامه را از صفحه اصلی باز کنید.
                    </div>
                </div>
            );
        }
        if (support === 'unsupported') {
            return (
                <div style={{ padding: '20px 32px', direction: 'rtl', fontSize: 14 }}>
                    مرورگر شما از اعلان‌ها پشتیبانی نمی‌کند.
                </div>
            );
        }
        if (permission === 'denied') {
            return (
                <div style={{ padding: '20px 32px', direction: 'rtl' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                        <BellOff size={18} color="#e11919" aria-hidden="true" />
                        دسترسی اعلان مسدود است
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--text-secondary)' }}>
                        شما دسترسی اعلان را برای این سایت مسدود کرده‌اید. برای فعال‌سازی، روی آیکون قفل کنار آدرس سایت بزنید، بخش Notifications را روی Allow بگذارید و صفحه را دوباره بارگذاری کنید.
                    </div>
                </div>
            );
        }
        if (permission === 'default') {
            return (
                <div style={{ padding: '20px 32px', direction: 'rtl' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                        دسترسی اعلان داده نشده است
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--text-secondary)', marginBottom: 12 }}>
                        برای دریافت اعلان پیام‌های جدید، اجازه دسترسی بدهید.
                    </div>
                    <button
                        type="button"
                        className="notif-settings__action"
                        onClick={requestAccess}
                        style={{ border: '1px solid var(--glass-border)', background: 'var(--accent-primary)', color: '#fff', borderRadius: 9999, padding: '9px 18px', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}
                    >
                        اجازه دسترسی
                    </button>
                </div>
            );
        }
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 32px', direction: 'rtl', fontSize: 13, fontWeight: 600 }}>
                <BellRing size={16} color="var(--accent-primary)" aria-hidden="true" />
                اعلان‌ها روی این دستگاه فعال هستند
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

            <div className="profile__content" onScroll={handleScroll} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingInline: 14, paddingTop: 68, flex: '0 0 auto' }}>
                <div style={statusCardPill ? statusCardStyle : panelStyle}>{renderStatus()}</div>

                <div style={panelStyle}>
                    <div style={{ ...rowStyle, borderTop: 'none' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>اعلان پیام‌ها</span>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>دریافت اعلان پیام‌های جدید در گفتگوها</span>
                        </div>
                        <Switch enabled={prefs.enabled} onToggle={() => void toggleEnabled()} />
                    </div>

                    <div style={rowStyle}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>اعلان شطرنج</span>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>دریافت اعلان شروع بازی و هشدار تایمر شطرنج</span>
                        </div>
                        <Switch enabled={prefs.chess} onToggle={() => void toggleChess()} />
                    </div>
                </div>

                <div style={panelStyle}>
                    <div style={{ ...rowStyle, borderTop: 'none', opacity: anyEnabled ? 1 : 0.5 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>صدای اعلان</span>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>پخش صدا داخل برنامه هنگام دریافت اعلان (جدا از صدای دستگاه)</span>
                        </div>
                        <Switch enabled={prefs.sound} onToggle={() => void toggleSound()} disabled={!anyEnabled} />
                    </div>

                    <div style={{ ...rowStyle, opacity: prefs.enabled ? 1 : 0.5 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>اعلان هوشمند</span>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>کاهش صدای اعلان در پیام‌های پشت‌سرهم از یک گفتگو</span>
                        </div>
                        <Switch enabled={prefs.smart} onToggle={() => void toggleSmart()} disabled={!prefs.enabled} />
                    </div>
                </div>

                {permission === 'granted' && (
                    <button
                        type="button"
                        className="notif-settings__test"
                        onClick={() => void testNotification()}
                        disabled={!anyEnabled}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 52, borderRadius: 9999, border: '1px solid var(--glass-border)', background: 'var(--glass-surface-soft)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-xs), var(--glass-specular)', color: 'var(--text-primary)', fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: anyEnabled ? 'pointer' : 'default', opacity: anyEnabled ? 1 : 0.5, transition: 'background .15s ease, transform .08s ease' }}
                    >
                        <Bell size={16} />
                        آزمایش اعلان
                    </button>
                )}
            </div>
        </motion.div>
    );
}
