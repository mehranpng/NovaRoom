import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Clock, Copy, KeyRound, Loader2, ShieldCheck, UserCheck, X } from 'lucide-react';
import { apiFetch } from '../../config/api';
import { cx } from '../../utils/cx';
import { notify } from '../../utils/notificationBus';
import { copyText } from '../../utils/clipboard';
import { VerifiedBadge } from '../VerifiedBadge';
import { AdminLinkBox } from './AdminLinkBox';
import type { AdminUserItem, AdminUserDetailData } from './adminTypes';
import './admin.css';

interface AdminUserDetailProps {
    chatId: string;
    onUpdated: (chatId: string, patch: Partial<AdminUserItem>) => void;
}

interface PasswordLink {
    path: string;
    expiresAt: string;
}

const expiryOptions = [
    { value: 30, label: '۳۰ دقیقه' },
    { value: 60, label: '۱ ساعت' },
    { value: 180, label: '۳ ساعت' },
    { value: 360, label: '۶ ساعت' },
    { value: 720, label: '۱۲ ساعت' },
    { value: 1440, label: '۲۴ ساعت' },
];

type ConfirmModalKind = null | 'verify' | 'unverify' | 'promote' | 'demote';

export function AdminUserDetail({ chatId, onUpdated }: AdminUserDetailProps) {
    const [detail, setDetail] = useState<AdminUserDetailData | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmModal, setConfirmModal] = useState<ConfirmModalKind>(null);
    const [copiedChatId, setCopiedChatId] = useState(false);
    const [passwordModalOpen, setPasswordModalOpen] = useState(false);
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [expiresInMinutes, setExpiresInMinutes] = useState(30);
    const [passwordLink, setPasswordLink] = useState<PasswordLink | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setDetail(null);
        setPasswordLink(null);
        setPasswordModalOpen(false);
        setConfirmModal(null);
        apiFetch(`/admin/users/${encodeURIComponent(chatId)}`)
            .then((data) => {
                if (!cancelled) setDetail(data);
            })
            .catch(() => {
                if (!cancelled) notify({ type: 'error', message: 'دریافت اطلاعات کاربر ممکن نشد' });
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [chatId]);

    useEffect(() => {
        if (!passwordModalOpen && !confirmModal) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setPasswordModalOpen(false);
                setConfirmModal(null);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [passwordModalOpen, confirmModal]);

    const toggleVerified = async () => {
        if (!detail || actionLoading) return;
        const nextVerified = !detail.verified;
        setActionLoading(true);
        try {
            await apiFetch(`/admin/users/${encodeURIComponent(detail.chatId)}/verify`, {
                method: 'POST',
                body: JSON.stringify({ verified: nextVerified }),
            });
            setDetail({ ...detail, verified: nextVerified });
            onUpdated(detail.chatId, { verified: nextVerified });
            setConfirmModal(null);
            notify({ type: 'success', message: nextVerified ? 'تایید کاربر فعال شد' : 'تایید کاربر غیرفعال شد' });
        } catch {
            notify({ type: 'error', message: 'تغییر وضعیت تایید ممکن نشد' });
        } finally {
            setActionLoading(false);
        }
    };

    const setAdminLevel = async (level: 'admin1' | null) => {
        if (!detail || actionLoading) return;
        setActionLoading(true);
        try {
            await apiFetch(`/admin/users/${encodeURIComponent(detail.chatId)}/admin-level`, {
                method: 'POST',
                body: JSON.stringify({ level }),
            });
            setDetail({ ...detail, adminLevel: level });
            onUpdated(detail.chatId, { adminLevel: level });
            setConfirmModal(null);
            notify({ type: 'success', message: level ? 'کاربر به ادمین ۱ ارتقا یافت' : 'دسترسی ادمین حذف شد' });
        } catch {
            notify({ type: 'error', message: 'تغییر سطح دسترسی ممکن نشد' });
        } finally {
            setActionLoading(false);
        }
    };

    const createPasswordLink = async () => {
        if (!detail || passwordLoading) return;
        setPasswordLoading(true);
        try {
            const data = await apiFetch(`/admin/users/${encodeURIComponent(detail.chatId)}/password-link`, {
                method: 'POST',
                body: JSON.stringify({ expiresInMinutes }),
            });
            setPasswordLink({ path: data.path, expiresAt: data.expiresAt });
        } catch {
            notify({ type: 'error', message: 'ساخت لینک تغییر رمز ممکن نشد' });
        } finally {
            setPasswordLoading(false);
        }
    };

    const copyChatId = async () => {
        if (!detail) return;
        try {
            await copyText(detail.chatId);
            setCopiedChatId(true);
            notify({ type: 'success', message: 'آیدی کپی شد' });
            window.setTimeout(() => setCopiedChatId(false), 1500);
        } catch {
            notify({ type: 'error', message: 'کپی آیدی ممکن نشد' });
        }
    };

    const targetIsOwner = detail?.adminLevel === 'admin0';
    const selectedLabel = expiryOptions.find((opt) => opt.value === expiresInMinutes)?.label || '۳۰ دقیقه';

    const confirmMeta =
        confirmModal && detail
            ? confirmModal === 'verify'
                ? {
                      title: 'تایید حساب کاربری؟',
                      text: `آیا مطمئنی که می‌خواهی حساب کاربری @${detail.username} را تایید کنی؟`,
                      confirmLabel: 'تایید حساب',
                      danger: false,
                      onConfirm: toggleVerified,
                  }
                : confirmModal === 'unverify'
                  ? {
                        title: 'لغو تایید حساب کاربری؟',
                        text: `آیا مطمئنی که می‌خواهی تایید حساب کاربری @${detail.username} را لغو کنی؟`,
                        confirmLabel: 'لغو تایید',
                        danger: true,
                        onConfirm: toggleVerified,
                    }
                  : confirmModal === 'promote'
                    ? {
                          title: 'ارتقا به ادمین ۱؟',
                          text: `آیا مطمئنی که می‌خواهی @${detail.username} را به ادمین ۱ ارتقا دهی؟`,
                          confirmLabel: 'ارتقا به ادمین ۱',
                          danger: false,
                          onConfirm: () => setAdminLevel('admin1'),
                      }
                    : {
                          title: 'حذف دسترسی ادمین؟',
                          text: `آیا مطمئنی که می‌خواهی دسترسی ادمین را از @${detail.username} بگیری؟`,
                          confirmLabel: 'حذف دسترسی',
                          danger: true,
                          onConfirm: () => setAdminLevel(null),
                      }
            : null;

    return (
        <div className="adm-content">
            {loading && !detail && (
                <>
                    <div className="adm-card adm-hero">
                        <div className="skeleton adm-skeleton-line adm-skeleton-line--hero-title" />
                        <div className="skeleton adm-skeleton-line adm-skeleton-line--hero-sub" />
                    </div>
                    <div className="adm-card">
                        <div className="adm-kv">
                            {[1, 2, 3, 4].map((index) => (
                                <div key={index} className="adm-kv__row">
                                    <div className="skeleton adm-skeleton-line adm-skeleton-line--kv-label" />
                                    <div className="skeleton adm-skeleton-line adm-skeleton-line--kv-value" />
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {detail && (
                <>
                    <div className="adm-card adm-hero">
                        <div className="adm-hero__name">
                            <span>{detail.name || detail.username}</span>
                            {detail.verified && <VerifiedBadge size={16} />}
                        </div>
                        <div className="adm-hero__username">@{detail.username}</div>
                        <div className="adm-hero__badges">
                            <span className="adm-row__status">
                                <span className={cx('adm-status-dot', detail.online && 'adm-status-dot--online')} />
                                {detail.online ? 'آنلاین' : 'آفلاین'}
                            </span>
                            {detail.adminLevel && (
                                <span className="adm-badge">{detail.adminLevel === 'admin0' ? 'ادمین ۰' : 'ادمین ۱'}</span>
                            )}
                        </div>
                    </div>

                    <div className="adm-card">
                        <div className="adm-kv">
                            <div className="adm-kv__row">
                                <span className="adm-kv__label">آیدی چت</span>
                                <span className="adm-kv__value adm-kv__value--ltr">
                                    <span>{detail.chatId}</span>
                                    <button
                                        type="button"
                                        className="adm-copy-btn adm-tap"
                                        onClick={copyChatId}
                                        aria-label="کپی آیدی چت"
                                    >
                                        {copiedChatId ? <Check size={14} /> : <Copy size={14} />}
                                    </button>
                                </span>
                            </div>
                            <div className="adm-kv__row">
                                <span className="adm-kv__label">تاریخ ثبت‌ نام</span>
                                <span className="adm-kv__value adm-kv__value--ltr">{detail.registrationDate || '-'}</span>
                            </div>
                            <div className="adm-kv__row">
                                <span className="adm-kv__label">وضعیت</span>
                                <span className="adm-kv__value">{detail.online ? 'آنلاین' : 'آفلاین'}</span>
                            </div>
                            {detail.email && (
                                <div className="adm-kv__row">
                                    <span className="adm-kv__label">ایمیل</span>
                                    <span className="adm-kv__value adm-kv__value--ltr"><span>{detail.email}</span></span>
                                </div>
                            )}
                            <div className="adm-kv__row">
                                <span className="adm-kv__label">تعداد نشست‌ های فعال</span>
                                <span className="adm-kv__value adm-kv__value--ltr">{detail.sessionsCount}</span>
                            </div>
                        </div>
                    </div>

                    <div className="adm-actions">
                        <button
                            type="button"
                            className="adm-btn adm-btn--block adm-tap"
                            onClick={() => setConfirmModal(detail.verified ? 'unverify' : 'verify')}
                            disabled={actionLoading}
                        >
                            {actionLoading ? <Loader2 size={18} className="adm-spin" /> : <UserCheck size={18} />}
                            {detail.verified ? 'لغو تایید حساب' : 'تایید حساب'}
                        </button>

                        {!targetIsOwner && (
                            <>
                                <button
                                    type="button"
                                    className="adm-btn adm-btn--block adm-tap"
                                    onClick={() => setConfirmModal(detail.adminLevel === 'admin1' ? 'demote' : 'promote')}
                                    disabled={actionLoading}
                                >
                                    <ShieldCheck size={18} />
                                    {detail.adminLevel === 'admin1' ? 'حذف دسترسی ادمین' : 'ارتقا به ادمین ۱'}
                                </button>

                                <button
                                    type="button"
                                    className="adm-btn adm-btn--block adm-tap"
                                    onClick={() => setPasswordModalOpen(true)}
                                >
                                    <KeyRound size={18} />
                                    ساخت لینک تغییر رمز
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}

            <AnimatePresence>
                {confirmMeta && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        style={{ zIndex: 120 }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        onClick={() => !actionLoading && setConfirmModal(null)}
                    >
                        <motion.div
                            className="chat-room-confirm-modal"
                            onClick={(event) => event.stopPropagation()}
                            initial={{ opacity: 0, y: 14, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h3 className="chat-room-confirm-modal__title">{confirmMeta.title}</h3>
                            <p className="chat-room-confirm-modal__text">{confirmMeta.text}</p>
                            <div className="chat-room-confirm-modal__actions">
                                <button
                                    type="button"
                                    className="chat-room-confirm-modal__btn"
                                    onClick={() => setConfirmModal(null)}
                                    disabled={actionLoading}
                                >
                                    لغو
                                </button>
                                <button
                                    type="button"
                                    className={cx(
                                        'chat-room-confirm-modal__btn',
                                        confirmMeta.danger ? 'chat-room-confirm-modal__btn--danger' : 'adm-btn--primary'
                                    )}
                                    onClick={confirmMeta.onConfirm}
                                    disabled={actionLoading}
                                >
                                    {confirmMeta.confirmLabel}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {passwordModalOpen && detail && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        style={{ zIndex: 120 }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        onClick={() => setPasswordModalOpen(false)}
                    >
                        <motion.div
                            className="chat-room-confirm-modal adm-modal"
                            onClick={(event) => event.stopPropagation()}
                            initial={{ opacity: 0, y: 12, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.98 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <div className="adm-modal__header">
                                <h3 className="chat-room-confirm-modal__title adm-modal__title">
                                    <KeyRound size={18} />
                                    ساخت لینک تغییر رمز
                                </h3>
                                <button
                                    type="button"
                                    className="adm-copy-btn adm-tap"
                                    onClick={() => setPasswordModalOpen(false)}
                                    aria-label="بستن"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <p className="chat-room-confirm-modal__text adm-modal__text">
                                لینک یک‌بار مصرف تغییر رمز برای @{detail.username} ساخته می‌شود و تا {selectedLabel} معتبر است.
                            </p>

                            <div className="adm-duration">
                                <span className="adm-duration__label">
                                    <Clock size={14} />
                                    مدت اعتبار
                                </span>
                                <div className="adm-chips adm-chips--wrap">
                                    {expiryOptions.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={cx('adm-chip', 'adm-tap', expiresInMinutes === option.value && 'adm-chip--active')}
                                            onClick={() => setExpiresInMinutes(option.value)}
                                            aria-pressed={expiresInMinutes === option.value}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {passwordLink && (
                                <div className="adm-modal__link">
                                    <AdminLinkBox key={passwordLink.expiresAt} path={passwordLink.path} expiresAt={passwordLink.expiresAt} />
                                </div>
                            )}

                            <div className="chat-room-confirm-modal__actions adm-modal__actions">
                                <button
                                    type="button"
                                    className="adm-btn adm-tap"
                                    onClick={() => setPasswordModalOpen(false)}
                                >
                                    بستن
                                </button>
                                <button
                                    type="button"
                                    className="adm-btn adm-btn--primary adm-tap"
                                    onClick={createPasswordLink}
                                    disabled={passwordLoading}
                                >
                                    {passwordLoading ? <Loader2 size={16} className="adm-spin" /> : <KeyRound size={16} />}
                                    {passwordLink ? 'ساخت لینک جدید' : 'ساخت لینک'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
