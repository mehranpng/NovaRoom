import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Link2, Loader2, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../config/api';
import { useScrollFade } from '../../hooks/useScrollFade';
import { cx } from '../../utils/cx';
import { notify } from '../../utils/notificationBus';
import { copyText } from '../../utils/clipboard';
import type { RegisterLink } from './adminTypes';
import './admin.css';

const remainingSeconds = (expiresAt: string, now: number) => {
    const target = Date.parse(expiresAt);
    if (!Number.isFinite(target)) return 0;
    return Math.max(0, Math.floor((target - now) / 1000));
};

const formatRemaining = (seconds: number) => {
    const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    const rest = String(seconds % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
};

export function AdminLinksSection() {
    const { scrolled, handleScroll } = useScrollFade();
    const [links, setLinks] = useState<RegisterLink[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        apiFetch('/admin/me')
            .then((data) => setIsOwner(data?.adminLevel === 'admin0'))
            .catch(() => { });
        apiFetch('/admin/register-links')
            .then((data) => setLinks(Array.isArray(data?.items) ? data.items : []))
            .catch(() => notify({ type: 'error', message: 'دریافت لینک‌ های فعال ممکن نشد' }))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (links.length === 0) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [links.length]);

    useEffect(() => {
        if (links.length === 0) return;
        const alive = links.filter((link) => remainingSeconds(link.expiresAt, now) > 0);
        if (alive.length !== links.length) setLinks(alive);
    }, [links, now]);

    const createLink = async () => {
        if (creating) return;
        setCreating(true);
        try {
            const data = await apiFetch('/admin/register-links', { method: 'POST' });
            setLinks((prev) => [
                {
                    id: data.id,
                    path: data.path,
                    expiresAt: data.expiresAt,
                    createdAt: new Date().toISOString(),
                    createdBy: '',
                    createdByUsername: data.createdByUsername || '',
                    mine: true,
                },
                ...prev,
            ]);
            setNow(Date.now());
        } catch (error: unknown) {
            const err = error as { status?: number; message?: string };
            if (err?.status === 429) {
                notify({ type: 'error', message: 'تعداد لینک‌ های فعال به حد مجاز رسیده است' });
            } else if (String(err?.message || '').includes('Registration is closed')) {
                notify({ type: 'error', message: 'ثبت‌ نام در حال حاضر بسته است' });
            } else {
                notify({ type: 'error', message: 'ساخت لینک ممکن نشد' });
            }
        } finally {
            setCreating(false);
        }
    };

    const handleCopy = useCallback(async (link: RegisterLink) => {
        try {
            await copyText(`${window.location.origin}${link.path}`);
            setCopiedId(link.id);
            notify({ type: 'success', message: 'کپی شد' });
            window.setTimeout(() => {
                setCopiedId((current) => (current === link.id ? null : current));
            }, 1500);
        } catch {
            notify({ type: 'error', message: 'کپی لینک ممکن نشد' });
        }
    }, []);

    const handleDelete = async (link: RegisterLink) => {
        if (deletingId) return;
        setDeletingId(link.id);
        try {
            await apiFetch(`/admin/register-links/${encodeURIComponent(link.id)}`, { method: 'DELETE' });
            setLinks((prev) => prev.filter((item) => item.id !== link.id));
            setConfirmId(null);
        } catch {
            notify({ type: 'error', message: 'حذف لینک ممکن نشد' });
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <>
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />

            <div className="adm-content" onScroll={handleScroll}>
                <div className="adm-card">
                    <div className="adm-card__title">
                        <Link2 size={18} />
                        لینک ثبت‌ نام
                    </div>
                    <p className="adm-card__text">هر لینک فقط برای یک نفر و ۳۰ دقیقه معتبر است.</p>
                    <button
                        type="button"
                        className="adm-btn adm-btn--primary adm-btn--block adm-tap adm-card__action"
                        onClick={createLink}
                        disabled={creating}
                    >
                        {creating ? <Loader2 size={18} className="adm-spin" /> : <Plus size={18} />}
                        ساخت لینک جدید
                    </button>
                </div>

                <div className="adm-count">لینک‌ های فعال</div>

                {loading && (
                    <>
                        {[1, 2].map((index) => (
                            <div key={index} className="adm-skeleton adm-skeleton--card" />
                        ))}
                    </>
                )}

                {!loading && links.length === 0 && (
                    <div className="adm-empty">
                        <Link2 size={28} />
                        <span>لینک فعالی وجود ندارد</span>
                    </div>
                )}

                <AnimatePresence initial={false}>
                    {links.map((link) => {
                        const remaining = remainingSeconds(link.expiresAt, now);
                        return (
                            <motion.div
                                key={link.id}
                                layout
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                                className="adm-card adm-link-item"
                            >
                                <div className="adm-link-item__top">
                                    <input
                                        className="adm-link-item__url"
                                        readOnly
                                        dir="ltr"
                                        value={`${window.location.origin}${link.path}`}
                                        onFocus={(event) => event.currentTarget.select()}
                                        aria-label="لینک ثبت‌ نام"
                                    />
                                    <span className="adm-link-item__timer">{formatRemaining(remaining)}</span>
                                </div>
                                <div className="adm-link-item__bottom">
                                    <span className="adm-link-item__meta">
                                        {isOwner && link.createdByUsername ? `توسط @${link.createdByUsername}` : ''}
                                    </span>
                                    <span className="adm-link-item__actions">
                                        <button
                                            type="button"
                                            className="adm-icon-btn adm-tap"
                                            onClick={() => handleCopy(link)}
                                            aria-label="کپی لینک"
                                        >
                                            {copiedId === link.id ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                        {confirmId === link.id ? (
                                            <>
                                                <button
                                                    type="button"
                                                    className="adm-icon-btn adm-icon-btn--danger adm-tap"
                                                    onClick={() => handleDelete(link)}
                                                    disabled={deletingId === link.id}
                                                    aria-label="تایید حذف لینک"
                                                >
                                                    {deletingId === link.id ? <Loader2 size={16} className="adm-spin" /> : <Check size={16} />}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="adm-icon-btn adm-tap"
                                                    onClick={() => setConfirmId(null)}
                                                    aria-label="انصراف از حذف"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                className="adm-icon-btn adm-icon-btn--danger adm-tap"
                                                onClick={() => setConfirmId(link.id)}
                                                aria-label="حذف لینک"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </span>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
        </>
    );
}
