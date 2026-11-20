import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, Copy, Download, Eye, EyeOff, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import TelegramIcon from './TelegramIcon';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';
import { useNow } from '../hooks/useNow';
import { formatDeletionCountdown } from '../utils/deletionTimer';
import { apiFetch, getAuthToken } from '../config/api';
import { notify } from '../utils/notificationBus';
import { PasswordField } from './PasswordField';
import { RecoveryPhraseInputs } from './RecoveryPhraseInputs';
import {
    decryptRecoveryPhraseWithPrivateKey,
    ensureRecoveryBundleForUser,
    rewrapPrivateKeyWithRecoveryPhrase,
    validateRecoveryPhrase,
} from '../utils/e2ee';
import { downloadRecoveryCardImage } from '../utils/recoveryCardImage';
import { toPersianDigits } from '../utils/format';
import type { PrivacyVisibility, User } from '../types';
import './admin/admin.css';

interface PrivacySettingsProps {
    onBack: () => void;
    currentUser: User | null;
    hasUnconfirmedRecovery?: boolean;
    onUpdateCurrentUser?: (updates: Partial<User>) => void;
    onLogout?: () => void;
}

type PrivacyView = 'main' | 'password' | 'recoveryPhrase' | 'deleteAccount';
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

export function PrivacySettings({ onBack, currentUser, hasUnconfirmedRecovery = false, onUpdateCurrentUser, onLogout }: PrivacySettingsProps) {
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
    const [recoveryInputWords, setRecoveryInputWords] = useState<string[]>(() => Array(12).fill(''));
    const [passwordError, setPasswordError] = useState('');
    const [passwordSaving, setPasswordSaving] = useState(false);

    const [recoveryWords, setRecoveryWords] = useState<string[] | null>(null);
    const [recoveryLoading, setRecoveryLoading] = useState(false);
    const [recoveryError, setRecoveryError] = useState('');
    const [wordsHidden, setWordsHidden] = useState(true);
    const [copiedWords, setCopiedWords] = useState(false);
    const [confirmingRecovery, setConfirmingRecovery] = useState(false);
    const [verifyModalOpen, setVerifyModalOpen] = useState(false);
    const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
    const [verifyInputs, setVerifyInputs] = useState<string[]>(['', '', '']);
    const [verifyInvalidIndices, setVerifyInvalidIndices] = useState<number[]>([]);

    const [deletePassword, setDeletePassword] = useState('');
    const [deleteError, setDeleteError] = useState('');
    const [deleteSaving, setDeleteSaving] = useState(false);
    const [cancelSaving, setCancelSaving] = useState(false);

    const scheduledFor = currentUser?.deletionScheduledFor ?? null;
    const now = useNow(Boolean(scheduledFor), 1000);
    const countdown = scheduledFor ? formatDeletionCountdown(scheduledFor, now) : '';
    const currentE2ee = currentUser?.e2ee ?? null;
    const onUpdateCurrentUserRef = useRef(onUpdateCurrentUser);
    onUpdateCurrentUserRef.current = onUpdateCurrentUser;

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
                target?.closest('.tg-list-item')
            ) {
                return;
            }
            setExpandedField(null);
            setPopoverPosition(null);
        };
        const handleClickCapture = (event: MouseEvent) => {
            const target = event.target as Element | null;
            if (!target?.closest('.tg-list-item')) return;
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

    useEffect(() => {
        if (view !== 'recoveryPhrase' && view !== 'password') return;
        const uid = currentUser?.chatId || '';
        const token = getAuthToken() || '';
        if (!uid || !token) return;
        let cancelled = false;

        const loadRecovery = async () => {
            if (view === 'recoveryPhrase') {
                setWordsHidden(true);
                setRecoveryLoading(true);
                setRecoveryError('');
            }
            try {
                let e2ee = currentE2ee;
                if (!e2ee?.recoveryEncryptedPrivateKey || !e2ee?.encryptedRecoveryPhrase) {
                    const synced = await ensureRecoveryBundleForUser(uid, e2ee, token);
                    if (cancelled) return;
                    if (synced && synced !== e2ee) {
                        e2ee = synced;
                        onUpdateCurrentUserRef.current?.({ e2ee: synced });
                    }
                }
                if (view === 'recoveryPhrase') {
                    const words = await decryptRecoveryPhraseWithPrivateKey(e2ee?.encryptedRecoveryPhrase, uid);
                    if (cancelled) return;
                    if (words) {
                        setRecoveryWords(words);
                    } else {
                        setRecoveryError('دریافت کلمات بازیابی از کلید این دستگاه ممکن نشد');
                    }
                }
            } catch {
                if (!cancelled && view === 'recoveryPhrase') {
                    setRecoveryError('خطا در بارگذاری کلمات بازیابی');
                }
            } finally {
                if (!cancelled && view === 'recoveryPhrase') {
                    setRecoveryLoading(false);
                }
            }
        };

        void loadRecovery();
        return () => {
            cancelled = true;
        };
    }, [view, currentUser?.chatId, currentE2ee]);

    const confirmRecoverySaved = async (showToast = false): Promise<boolean> => {
        if (confirmingRecovery || currentUser?.e2ee?.recoveryConfirmed) return true;
        setConfirmingRecovery(true);
        try {
            const res = await apiFetch('/e2ee/me/recovery/confirm', { method: 'POST' });
            if (res?.e2ee) {
                onUpdateCurrentUser?.({ e2ee: res.e2ee });
            } else if (currentUser?.e2ee) {
                onUpdateCurrentUser?.({ e2ee: { ...currentUser.e2ee, recoveryConfirmed: true } });
            }
            if (showToast) {
                notify({ type: 'success', message: 'ذخیره کلمات بازیابی تایید شد' });
            }
            return true;
        } catch {
            if (showToast) {
                notify({ type: 'error', message: 'ثبت تاییدیه ممکن نشد' });
            }
            return false;
        } finally {
            setConfirmingRecovery(false);
        }
    };

    const openVerifyRecoveryModal = () => {
        if (!recoveryWords || recoveryWords.length !== 12 || confirmingRecovery) return;
        setWordsHidden(true);
        const pool = Array.from({ length: 12 }, (_, i) => i);
        for (let i = pool.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = pool[i];
            pool[i] = pool[j];
            pool[j] = temp;
        }
        const picked = pool.slice(0, 3).sort((a, b) => a - b);
        setVerifyIndices(picked);
        setVerifyInputs(['', '', '']);
        setVerifyInvalidIndices([]);
        setVerifyModalOpen(true);
    };

    const submitVerifyRecovery = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!recoveryWords || verifyIndices.length !== 3 || confirmingRecovery) return;
        const mismatched: number[] = [];
        for (let i = 0; i < 3; i += 1) {
            const wordIndex = verifyIndices[i];
            const entered = (verifyInputs[i] || '').trim().toLowerCase();
            const expected = (recoveryWords[wordIndex] || '').trim().toLowerCase();
            if (!entered || entered !== expected) {
                mismatched.push(i);
            }
        }
        if (mismatched.length > 0) {
            setVerifyInvalidIndices(mismatched);
            return;
        }
        const ok = await confirmRecoverySaved(true);
        if (ok) {
            setVerifyModalOpen(false);
        }
    };

    const handleCopyRecoveryWords = async () => {
        if (!recoveryWords || recoveryWords.length !== 12) return;
        try {
            await navigator.clipboard.writeText(recoveryWords.join(' '));
            setCopiedWords(true);
            notify({ type: 'success', message: '۱۲ کلمه بازیابی کپی شدند' });
            window.setTimeout(() => setCopiedWords(false), 2000);
        } catch {
            notify({ type: 'error', message: 'کپی کردن کلمات ممکن نشد' });
        }
    };

    const handleDownloadRecoveryImage = () => {
        if (!recoveryWords || recoveryWords.length !== 12) return;
        const ok = downloadRecoveryCardImage(recoveryWords, currentUser?.username);
        if (ok) {
            notify({ type: 'success', message: 'تصویر کلمات بازیابی ذخیره شد' });
        } else {
            notify({ type: 'error', message: 'ساخت تصویر کلمات ممکن نشد' });
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
        if (!validateRecoveryPhrase(recoveryInputWords)) {
            setPasswordError('لطفاً هر ۱۲ کلمه بازیابی را به ترتیب و با املای صحیح وارد کنید');
            return;
        }

        setPasswordSaving(true);
        try {
            const uid = currentUser?.chatId || '';
            const token = getAuthToken() || '';
            let activeE2ee = currentUser?.e2ee || null;
            if (!activeE2ee?.recoveryEncryptedPrivateKey && uid && token) {
                activeE2ee = await ensureRecoveryBundleForUser(uid, activeE2ee, token);
                if (activeE2ee) onUpdateCurrentUser?.({ e2ee: activeE2ee });
            }
            const rewrapped = await rewrapPrivateKeyWithRecoveryPhrase(recoveryInputWords, newPassword, activeE2ee || {});
            if (!rewrapped) {
                setPasswordError('۱۲ کلمه بازیابی اشتباه است یا ترتیب آن‌ها درست نیست');
                return;
            }
            await apiFetch('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword, newPassword, e2ee: rewrapped }),
            });
            notify({ type: 'success', message: 'رمز عبور تغییر کرد. دوباره وارد شوید.' });
            onLogout?.();
        } catch (error: unknown) {
            const message = String((error as Error)?.message || '');
            if (message.includes('Current password is incorrect')) {
                setPasswordError('رمز عبور فعلی اشتباه است');
            } else if (message.includes('Recovery verification')) {
                setPasswordError('تایید ۱۲ کلمه بازیابی انجام نشد');
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
        recoveryPhrase: 'عبارت بازیابی ۱۲ کلمه‌ای',
        deleteAccount: 'حذف حساب',
    };

    const scheduledDate = scheduledFor
        ? new Date(scheduledFor).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' })
        : '';

    const recoveryConfirmed = Boolean(currentUser?.e2ee?.recoveryConfirmed);
    const allRecoveryWordsEntered = recoveryInputWords.every((w) => w.trim().length > 0);

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
                    {!recoveryConfirmed && (
                        <div className="adm-card nr-recovery-notice">
                            <div className="adm-card__title">
                                <KeyRound size={17} />
                                ابتدا ۱۲ کلمه بازیابی خود را ذخیره کنید
                            </div>
                            <p className="adm-card__text">
                                برای تغییر رمز عبور باید ۱۲ کلمه بازیابی حساب را به ترتیب وارد کنید. اگر هنوز آن‌ها را ندیده‌اید، از بخش عبارت بازیابی مشاهده کنید.
                            </p>
                            <button
                                type="button"
                                className="adm-btn nr-recovery-notice__btn"
                                onClick={() => setView('recoveryPhrase')}
                            >
                                مشاهده ۱۲ کلمه بازیابی
                            </button>
                        </div>
                    )}
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
                        <div className="nr-recovery-section">
                            <div className="nr-recovery-section__head">
                                <span className="nr-recovery-section__title">۱۲ کلمه بازیابی (به ترتیب)</span>
                                <span className="nr-recovery-section__hint">همه ۱۲ کلمه را از ۱ تا ۱۲ وارد کنید</span>
                            </div>
                            <RecoveryPhraseInputs
                                words={recoveryInputWords}
                                onChange={(next) => {
                                    setRecoveryInputWords(next);
                                    setPasswordError('');
                                }}
                                disabled={passwordSaving}
                                compact
                            />
                        </div>
                        {passwordError && <div className="adm-field-error">{passwordError}</div>}
                        <button
                            type="submit"
                            className="adm-btn adm-btn--primary adm-btn--block nr-primary-btn"
                            disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword || !allRecoveryWordsEntered}
                        >
                            {passwordSaving ? 'در حال ذخیره...' : 'ذخیره رمز عبور'}
                        </button>
                    </form>
                </div>
            ) : view === 'recoveryPhrase' ? (
                <div className="adm-content" onScroll={handleScroll}>
                    <div className="adm-card">
                        <div className="adm-card__title">
                            <ShieldCheck size={18} />
                            کلید بازیابی چت‌های رمزنگاری‌شده
                        </div>
                        <p className="adm-card__text">
                            این ۱۲ کلمه برای تغییر رمز عبور و بازیابی پیام‌های رمزنگاری‌شده هنگام فراموشی رمز ضروری است. آن را در جای امن نگهداری کنید و با هیچ‌کس به اشتراک نگذارید.
                        </p>
                    </div>

                    <div className="adm-card nr-mnemonic-card">
                        <div className="nr-mnemonic-card__header">
                            <span className="nr-mnemonic-card__title">عبارت ۱۲ کلمه‌ای شما</span>
                            <button
                                type="button"
                                className="nr-recovery-chip-btn"
                                onClick={() => setWordsHidden((prev) => !prev)}
                                disabled={recoveryLoading || !recoveryWords}
                            >
                                {wordsHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                                <span>{wordsHidden ? 'نمایش' : 'مخفی'}</span>
                            </button>
                        </div>

                        {recoveryLoading ? (
                            <div className="adm-empty">در حال بارگذاری کلمات بازیابی...</div>
                        ) : recoveryError ? (
                            <div className="adm-field-error">{recoveryError}</div>
                        ) : recoveryWords ? (
                            <div
                                className={cx('nr-mnemonic-grid', wordsHidden && 'nr-mnemonic-grid--hidden')}
                                dir="ltr"
                                onClick={() => {
                                    if (wordsHidden) setWordsHidden(false);
                                }}
                            >
                                {recoveryWords.map((word, index) => (
                                    <div key={index} className="nr-mnemonic-item">
                                        <span className="nr-mnemonic-item__num">{index + 1}.</span>
                                        <span className="nr-mnemonic-item__word">
                                            {wordsHidden ? '••••••' : word}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    {recoveryWords && (
                        <div className="nr-mnemonic-actions">
                            <button
                                type="button"
                                className="adm-btn nr-mnemonic-action-btn"
                                onClick={() => void handleCopyRecoveryWords()}
                            >
                                {copiedWords ? <Check size={16} /> : <Copy size={16} />}
                                <span>{copiedWords ? 'کپی شد' : 'کپی کلمات'}</span>
                            </button>
                            <button
                                type="button"
                                className="adm-btn nr-mnemonic-action-btn"
                                onClick={handleDownloadRecoveryImage}
                            >
                                <Download size={16} />
                                <span>ذخیره به عنوان تصویر</span>
                            </button>
                        </div>
                    )}

                    {recoveryWords && (
                        recoveryConfirmed ? (
                            <div className="nr-recovery-confirmed">
                                <Check size={16} />
                                <span>ذخیره‌سازی کلمات بازیابی تایید شده است</span>
                            </div>
                        ) : (
                            <button
                                type="button"
                                className="adm-btn adm-btn--primary adm-btn--block nr-primary-btn"
                                onClick={openVerifyRecoveryModal}
                                disabled={confirmingRecovery}
                            >
                                <Check size={18} />
                                <span>کلمات را یادداشت و ذخیره کردم</span>
                            </button>
                        )
                    )}
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
                <div className="profile__content tg-settings-scroll" onScroll={handleScroll}>
                    <div className="tg-island-title">امنیت</div>
                    <div className="tg-island">
                        <button
                            type="button"
                            className="tg-list-item"
                            onClick={() => setView('password')}
                        >
                            <span className="tg-icon-backdrop tg-icon-backdrop--green" aria-hidden="true">
                                <TelegramIcon name="2fa-filled" size={20} />
                            </span>
                            <span className="tg-list-item__copy">
                                <span className="tg-list-item__title">تغییر رمز عبور</span>
                                <span className="tg-list-item__subtitle">به‌روزرسانی رمز عبور با ۱۲ کلمه بازیابی</span>
                            </span>
                            <span className="tg-list-item__end">
                                <ChevronLeft size={18} />
                            </span>
                        </button>

                        <div className="tg-island__divider" aria-hidden="true" />

                        <button
                            type="button"
                            className="tg-list-item"
                            onClick={() => {
                                setWordsHidden(true);
                                setView('recoveryPhrase');
                            }}
                        >
                            <span className="tg-icon-backdrop tg-icon-backdrop--orange" aria-hidden="true">
                                <TelegramIcon name="key-filled" size={20} />
                            </span>
                            <span className="tg-list-item__copy">
                                <span className="tg-list-item__title">عبارت بازیابی ۱۲ کلمه‌ای</span>
                                <span className="tg-list-item__subtitle">مشاهده، کپی و ذخیره تصویر کلمات بازیابی</span>
                            </span>
                            <span className="tg-list-item__end">
                                {hasUnconfirmedRecovery && <span className="tg-list-item__dot" aria-hidden="true" />}
                                <ChevronLeft size={18} />
                            </span>
                        </button>

                        <div className="tg-island__divider" aria-hidden="true" />

                        <button
                            type="button"
                            className="tg-list-item tg-list-item--destructive"
                            onClick={() => setView('deleteAccount')}
                        >
                            <span className="tg-icon-backdrop tg-icon-backdrop--red" aria-hidden="true">
                                <TelegramIcon name="delete" size={20} />
                            </span>
                            <span className="tg-list-item__copy">
                                <span className="tg-list-item__title">حذف حساب</span>
                                <span className="tg-list-item__subtitle">حذف دائمی حساب کاربری و اطلاعات</span>
                            </span>
                            <span className="tg-list-item__end">
                                {scheduledFor && <span className="tg-list-item__dot tg-list-item__dot--danger" aria-hidden="true" />}
                                <ChevronLeft size={18} />
                            </span>
                        </button>
                    </div>

                    <div className="tg-island-title">حریم خصوصی</div>
                    <div className="tg-island" style={{ padding: '6px 10px' }}>
                        <div className="adm-privacy-list">
                            {renderPrivacyRow('lastSeenVisibility', 'آخرین بازدید')}
                            {renderPrivacyRow('avatarVisibility', 'عکس پروفایل')}
                            {renderPrivacyRow('bioVisibility', 'بیوگرافی')}
                        </div>
                    </div>
                </div>
            )}
            {renderPrivacyPopover()}
            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {verifyModalOpen && (
                        <motion.div
                            className="nr-verify-modal-backdrop"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            onClick={() => {
                                if (!confirmingRecovery) setVerifyModalOpen(false);
                            }}
                        >
                            <motion.div
                                className="nr-verify-modal"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="nr-verify-title"
                                dir="rtl"
                                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <h2 id="nr-verify-title" className="nr-verify-modal__title">
                                    تایید ذخیره کلمات بازیابی
                                </h2>
                                <p className="nr-verify-modal__desc">
                                    برای اطمینان از ذخیره صحیح کلمات، کلمه شماره{' '}
                                    {verifyIndices.map((idx, pos) => (
                                        <span key={idx}>
                                            <strong>{toPersianDigits(idx + 1)}</strong>
                                            {pos === 0 ? '، ' : pos === 1 ? ' و ' : ''}
                                        </span>
                                    ))}{' '}
                                    را وارد کنید:
                                </p>
                                <form className="nr-verify-fields" onSubmit={submitVerifyRecovery}>
                                    {verifyIndices.map((wordIndex, i) => (
                                        <label
                                            key={wordIndex}
                                            className={cx('nr-verify-pill', verifyInvalidIndices.includes(i) && 'nr-verify-pill--invalid')}
                                            dir="ltr"
                                        >
                                            <span className="nr-verify-pill__num">
                                                {toPersianDigits(wordIndex + 1)}.
                                            </span>
                                            <input
                                                type="text"
                                                className="nr-verify-pill__input"
                                                value={verifyInputs[i] || ''}
                                                onChange={(e) => {
                                                    const next = [...verifyInputs];
                                                    next[i] = e.target.value.toLowerCase();
                                                    setVerifyInputs(next);
                                                    setVerifyInvalidIndices((prev) => prev.filter((item) => item !== i));
                                                }}
                                                placeholder="..."
                                                dir="ltr"
                                                autoComplete="off"
                                                autoCorrect="off"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                autoFocus={i === 0}
                                                disabled={confirmingRecovery}
                                            />
                                        </label>
                                    ))}
                                    <div className="nr-verify-modal__actions">
                                        <button
                                            type="button"
                                            className="adm-btn nr-mnemonic-action-btn"
                                            onClick={() => setVerifyModalOpen(false)}
                                            disabled={confirmingRecovery}
                                        >
                                            انصراف
                                        </button>
                                        <button
                                            type="submit"
                                            className="adm-btn adm-btn--primary nr-primary-btn"
                                            disabled={confirmingRecovery || verifyInputs.some((v) => !v.trim())}
                                        >
                                            {confirmingRecovery ? 'در حال ثبت...' : 'تایید و ثبت'}
                                        </button>
                                    </div>
                                </form>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </motion.div>
    );
}
