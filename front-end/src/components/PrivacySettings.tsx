import { useState } from 'react';
import { AlertTriangle, ChevronLeft, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';
import { useNow } from '../hooks/useNow';
import { formatDeletionCountdown } from '../utils/deletionTimer';
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

type PrivacyView = 'main' | 'password' | 'deleteAccount';

export function PrivacySettings({ onBack, currentUser, onUpdateCurrentUser, onLogout }: PrivacySettingsProps) {
    const { scrolled, handleScroll } = useScrollFade();
    const [hideOnline, setHideOnline] = useState<boolean>(Boolean(currentUser?.hideOnlineStatus));
    const [saving, setSaving] = useState(false);

    const [view, setView] = useState<PrivacyView>('main');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [passwordSaving, setPasswordSaving] = useState(false);

    const [deletePassword, setDeletePassword] = useState('');
    const [deleteError, setDeleteError] = useState('');
    const [deleteSaving, setDeleteSaving] = useState(false);
    const [cancelSaving, setCancelSaving] = useState(false);

    const scheduledFor = currentUser?.deletionScheduledFor ?? null;
    const now = useNow(Boolean(scheduledFor), 1000);
    const countdown = scheduledFor ? formatDeletionCountdown(scheduledFor, now) : '';

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

    const submitAccountDeletion = async (event: React.FormEvent) => {
        event.preventDefault();
        setDeleteError('');
        if (!deletePassword || deleteSaving) return;

        setDeleteSaving(true);
        try {
            const result = await apiFetch('/account/deletion', {
                method: 'POST',
                body: JSON.stringify({ password: deletePassword }),
            });
            onUpdateCurrentUser?.({ deletionScheduledFor: result.scheduledFor });
            setDeletePassword('');
            notify({
                type: 'success',
                message: 'حذف حساب شما تا ۲۴ ساعت دیگر انجام می‌شود. تا آن زمان می‌توانید آن را لغو کنید.',
            });
        } catch (error: unknown) {
            const err = error as { status?: number; message?: string };
            const message = String(err?.message || '');
            if (message.includes('Password is incorrect')) {
                setDeleteError('رمز عبور اشتباه است');
            } else if (Number(err?.status) === 409) {
                setDeleteError('درخواست حذف قبلا ثبت شده است');
            } else {
                setDeleteError('ثبت درخواست حذف ممکن نشد');
            }
        } finally {
            setDeleteSaving(false);
        }
    };

    const cancelAccountDeletion = async () => {
        if (cancelSaving) return;
        setCancelSaving(true);
        setDeleteError('');
        try {
            await apiFetch('/account/deletion/cancel', { method: 'POST' });
            onUpdateCurrentUser?.({ deletionScheduledFor: null });
            notify({ type: 'success', message: 'حذف حساب لغو شد.' });
        } catch {
            setDeleteError('لغو حذف حساب ممکن نشد');
        } finally {
            setCancelSaving(false);
        }
    };

    const titles: Record<PrivacyView, string> = {
        main: 'حریم خصوصی و امنیت',
        password: 'تغییر رمز عبور',
        deleteAccount: 'حذف حساب',
    };

    const scheduledDate = scheduledFor
        ? new Date(scheduledFor).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' })
        : '';

    return (
        <motion.div key={view} className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
            <div className="profile__header">
                <div className="profile__header-side">
                    <button
                        type="button"
                        onClick={() => (view === 'main' ? onBack() : setView('main'))}
                        className="profile__header-back back-icon-btn adm-tap"
                        aria-label="بازگشت"
                    >
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">{titles[view]}</h1>
            </div>

            {view === 'password' ? (
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
            ) : view === 'deleteAccount' ? (
                <div className="adm-content" onScroll={handleScroll}>
                    {scheduledFor ? (
                        <>
                            <div className="adm-card">
                                <div className="adm-card__title">
                                    <AlertTriangle size={18} />
                                    حذف حساب زمان‌بندی شده است
                                </div>
                                <p className="adm-card__text">
                                    حساب شما به طور کامل حذف می‌شود.
                                </p>
                                <div className="adm-deletion-timer" dir="ltr">{countdown}</div>
                                <p className="adm-card__text">
                                    زمان حذف: {scheduledDate}
                                </p>
                            </div>
                            {deleteError && <div className="adm-field-error">{deleteError}</div>}
                            <button
                                type="button"
                                className="adm-btn adm-btn--block adm-btn--primary adm-tap"
                                onClick={cancelAccountDeletion}
                                disabled={cancelSaving}
                            >
                                {cancelSaving ? 'در حال لغو...' : 'لغو حذف حساب'}
                            </button>
                        </>
                    ) : (
                        <form className="adm-form" onSubmit={submitAccountDeletion}>
                            <div className="adm-card">
                                <div className="adm-card__title">
                                    <AlertTriangle size={18} />
                                    حذف دائمی حساب
                                </div>
                                <p className="adm-card__text">
                                    همه اطلاعات شما برای همیشه پاک می‌شود. این کار قابل بازگشت نیست.
                                </p>
                            </div>
                            <PasswordField
                                label="رمز عبور حساب"
                                icon={<KeyRound size={16} />}
                                value={deletePassword}
                                onChange={(value) => {
                                    setDeletePassword(value);
                                    setDeleteError('');
                                }}
                                placeholder="رمز عبور حساب"
                                autoComplete="current-password"
                            />
                            {deleteError && <div className="adm-field-error">{deleteError}</div>}
                            <button
                                type="submit"
                                className="adm-btn adm-btn--danger adm-btn--block adm-tap"
                                disabled={deleteSaving || !deletePassword}
                            >
                                <Trash2 size={18} />
                                {deleteSaving ? 'در حال ثبت...' : 'تایید حذف حساب'}
                            </button>
                        </form>
                    )}
                </div>
            ) : (
                <div className="adm-content" onScroll={handleScroll}>
                    <div className="adm-card adm-card--switch adm-card--pill">
                        <div className="adm-card__title">
                            <EyeOff size={18} />
                            مخفی کردن آخرین بازدید
                        </div>
                        <button
                            type="button"
                            onClick={toggleHideOnline}
                            disabled={saving}
                            role="switch"
                            aria-checked={hideOnline}
                            aria-label="مخفی کردن آخرین بازدید"
                            className={cx('adm-switch', hideOnline && 'adm-switch--on')}
                        >
                            <span className="adm-switch__thumb" />
                        </button>
                    </div>

                    <button
                        type="button"
                        className="adm-settings-row adm-tap"
                        onClick={() => setView('password')}
                    >
                        <span className="adm-settings-row__label">
                            <KeyRound size={18} /> تغییر رمز عبور
                        </span>
                        <ChevronLeft size={18} className="adm-settings-row__chevron" />
                    </button>

                    <button
                        type="button"
                        className="adm-settings-row adm-settings-row--danger adm-tap"
                        onClick={() => setView('deleteAccount')}
                    >
                        <span className="adm-settings-row__label">
                            <Trash2 size={18} /> حذف حساب
                        </span>
                        {scheduledFor && <span className="adm-dot-danger" aria-hidden="true" />}
                        <ChevronLeft size={18} className="adm-settings-row__chevron" />
                    </button>
                </div>
            )}
        </motion.div>
    );
}
