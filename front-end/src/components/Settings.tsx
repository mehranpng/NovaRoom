import { Bell, ChevronLeft, HardDrive, Laptop, LayoutDashboard, Link2, Palette, Shield, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { Devices } from './Devices';
import { ThemeSettings } from './ThemeSettings';
import { LoginLogs } from './LoginLogs';
import { DataStorageSettings } from './DataStorageSettings';
import { PrivacySettings } from './PrivacySettings';
import { NotificationSettings } from './NotificationSettings';
import { AdminPanel } from './admin/AdminPanel';
import { AdminLinksPage } from './admin/AdminLinksPage';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';
import { getPermission, getPushSupport, useNotificationPrefs } from '../utils/pushNotifications';
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
    const notificationsBlocked = getPushSupport() === 'supported' && notifyPrefs.enabled && getPermission() === 'denied';
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
            <motion.div className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
                <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
                <div className="profile__header">
                    <div className="profile__header-side">
                        <button onClick={onBackToMenu} className="profile__header-back back-icon-btn" aria-label="بازگشت به تنظیمات">
                            <ChevronLeft size={22} />
                        </button>
                    </div>
                    <h1 className="profile__header-title">داشبورد ادمین</h1>
                </div>

                <div className="adm-content" onScroll={handleScroll}>
                    {isOwner && (
                        <button
                            type="button"
                            className="adm-settings-row adm-tap"
                            onClick={() => onOpenSection('adminPanel')}
                        >
                            <span className="adm-settings-row__label">
                                <ShieldCheck size={18} /> پنل ادمین
                            </span>
                            <ChevronLeft size={18} className="adm-settings-row__chevron" />
                        </button>
                    )}
                    <button
                        type="button"
                        className="adm-settings-row adm-tap"
                        onClick={() => onOpenSection('adminLinks')}
                    >
                        <span className="adm-settings-row__label">
                            <Link2 size={18} /> ساخت لینک ثبت‌ نام
                        </span>
                        <ChevronLeft size={18} className="adm-settings-row__chevron" />
                    </button>
                </div>
            </motion.div>
        );
    }

    if (section === 'theme') {
        return (
            <motion.div className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
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

    return (
        <motion.div className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
            <div className="profile__header">
                <h1 className="profile__header-title">تنظیمات</h1>
            </div>

            <div className="profile__content" onScroll={handleScroll} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 12, paddingInline: 14, paddingTop: 68, flex: '0 0 auto' }}>
                {currentUser?.adminLevel && (
                    <button
                        type="button"
                        className="adm-settings-row adm-settings-row--spaced adm-tap"
                        onClick={() => onOpenSection('adminMenu')}
                    >
                        <span className="adm-settings-row__label">
                            <LayoutDashboard size={18} /> داشبورد ادمین
                        </span>
                        <ChevronLeft size={18} className="adm-settings-row__chevron" />
                    </button>
                )}
                <button
                    type="button"
                    className="popover__item"
                    onClick={() => onOpenSection('theme')}
                    style={{ border: '1px solid var(--glass-border)', background: 'var(--glass-surface-soft)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-xs), var(--glass-specular)', borderRadius: 9999, height: 60, justifyContent: 'space-between', direction: 'rtl', padding: '6px 22px', position: 'relative' }}
                >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'right' }}>
                        <Palette size={18} /> تم و شخصی سازی
                    </span>
                    <ChevronLeft size={18} style={{ marginInlineStart: 8 }} />
                </button>

                <button
                    type="button"
                    className="popover__item"
                    onClick={() => onOpenSection('notifications')}
                    style={{ border: '1px solid var(--glass-border)', background: 'var(--glass-surface-soft)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-xs), var(--glass-specular)', borderRadius: 9999, height: 60, justifyContent: 'space-between', direction: 'rtl', padding: '6px 22px', position: 'relative' }}
                >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'right' }}>
                        <Bell size={18} /> اعلان‌ها
                    </span>
                    {notificationsBlocked && <span className="adm-dot-danger" aria-hidden="true" />}
                    <ChevronLeft size={18} style={{ marginInlineStart: 8 }} />
                </button>

                <button
                    type="button"
                    className="popover__item"
                    onClick={() => onOpenSection('privacy')}
                    style={{ border: '1px solid var(--glass-border)', background: 'var(--glass-surface-soft)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-xs), var(--glass-specular)', borderRadius: 9999, height: 60, justifyContent: 'space-between', direction: 'rtl', padding: '6px 22px', position: 'relative' }}
                >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'right' }}>
                        <Shield size={18} /> حریم خصوصی و امنیت
                    </span>
                    {currentUser?.deletionScheduledFor && <span className="adm-dot-danger" aria-hidden="true" />}
                    <ChevronLeft size={18} style={{ marginInlineStart: 8 }} />
                </button>

                <button
                    type="button"
                    className="popover__item"
                    onClick={() => onOpenSection('dataStorage')}
                    style={{ border: '1px solid var(--glass-border)', background: 'var(--glass-surface-soft)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-xs), var(--glass-specular)', borderRadius: 9999, height: 60, justifyContent: 'space-between', direction: 'rtl', padding: '6px 22px' }}
                >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'right' }}>
                        <HardDrive size={18} />داده‌ها و ذخیره‌ سازی
                    </span>
                    <ChevronLeft size={18} style={{ marginInlineStart: 8 }} />
                </button>
                <button
                    type="button"
                    className="popover__item"
                    onClick={() => onOpenSection('devices')}
                    style={{ border: '1px solid var(--glass-border)', background: 'var(--glass-surface-soft)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-xs), var(--glass-specular)', borderRadius: 9999, height: 60, justifyContent: 'space-between', direction: 'rtl', padding: '6px 22px', position: 'relative' }}
                >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'right' }}>
                        <Laptop size={18} /> دستگاه‌ها
                    </span>
                    {hasUnseenLoginLogs && <span style={{ position: 'absolute', top: 12, left: 12, width: 8, height: 8, borderRadius: 99, background: 'var(--accent-primary)' }} />}
                    <ChevronLeft size={18} style={{ marginInlineStart: 8 }} />
                </button>

            </div>
        </motion.div>
    );
}
