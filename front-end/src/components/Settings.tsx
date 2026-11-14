import { ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { Devices } from './Devices';
import { ThemeSettings } from './ThemeSettings';
import { LoginLogs } from './LoginLogs';
import { DataStorageSettings } from './DataStorageSettings';
import { PrivacySettings } from './PrivacySettings';
import { NotificationSettings } from './NotificationSettings';
import { AdminPanel } from './admin/AdminPanel';
import { AdminLinksPage } from './admin/AdminLinksPage';
import TelegramIcon, { type TelegramIconName } from './TelegramIcon';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';
import { getPermission, getPushSupport, useNotificationPrefs } from '../utils/pushNotifications';
import { triggerPwaInstall, usePwaInstall } from '../utils/pwaInstall';
import type { User } from '../types';

type SettingsSection = 'menu' | 'devices' | 'theme' | 'logs' | 'dataStorage' | 'privacy' | 'notifications' | 'adminMenu' | 'adminPanel' | 'adminLinks';

interface SettingsProps {
    section: SettingsSection;
    adminSection: string;
    onAdminSectionChange: (section: string) => void;
    onOpenSection: (section: SettingsSection) => void;
    onBackToMenu: () => void;
    loginEvents: any[];
    hasUnseenLoginLogs?: boolean;
    currentUser: User | null;
    onUpdateCurrentUser?: (updates: Partial<User>) => void;
    onLogout?: () => void;
}

export function Settings({ section, adminSection, onAdminSectionChange, onOpenSection, onBackToMenu, loginEvents, hasUnseenLoginLogs, currentUser, onUpdateCurrentUser, onLogout }: SettingsProps) {
    const { scrolled, handleScroll } = useScrollFade();
    const notifyPrefs = useNotificationPrefs();
    const pwa = usePwaInstall();
    const notificationsBlocked = getPushSupport() === 'supported' && (notifyPrefs.enabled || notifyPrefs.chess) && getPermission() === 'denied';
    if (section === 'devices') {
        return <Devices onBack={onBackToMenu} onOpenLogs={() => onOpenSection('logs')} hasUnseenLoginLogs={hasUnseenLoginLogs} />;
    }
    if (section === 'logs') {
        return <LoginLogs onBack={() => onOpenSection('devices')} events={loginEvents} />;
    }
    if (section === 'privacy') {
        return <PrivacySettings onBack={onBackToMenu} currentUser={currentUser} onUpdateCurrentUser={onUpdateCurrentUser} onLogout={onLogout} />;
    }
    if (section === 'notifications') {
        return <NotificationSettings onBack={onBackToMenu} />;
    }
    if (section === 'adminPanel') {
        return (
            <AdminPanel
                section={adminSection}
                onSectionChange={onAdminSectionChange}
                onBack={() => onOpenSection('adminMenu')}
            />
        );
    }
    if (section === 'adminLinks') {
        return <AdminLinksPage onBack={() => onOpenSection('adminMenu')} />;
    }
    if (section === 'adminMenu') {
        const isOwner = currentUser?.adminLevel === 'admin0';
        return (
            <motion.div key="adminMenu" className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
                <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
                <div className="profile__header">
                    <div className="profile__header-side">
                        <button onClick={onBackToMenu} className="profile__header-back back-icon-btn" aria-label="بازگشت به تنظیمات">
                            <ChevronLeft size={22} />
                        </button>
                    </div>
                    <h1 className="profile__header-title">داشبورد ادمین</h1>
                </div>

                <div className="profile__content tg-settings-scroll" onScroll={handleScroll}>
                    <div className="tg-island">
                        {isOwner && (
                            <>
                                <button
                                    type="button"
                                    className="tg-list-item"
                                    onClick={() => onOpenSection('adminPanel')}
                                >
                                    <span className="tg-icon-backdrop tg-icon-backdrop--blue" aria-hidden="true">
                                        <TelegramIcon name="admin-filled" size={20} />
                                    </span>
                                    <span className="tg-list-item__copy">
                                        <span className="tg-list-item__title">پنل ادمین</span>
                                        <span className="tg-list-item__subtitle">مدیریت سیستم، کاربران و تنظیمات سرور</span>
                                    </span>
                                    <span className="tg-list-item__end">
                                        <ChevronLeft size={18} />
                                    </span>
                                </button>
                                <div className="tg-island__divider" aria-hidden="true" />
                            </>
                        )}
                        <button
                            type="button"
                            className="tg-list-item"
                            onClick={() => onOpenSection('adminLinks')}
                        >
                            <span className="tg-icon-backdrop tg-icon-backdrop--green" aria-hidden="true">
                                <TelegramIcon name="link" size={20} />
                            </span>
                            <span className="tg-list-item__copy">
                                <span className="tg-list-item__title">ساخت لینک ثبت‌نام</span>
                                <span className="tg-list-item__subtitle">ایجاد و مدیریت لینک‌های دعوت کاربران جدید</span>
                            </span>
                            <span className="tg-list-item__end">
                                <ChevronLeft size={18} />
                            </span>
                        </button>
                    </div>
                </div>
            </motion.div>
        );
    }

    if (section === 'theme') {
        return (
            <motion.div key="theme" className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
                <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
                <div className="profile__header">
                    <div className="profile__header-side">
                        <button onClick={onBackToMenu} className="profile__header-back back-icon-btn" aria-label="بازگشت به تنظیمات">
                            <ChevronLeft size={22} />
                        </button>
                    </div>
                    <h1 className="profile__header-title">تم و شخصی سازی</h1>
                </div>
                <ThemeSettings />
            </motion.div>
        );
    }
    if (section === 'dataStorage') {
        return <DataStorageSettings onBack={onBackToMenu} />;
    }

    const settingsItems: {
        section: SettingsSection;
        title: string;
        subtitle: string;
        icon: TelegramIconName;
        iconBg: 'orange' | 'red' | 'gray' | 'green' | 'blue';
        dot?: 'danger' | 'accent';
    }[] = [
        {
            section: 'theme',
            title: 'تم و شخصی‌سازی',
            subtitle: 'رنگ‌بندی، پس‌زمینه و ظاهر برنامه',
            icon: 'appearance-filled',
            iconBg: 'orange',
        },
        {
            section: 'notifications',
            title: 'اعلان‌ها',
            subtitle: 'صداها، پیام‌ها و هشدارهای بازی',
            icon: 'notifications-filled',
            iconBg: 'red',
            dot: notificationsBlocked ? 'danger' : undefined,
        },
        {
            section: 'privacy',
            title: 'حریم خصوصی و امنیت',
            subtitle: 'تغییر رمز عبور و مدیریت حساب',
            icon: 'lock-filled',
            iconBg: 'gray',
            dot: currentUser?.deletionScheduledFor ? 'danger' : undefined,
        },
        {
            section: 'dataStorage',
            title: 'داده‌ها و ذخیره‌سازی',
            subtitle: 'مدیریت حافظه پنهان و فایل‌ها',
            icon: 'piechart-filled',
            iconBg: 'green',
        },
        {
            section: 'devices',
            title: 'دستگاه‌ها',
            subtitle: 'نشست‌های فعال و گزارش ورود',
            icon: 'devices-filled',
            iconBg: 'blue',
            dot: hasUnseenLoginLogs ? 'accent' : undefined,
        },
    ];

    return (
        <motion.div key="menu" className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
            <div className="profile__header">
                <h1 className="profile__header-title">تنظیمات</h1>
            </div>

            <div className="profile__content tg-settings-scroll" onScroll={handleScroll}>
                {pwa.isMobileWeb && (
                    <button
                        type="button"
                        className="settings-install-card"
                        onClick={() => void triggerPwaInstall()}
                    >
                        <img className="settings-install-card__logo" src="/logo/icon-192.png" alt="" />
                        <span className="settings-install-card__copy">
                            <span className="settings-install-card__title">نصب اپلیکیشن نواروم</span>
                            <span className="settings-install-card__subtitle">دسترسی سریع‌تر از صفحه اصلی</span>
                        </span>
                        <span className="settings-install-card__action">نصب</span>
                    </button>
                )}

                {currentUser?.adminLevel && (
                    <div className="tg-island">
                        <button
                            type="button"
                            className="tg-list-item"
                            onClick={() => onOpenSection('adminMenu')}
                        >
                            <span className="tg-icon-backdrop tg-icon-backdrop--purple" aria-hidden="true">
                                <TelegramIcon name="settings-filled" size={20} />
                            </span>
                            <span className="tg-list-item__copy">
                                <span className="tg-list-item__title">داشبورد ادمین</span>
                                <span className="tg-list-item__subtitle">مدیریت کاربران و لینک‌های ثبت‌نام</span>
                            </span>
                            <span className="tg-list-item__end">
                                <ChevronLeft size={18} />
                            </span>
                        </button>
                    </div>
                )}

                <div className="tg-island">
                    {settingsItems.map((item, idx) => (
                        <div key={item.section}>
                            {idx > 0 && <div className="tg-island__divider" aria-hidden="true" />}
                            <button
                                type="button"
                                className="tg-list-item"
                                onClick={() => onOpenSection(item.section)}
                            >
                                <span className={cx('tg-icon-backdrop', `tg-icon-backdrop--${item.iconBg}`)} aria-hidden="true">
                                    <TelegramIcon name={item.icon} size={20} />
                                </span>
                                <span className="tg-list-item__copy">
                                    <span className="tg-list-item__title">{item.title}</span>
                                    <span className="tg-list-item__subtitle">{item.subtitle}</span>
                                </span>
                                <span className="tg-list-item__end">
                                    {item.dot && (
                                        <span
                                            className={cx('tg-list-item__dot', item.dot === 'danger' && 'tg-list-item__dot--danger')}
                                            aria-hidden="true"
                                        />
                                    )}
                                    <ChevronLeft size={18} />
                                </span>
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </motion.div>
    );
}
