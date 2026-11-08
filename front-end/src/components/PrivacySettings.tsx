import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, KeyRound, Shield, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';
import { useNow } from '../hooks/useNow';
import { formatDeletionCountdown } from '../utils/deletionTimer';
import { apiFetch } from '../config/api';
import { notify } from '../utils/notificationBus';
import { PasswordField } from './PasswordField';
import { generateUserE2EEBundle, rewrapPrivateKeyWithNewPassword } from '../utils/e2ee';
import type { PrivacyVisibility, User } from '../types';
import './admin/admin.css';

interface PrivacySettingsProps {
    onBack: () => void;
    currentUser: User | null;
    onUpdateCurrentUser?: (updates: Partial<User>) => void;
    onLogout?: () => void;
}

type PrivacyView = 'main' | 'password' | 'deleteAccount';
type PrivacyField = 'lastSeenVisibility' | 'avatarVisibility' | 'bioVisibility';

const PRIVACY_POPOVER_WIDTH = 168;
const PRIVACY_POPOVER_HEIGHT = 148;
const PRIVACY_POPOVER_GAP = 0;

const PRIVACY_FIELD_LABELS: Record<PrivacyField, string> = {
    lastSeenVisibility: 'آخرین بازدید',
    avatarVisibility: 'عکس پروفایل',
    bioVisibility: 'بیوگرافی',
};

const VISIBILITY_OPTIONS: Record<PrivacyField, Array<{ value: PrivacyVisibility; label: string; hint: string }>> = {
    lastSeenVisibility: [
        {
            value: 'everyone',
            label: 'نمایش همه',
            hint: 'آخرین بازدید شما برای همه کاربران نمایش داده می‌شود.',
        },
        {
            value: 'friends',
            label: 'نمایش دوستان',
            hint: 'فقط کاربرانی که با آن‌ها گفتگوی دوطرفه داشته‌اید آخرین بازدید شما را می‌بینند.',
        },
        {
            value: 'nobody',
            label: 'بسته',
            hint: 'آخرین بازدید شما برای هیچ‌کس نمایش داده نمی‌شود و دیگران «به تازگی» می‌بینند.',
        },
    ],
    avatarVisibility: [
        {
            value: 'everyone',
            label: 'نمایش همه',
            hint: 'عکس پروفایل شما برای همه کاربران نمایش داده می‌شود.',
        },
        {
            value: 'friends',
            label: 'نمایش دوستان',
            hint: 'فقط کاربرانی که با آن‌ها گفتگوی دوطرفه داشته‌اید عکس پروفایل شما را می‌بینند.',
        },
        {
            value: 'nobody',
            label: 'بسته',
            hint: 'عکس پروفایل شما برای هیچ‌کس نمایش داده نمی‌شود.',
        },
    ],
    bioVisibility: [
        {
            value: 'everyone',
            label: 'نمایش همه',
            hint: 'بیوگرافی شما برای همه کاربران نمایش داده می‌شود.',
        },
        {
            value: 'friends',
            label: 'نمایش دوستان',
            hint: 'فقط کاربرانی که با آن‌ها گفتگوی دوطرفه داشته‌اید بیوگرافی شما را می‌بینند.',
        },
        {
            value: 'nobody',
            label: 'بسته',
            hint: 'بیوگرافی شما برای هیچ‌کس نمایش داده نمی‌شود.',
        },
    ],
};

export function PrivacySettings({ onBack, currentUser, onUpdateCurrentUser, onLogout }: PrivacySettingsProps) {
    const { scrolled, handleScroll } = useScrollFade();
    const [privacy, setPrivacy] = useState<Record<PrivacyField, PrivacyVisibility>>({
        lastSeenVisibility: currentUser?.lastSeenVisibility ?? (currentUser?.hideOnlineStatus ? 'nobody' : 'everyone'),
        avatarVisibility: currentUser?.avatarVisibility ?? 'everyone',
        bioVisibility: currentUser?.bioVisibility ?? 'everyone',
    });
    const [savingPrivacy, setSavingPrivacy] = useState<PrivacyField | null>(null);
    const [expandedField, setExpandedField] = useState<PrivacyField | null>(null);
    const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);

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

    const closePrivacyPopover = () => {
        setExpandedField(null);
        setPopoverPosition(null);
    };

    useEffect(() => {
        if (!expandedField) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Element | null;
            if (
                target?.closest('.adm-privacy-popover') ||
                target?.closest('.adm-privacy-row__head') ||
                target?.closest('.adm-settings-row')
            ) {
                return;
            }
            setExpandedField(null);
            setPopoverPosition(null);
        };
        const handleClickCapture = (event: MouseEvent) => {
            const target = event.target as Element | null;
            if (!target?.closest('.adm-settings-row')) return;
            event.preventDefault();
            event.stopPropagation();
            setExpandedField(null);
            setPopoverPosition(null);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setExpandedField(null);
                setPopoverPosition(null);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('click', handleClickCapture, true);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('click', handleClickCapture, true);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [expandedField]);

    const togglePrivacyPopover = (field: PrivacyField, event: React.MouseEvent<HTMLButtonElement>) => {
        if (expandedField) {
            closePrivacyPopover();
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        let top = rect.bottom + PRIVACY_POPOVER_GAP;
        if (top + PRIVACY_POPOVER_HEIGHT > viewportHeight - PRIVACY_POPOVER_GAP) {
            top = Math.max(PRIVACY_POPOVER_GAP, rect.top - PRIVACY_POPOVER_HEIGHT - PRIVACY_POPOVER_GAP);
        }
        const left = Math.min(
            Math.max(PRIVACY_POPOVER_GAP, rect.left),
            window.innerWidth - PRIVACY_POPOVER_WIDTH - PRIVACY_POPOVER_GAP
        );
        setPopoverPosition({ top, left });
        setExpandedField(field);
    };

    const updateVisibility = async (field: PrivacyField, value: PrivacyVisibility) => {
        if (savingPrivacy) return;
        if (privacy[field] === value) {
            closePrivacyPopover();
            return;
        }
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(10);
        }
        setSavingPrivacy(field);

        try {
            const result = await apiFetch('/profile/me/privacy', {
                method: 'PATCH',
                body: JSON.stringify({ [field]: value }),
            });
            setPrivacy((prev) => ({ ...prev, [field]: value }));
            onUpdateCurrentUser?.(result);
            closePrivacyPopover();
        } catch {
            notify({
                type: 'error',
                message: 'خطا در ذخیره تنظیمات حریم خصوصی.',
            });
        } finally {
            setSavingPrivacy(null);
        }
    };

    const renderPrivacyRow = (field: PrivacyField, label: string) => {
        const selectedOption = VISIBILITY_OPTIONS[field].find((option) => option.value === privacy[field]);
        const expanded = expandedField === field;
        return (
            <div className={cx('adm-privacy-row', expanded && 'adm-privacy-row--expanded')}>
                <button
                    type="button"
                    className="adm-privacy-row__head"
                    onClick={(event) => togglePrivacyPopover(field, event)}
                    aria-expanded={expanded}
                    aria-label={`انتخاب ${label}`}
                >
                    <span className="adm-privacy-row__label">{label}</span>
                    <span className="adm-privacy-row__value">
                        {selectedOption?.label}
                        <ChevronDown
                            size={16}
                            className={cx('adm-privacy-row__chevron', expanded && 'adm-privacy-row__chevron--open')}
                        />
                    </span>
                </button>

                {selectedOption && (
                    <span className="adm-privacy-row__hint">{selectedOption.hint}</span>
                )}
            </div>
        );
    };

    const renderPrivacyPopover = () => {
        if (!expandedField || !popoverPosition || typeof document === 'undefined') return null;
        return createPortal(
            <>
                <div className="adm-privacy-overlay" aria-hidden="true" />
                <div
                    className="adm-privacy-popover"
                    role="radiogroup"
                    aria-label={PRIVACY_FIELD_LABELS[expandedField]}
                    style={{ top: popoverPosition.top, left: popoverPosition.left }}
                >
                    {VISIBILITY_OPTIONS[expandedField].map((option) => {
                        const selected = privacy[expandedField] === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                className={cx(
                                    'adm-privacy-popover__item',
                                    selected && 'adm-privacy-popover__item--selected'
                                )}
                                onClick={() => updateVisibility(expandedField, option.value)}
                                disabled={Boolean(savingPrivacy)}
                            >
                                <span>{option.label}</span>
                                {selected && <Check size={14} />}
                            </button>
                        );
                    })}
                </div>
            </>,
            document.body
        );
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
            const rewrapped = await rewrapPrivateKeyWithNewPassword(newPassword, undefined, undefined, currentUser?.chatId || '');
            const e2ee = rewrapped || (await generateUserE2EEBundle(newPassword)).bundle;
            await apiFetch('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword, newPassword, e2ee }),
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
                    <section className="adm-card">
                        <div className="adm-card__title">
                            <Shield size={18} />
                            حریم خصوصی
                        </div>
                        <div className="adm-privacy-list">
                            {renderPrivacyRow('lastSeenVisibility', 'آخرین بازدید')}
                            {renderPrivacyRow('avatarVisibility', 'عکس پروفایل')}
                            {renderPrivacyRow('bioVisibility', 'بیوگرافی')}
                        </div>
                    </section>

                    <button
                        type="button"
                        className={cx('adm-settings-row', 'adm-settings-row--top-gap', !expandedField && 'adm-tap')}
                        onClick={() => setView('password')}
                    >
                        <span className="adm-settings-row__label">
                            <KeyRound size={18} /> تغییر رمز عبور
                        </span>
                        <ChevronLeft size={18} className="adm-settings-row__chevron" />
                    </button>

                    <button
                        type="button"
                        className={cx('adm-settings-row', 'adm-settings-row--danger', !expandedField && 'adm-tap')}
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
            {renderPrivacyPopover()}
        </motion.div>
    );
}
