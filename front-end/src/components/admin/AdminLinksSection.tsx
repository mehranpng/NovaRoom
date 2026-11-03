import { useCallback, useEffect, useState } from 'react';
import { Check, Clock, Copy, Link2, Loader2, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../config/api';
import { useScrollFade } from '../../hooks/useScrollFade';
import { cx } from '../../utils/cx';
import { notify } from '../../utils/notificationBus';
import { copyText } from '../../utils/clipboard';
import type { RegisterLink } from './adminTypes';
import './admin.css';

const expiryOptions = [
    { value: 30, label: '۳۰ دقیقه' },
    { value: 60, label: '۱ ساعت' },
    { value: 180, label: '۳ ساعت' },
    { value: 360, label: '۶ ساعت' },
    { value: 720, label: '۱۲ ساعت' },
    { value: 1440, label: '۲۴ ساعت' },
];

const parseUtcMillis = (iso: string) => {
    const raw = String(iso || '').trim();
    if (!raw) return NaN;
    const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`;
    return Date.parse(normalized);
};

const remainingSeconds = (expiresAt: string, now: number) => {
    const target = parseUtcMillis(expiresAt);
    if (!Number.isFinite(target)) return 0;
    return Math.max(0, Math.floor((target - now) / 1000));
};

const formatRemaining = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const rest = String(seconds % 60).padStart(2, '0');
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${minutes}:${rest}`;
    }
    return `${minutes}:${rest}`;
};

export function AdminLinksSection() {
    const { scrolled, handleScroll } = useScrollFade();
    const [links, setLinks] = useState<RegisterLink[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [expiresInMinutes, setExpiresInMinutes] = useState(30);
    const [now, setNow] = useState(() => Date.now());
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        apiFetch('/admin/register-links')
            .then((data) => {
                setNow(Date.now());
                setLinks(Array.isArray(data?.items) ? data.items : []);
            })
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
            const data = await apiFetch('/admin/register-links', {
                method: 'POST',
                body: JSON.stringify({ expiresInMinutes }),
            });
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

    const selectedLabel = expiryOptions.find((opt) => opt.value === expiresInMinutes)?.label || '۳۰ دقیقه';

    return (
        <>
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />

            <div className="adm-content" onScroll={handleScroll}>
                <div className="adm-card">
                    <div className="adm-card__title">
                        <Link2 size={18} />
                        لینک ثبت‌ نام
                    </div>
                    <p className="adm-card__text">هر لینک فقط برای یک نفر و تا {selectedLabel} معتبر است.</p>

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

                <div className="adm-count">لینک‌ های فعال شما</div>

                {loading && (
                    <>
                        {[1, 2].map((index) => (
                            <div key={index} className="adm-card adm-link-item">
                                <div className="adm-link-item__top">
                                    <div className="skeleton adm-skeleton-line adm-skeleton-line--url" />
                                    <div className="skeleton adm-skeleton-line adm-skeleton-line--timer" />
                                </div>
                                <div className="adm-link-item__bottom">
                                    <div className="skeleton adm-skeleton-line adm-skeleton-line--meta" />
                                    <div className="adm-link-item__actions">
                                        <div className="skeleton adm-skeleton-circle" />
                                        <div className="skeleton adm-skeleton-circle" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </>
                )}

                {!loading && links.length === 0 && (
                    <div className="adm-empty">
                        <Link2 size={28} />
                        <span>لینک فعالی وجود ندارد</span>
                    </div>
                )}

                {!loading && links.map((link) => {
                    const remaining = remainingSeconds(link.expiresAt, now);
                    return (
                        <div key={link.id} className="adm-card adm-link-item">
                            <div className="adm-link-item__top">
                                <span className="adm-link-item__url" dir="ltr">
                                    {`${window.location.origin}${link.path}`}
                                </span>
                                <span className="adm-link-item__timer">{formatRemaining(remaining)}</span>
                            </div>
                            <div className="adm-link-item__bottom">
                                <span className="adm-link-item__meta">لینک ثبت‌ نام</span>
                                <span className="adm-link-item__actions">
                                    <button
                                        type="button"
                                        className="adm-icon-btn adm-tap"
                                        onClick={() => handleCopy(link)}
                                        aria-label="کپی لینک"
                                    >
                                        {copiedId === link.id ? <Check size={15} /> : <Copy size={15} />}
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
                                                {deletingId === link.id ? <Loader2 size={15} className="adm-spin" /> : <Check size={15} />}
                                            </button>
                                            <button
                                                type="button"
                                                className="adm-icon-btn adm-tap"
                                                onClick={() => setConfirmId(null)}
                                                aria-label="انصراف از حذف"
                                            >
                                                <X size={15} />
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            className="adm-icon-btn adm-icon-btn--danger adm-tap"
                                            onClick={() => setConfirmId(link.id)}
                                            aria-label="حذف لینک"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    )}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
