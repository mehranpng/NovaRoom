import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, UserCheck, Copy, Loader2 } from 'lucide-react';
import { apiFetch } from '../../config/api';
import { notify } from '../../utils/notificationBus';
import { copyText } from '../../utils/clipboard';
import { Avatar } from '../Avatar';
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

export function AdminUserDetail({ chatId, onUpdated }: AdminUserDetailProps) {
    const [detail, setDetail] = useState<AdminUserDetailData | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDemote, setConfirmDemote] = useState(false);
    const [passwordLink, setPasswordLink] = useState<PasswordLink | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setDetail(null);
        setPasswordLink(null);
        setConfirmDemote(false);
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
            setConfirmDemote(false);
            notify({ type: 'success', message: level ? 'کاربر به ادمین ۱ ارتقا یافت' : 'دسترسی ادمین حذف شد' });
        } catch {
            notify({ type: 'error', message: 'تغییر سطح دسترسی ممکن نشد' });
        } finally {
            setActionLoading(false);
        }
    };

    const createPasswordLink = async () => {
        if (!detail || actionLoading) return;
        setActionLoading(true);
        try {
            const data = await apiFetch(`/admin/users/${encodeURIComponent(detail.chatId)}/password-link`, {
                method: 'POST',
            });
            setPasswordLink({ path: data.path, expiresAt: data.expiresAt });
        } catch {
            notify({ type: 'error', message: 'ساخت لینک تغییر رمز ممکن نشد' });
        } finally {
            setActionLoading(false);
        }
    };

    const copyChatId = async () => {
        if (!detail) return;
        try {
            await copyText(detail.chatId);
            notify({ type: 'success', message: 'آیدی کپی شد' });
        } catch {
            notify({ type: 'error', message: 'کپی آیدی ممکن نشد' });
        }
    };

    const targetIsOwner = detail?.adminLevel === 'admin0';

    return (
        <div className="adm-content">
            {loading && !detail && (
                <>
                    <div className="adm-skeleton adm-skeleton--hero" />
                    <div className="adm-skeleton adm-skeleton--info" />
                </>
            )}

            {detail && (
                <>
                    <div className="adm-card adm-hero">
                        <Avatar name={detail.name || detail.username} src={detail.avatar} size="xl" online={detail.online} />
                        <div className="adm-hero__name">
                            <span>{detail.name || detail.username}</span>
                            {detail.verified && <VerifiedBadge size={16} />}
                        </div>
                        <div className="adm-hero__username">@{detail.username}</div>
                        {detail.adminLevel && (
                            <span className="adm-badge">{detail.adminLevel === 'admin0' ? 'ادمین ۰' : 'ادمین ۱'}</span>
                        )}
                    </div>

                    <div className="adm-card">
                        <div className="adm-kv">
                            <div className="adm-kv__row">
                                <span className="adm-kv__label">آیدی چت</span>
                                <span className="adm-kv__value adm-kv__value--ltr">
                                    <span>{detail.chatId}</span>
                                    <button
                                        type="button"
                                        className="adm-icon-btn adm-tap"
                                        onClick={copyChatId}
                                        aria-label="کپی آیدی چت"
                                    >
                                        <Copy size={16} />
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
                            onClick={toggleVerified}
                            disabled={actionLoading}
                        >
                            {actionLoading ? <Loader2 size={18} className="adm-spin" /> : <UserCheck size={18} />}
                            {detail.verified ? 'لغو تایید حساب' : 'تایید حساب'}
                        </button>

                        {!targetIsOwner && (
                            <>
                                {detail.adminLevel === 'admin1' ? (
                                    confirmDemote ? (
                                        <div className="adm-card adm-confirm">
                                            <span>مطمئنی؟</span>
                                            <button
                                                type="button"
                                                className="adm-confirm__btn adm-confirm__btn--danger adm-tap"
                                                onClick={() => setAdminLevel(null)}
                                                disabled={actionLoading}
                                            >
                                                بله
                                            </button>
                                            <button
                                                type="button"
                                                className="adm-confirm__btn adm-tap"
                                                onClick={() => setConfirmDemote(false)}
                                            >
                                                انصراف
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            className="adm-btn adm-btn--block adm-tap"
                                            onClick={() => setConfirmDemote(true)}
                                        >
                                            <ShieldCheck size={18} />
                                            حذف دسترسی ادمین
                                        </button>
                                    )
                                ) : (
                                    <button
                                        type="button"
                                        className="adm-btn adm-btn--block adm-tap"
                                        onClick={() => setAdminLevel('admin1')}
                                        disabled={actionLoading}
                                    >
                                        <ShieldCheck size={18} />
                                        ارتقا به ادمین ۱
                                    </button>
                                )}

                                <button
                                    type="button"
                                    className="adm-btn adm-btn--block adm-tap"
                                    onClick={createPasswordLink}
                                    disabled={actionLoading}
                                >
                                    {actionLoading ? <Loader2 size={18} className="adm-spin" /> : <KeyRound size={18} />}
                                    ساخت لینک تغییر رمز
                                </button>
                            </>
                        )}
                    </div>

                    {passwordLink && (
                        <AdminLinkBox key={passwordLink.expiresAt} path={passwordLink.path} expiresAt={passwordLink.expiresAt} />
                    )}
                </>
            )}
        </div>
    );
}
