import { ArrowLeft, Laptop, Shield, ShieldOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../config/api';

interface DeviceSession {
    tokenHash: string;
    deviceName?: string;
    current: boolean;
    lastUsedAt: number;
    createdAt: number;
}

interface DevicesProps {
    onBack: () => void;
}

type ConfirmAction = null | { kind: 'one'; session: DeviceSession } | { kind: 'others' };

const toPersianDigits = (value: string | number): string => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
const toJalaliTehran = (timestamp: number): string => {
    const dt = new Date(timestamp);
    const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
    const time = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(dt);
    return `${date} • ${time}`;
};

export function Devices({ onBack }: DevicesProps) {
    const [sessions, setSessions] = useState<DeviceSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyHash, setBusyHash] = useState<string | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
    const confirmOverlayRef = useRef<HTMLDivElement | null>(null);

    const loadSessions = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/auth/sessions');
            const list = Array.isArray(res?.sessions) ? res.sessions : [];
            setSessions(list);
        } catch {
            setSessions([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadSessions();
    }, []);

    useEffect(() => {
        if (!confirmAction) return;

        const onDocMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            const modal = confirmOverlayRef.current?.querySelector('.chat-room-confirm-modal');
            if (modal && !modal.contains(target)) setConfirmAction(null);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setConfirmAction(null);
        };
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [confirmAction]);

    const hasOtherSessions = useMemo(() => sessions.some((s) => !s.current), [sessions]);

    const runConfirmAction = async () => {
        if (!confirmAction) return;

        if (confirmAction.kind === 'others') {
            if (!hasOtherSessions || busyHash || bulkBusy) return;
            setBulkBusy(true);
            try {
                await apiFetch('/auth/sessions/revoke-others', { method: 'POST' });
                setSessions((prev) => prev.filter((s) => s.current));
                setConfirmAction(null);
            } catch {
                alert('قطع دسترسی سایر دستگاه‌ها انجام نشد');
            } finally {
                setBulkBusy(false);
            }
            return;
        }

        const session = confirmAction.session;
        if (session.current || busyHash || bulkBusy) return;
        setBusyHash(session.tokenHash);
        try {
            await apiFetch(`/auth/sessions/${encodeURIComponent(session.tokenHash)}`, { method: 'DELETE' });
            setSessions((prev) => prev.filter((s) => s.tokenHash !== session.tokenHash));
            setConfirmAction(null);
        } catch {
            alert('قطع دسترسی انجام نشد');
        } finally {
            setBusyHash(null);
        }
    };

    const confirmMeta = useMemo(() => {
        if (!confirmAction) return null;
        if (confirmAction.kind === 'others') {
            return {
                title: 'قطع دسترسی دیگر دستگاه‌ها؟',
                text: 'همه نشست‌های دیگر قطع می‌شوند و فقط نشست فعلی باقی می‌ماند.',
                confirmLabel: 'قطع دسترسی',
            };
        }
        return {
            title: 'قطع دسترسی این دستگاه؟',
            text: 'با تایید، نشست این دستگاه از حساب شما خارج می‌شود.',
            confirmLabel: 'قطع دسترسی',
        };
    }, [confirmAction]);

    return (
        <div className="profile" style={{ fontFamily: 'Vazir, sans-serif' }}>
            <div className="profile__header" style={{ direction: 'ltr' }}>
                <button onClick={onBack} className="profile__header-back"><ArrowLeft size={22} /></button>
                <h1 className="profile__header-title">دستگاه‌ها</h1>
                <div className="profile__header-spacer" />
            </div>

            <div className="profile__content" style={{ gap: 12, paddingInline: 14 }}>
                <button
                    className="profile__save-btn"
                    style={{ width: '100%', justifyContent: 'center' }}
                    disabled={!hasOtherSessions || bulkBusy}
                    onClick={() => setConfirmAction({ kind: 'others' })}
                >
                    <ShieldOff size={14} /> قطع دسترسی دیگر دستگاه ها
                </button>

                {loading ? (
                    <div className="profile__chat-id-card">در حال دریافت دستگاه‌ها...</div>
                ) : sessions.length === 0 ? (
                    <div className="profile__chat-id-card">نشست فعالی پیدا نشد.</div>
                ) : sessions.map((session) => (
                    <div
                        key={session.tokenHash}
                        className="profile__chat-id-card"
                        style={{
                            border: session.current ? '1px solid var(--accent-primary)' : undefined,
                            background: session.current ? 'color-mix(in srgb, var(--accent-primary) 10%, var(--bg-secondary))' : undefined,
                        }}
                    >
                        <div className="profile__chat-id-row" style={{ alignItems: 'flex-start', justifyContent: 'space-between', direction: 'rtl', textAlign: 'right' }}>
                            <div style={{ display: 'grid', gap: 6 }}>
                                <p className="profile__chat-id-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Laptop size={16} /> {session.deviceName || 'نامشخص'}
                                    {session.current ? <span style={{ fontSize: 12, opacity: 0.85, fontFamily: 'Vazir, sans-serif' }}>(دستگاه فعلی)</span> : null}
                                </p>
                                <p className="profile__field-label">آخرین استفاده: {toPersianDigits(toJalaliTehran(session.lastUsedAt))}</p>
                                <p className="profile__field-label">ایجاد نشست: {toPersianDigits(toJalaliTehran(session.createdAt))}</p>
                            </div>
                            {session.current ? (
                                <span className="profile__copy-btn" style={{ cursor: 'default', opacity: 0.9 }}><Shield size={16} /></span>
                            ) : (
                                <button
                                    className="profile__avatar-btn profile__avatar-btn--danger"
                                    style={{ marginRight: 'auto' }}
                                    disabled={busyHash === session.tokenHash || bulkBusy}
                                    onClick={() => setConfirmAction({ kind: 'one', session })}
                                >
                                    <ShieldOff size={14} /> قطع دسترسی
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {confirmAction && confirmMeta && (
                <div
                    ref={confirmOverlayRef}
                    className="chat-room-confirm-overlay"
                    style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                >
                    <div className="chat-room-confirm-modal" style={{ width: 'min(420px, calc(100vw - 24px))' }}>
                        <h3 className="chat-room-confirm-modal__title">{confirmMeta.title}</h3>
                        <p className="chat-room-confirm-modal__text">{confirmMeta.text}</p>
                        <div className="chat-room-confirm-modal__actions">
                            <button className="chat-room-confirm-modal__btn" onClick={() => setConfirmAction(null)} disabled={bulkBusy || Boolean(busyHash)}>لغو</button>
                            <button className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger" onClick={runConfirmAction} disabled={bulkBusy || Boolean(busyHash)}>
                                {confirmMeta.confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
