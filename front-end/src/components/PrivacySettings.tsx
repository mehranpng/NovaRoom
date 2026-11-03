import { useState } from 'react';
import { ChevronLeft, EyeOff, KeyRound } from 'lucide-react';
import { motion } from 'framer-motion';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';
import { apiFetch } from '../config/api';
import { notify } from '../utils/notificationBus';
import { PasswordField } from './PasswordField';
import type { User } from '../types';
import './admin/admin.css';

interface PrivacySettingsProps {
    onBack: () => void;
    currentUser: User | null;
    onUpdateCurrentUser?: (updates: Partial<User>) => void;
    onLogout?: () => void;
}

export function PrivacySettings({ onBack, currentUser, onUpdateCurrentUser, onLogout }: PrivacySettingsProps) {
    const { scrolled, handleScroll } = useScrollFade();
    const [hideOnline, setHideOnline] = useState<boolean>(Boolean(currentUser?.hideOnlineStatus));
    const [saving, setSaving] = useState(false);

    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [passwordSaving, setPasswordSaving] = useState(false);

    const toggleHideOnline = async () => {
        if (saving) return;
        const nextState = !hideOnline;
        setSaving(true);
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(10);
        }

        try {
            await apiFetch('/profile/me/privacy', {
                method: 'PATCH',
                body: JSON.stringify({ hideOnlineStatus: nextState }),
            });
            setHideOnline(nextState);
            onUpdateCurrentUser?.({ hideOnlineStatus: nextState });
            notify({
                type: 'success',
                message: nextState
                    ? 'وضعیت آنلاین بودن و آخرین بازدید شما مخفی شد.'
                    : 'وضعیت آنلاین بودن و آخرین بازدید شما قابل مشاهده شد.',
            });
        } catch {
            notify({
                type: 'error',
                message: 'خطا در ذخیره تنظیمات حریم خصوصی.',
            });
        } finally {
            setSaving(false);
        }
    };

    const submitPasswordChange = async (event: React.FormEvent) => {
        event.preventDefault();
        setPasswordError('');

        if (newPassword.length < 8) {
            setPasswordError('رمز عبور جدید باید حداقل ۸ کاراکتر باشد');
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError('رمز عبور جدید و تکرار آن یکسان نیستند');
            return;
        }
        if (newPassword === currentPassword) {
            setPasswordError('رمز عبور جدید باید با رمز فعلی متفاوت باشد');
            return;
        }

        setPasswordSaving(true);
        try {
            await apiFetch('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            notify({ type: 'success', message: 'رمز عبور تغییر کرد. دوباره وارد شوید.' });
            onLogout?.();
        } catch (error: unknown) {
            const message = String((error as Error)?.message || '');
            if (message.includes('Current password is incorrect')) {
                setPasswordError('رمز عبور فعلی اشتباه است');
            } else if (message.includes('at least')) {
                setPasswordError('رمز عبور جدید باید حداقل ۸ کاراکتر باشد');
            } else {
                setPasswordError('تغییر رمز عبور ممکن نشد');
            }
        } finally {
            setPasswordSaving(false);
        }
    };

    return (
        <motion.div key={showPasswordForm ? 'password' : 'privacy'} className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
            <div className="profile__header">
                <div className="profile__header-side">
                    <button
                        type="button"
                        onClick={() => (showPasswordForm ? setShowPasswordForm(false) : onBack())}
                        className="profile__header-back back-icon-btn adm-tap"
                        aria-label="بازگشت"
                    >
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">{showPasswordForm ? 'تغییر رمز عبور' : 'حریم خصوصی و امنیت'}</h1>
            </div>

            {showPasswordForm ? (
                <div className="adm-content" onScroll={handleScroll}>
                    <form className="adm-card adm-form" onSubmit={submitPasswordChange}>
                        <PasswordField
                            label="رمز عبور فعلی"
                            icon={<KeyRound size={16} />}
                            value={currentPassword}
                            onChange={(value) => {
                                setCurrentPassword(value);
                                setPasswordError('');
                            }}
                            placeholder="رمز عبور فعلی"
                            autoComplete="current-password"
                        />
                        <PasswordField
                            label="رمز عبور جدید"
                            icon={<KeyRound size={16} />}
                            value={newPassword}
                            onChange={(value) => {
                                setNewPassword(value);
                                setPasswordError('');
                            }}
                            placeholder="رمز عبور جدید"
                            autoComplete="new-password"
                        />
                        <PasswordField
                            label="تکرار رمز عبور جدید"
                            icon={<KeyRound size={16} />}
                            value={confirmPassword}
                            onChange={(value) => {
                                setConfirmPassword(value);
                                setPasswordError('');
                            }}
                            placeholder="تکرار رمز عبور جدید"
                            autoComplete="new-password"
                        />
                        {passwordError && <div className="adm-field-error">{passwordError}</div>}
                        <button
                            type="submit"
                            className="adm-btn adm-btn--primary adm-btn--block adm-tap"
                            disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
                        >
                            {passwordSaving ? 'در حال ذخیره...' : 'ذخیره رمز عبور'}
                        </button>
                    </form>
                </div>
            ) : (
                <div className="adm-content" onScroll={handleScroll}>
                    <div className="adm-card adm-card--switch">
                        <div className="adm-card__title">
                            <EyeOff size={18} />
                            بستن آنلاین بودن
                        </div>
                        <button
                            type="button"
                            onClick={toggleHideOnline}
                            disabled={saving}
                            role="switch"
                            aria-checked={hideOnline}
                            aria-label="بستن آنلاین بودن"
                            className={cx('adm-switch', hideOnline && 'adm-switch--on')}
                        >
                            <span className="adm-switch__thumb" />
                        </button>
                    </div>

                    <button
                        type="button"
                        className="adm-settings-row adm-tap"
                        onClick={() => setShowPasswordForm(true)}
                    >
                        <span className="adm-settings-row__label">
                            <KeyRound size={18} /> تغییر رمز عبور
                        </span>
                        <ChevronLeft size={18} className="adm-settings-row__chevron" />
                    </button>
                </div>
            )}
        </motion.div>
    );
}
