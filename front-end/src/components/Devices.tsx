import { ArrowLeft, Laptop, ShieldOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../config/api';
import { AnimatePresence, motion } from 'framer-motion';

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
    const currentSession = useMemo(() => sessions.find((s) => s.current) || null, [sessions]);
    const otherSessions = useMemo(() => sessions.filter((s) => !s.current), [sessions]);

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

            <div className="profile__content" style={{ gap: 8, paddingInline: 14 }}>
                {loading ? (
                    <div style={{ textAlign: 'center', direction: 'rtl', opacity: 0.8, fontSize: 13, padding: '14px 0' }}>
                        در حال بارگیری نشست‌ها...
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="profile__chat-id-card">نشست فعالی پیدا نشد.</div>
                ) : (
                    <>
                        {currentSession && (
                            <div
                                key={currentSession.tokenHash}
                                className="profile__chat-id-card"
                                style={{
                                    border: '1px solid color-mix(in srgb, var(--accent-primary) 24%, var(--border-primary))',
                                    background: 'color-mix(in srgb, var(--accent-primary) 6%, var(--bg-secondary))',
                                }}
                            >
                                <div className="profile__chat-id-row" style={{ alignItems: 'center', justifyContent: 'space-between', direction: 'rtl', textAlign: 'right', minHeight: 62 }}>
                                    <div style={{ display: 'grid', gap: 3 }}>
                                        <p className="profile__chat-id-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <Laptop size={16} /> {currentSession.deviceName || 'نامشخص'}
                                            <span style={{ fontSize: 12, opacity: 0.85, fontFamily: 'Vazir, sans-serif' }}>(دستگاه فعلی)</span>
                                        </p>
                                        <p className="profile__field-label">آخرین استفاده: {toPersianDigits(toJalaliTehran(currentSession.lastUsedAt))}</p>
                                        <p className="profile__field-label">ایجاد نشست: {toPersianDigits(toJalaliTehran(currentSession.createdAt))}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button
                            className="profile__save-btn"
                            style={{
                                width: '100%',
                                justifyContent: 'center',
                                minHeight: 48,
                                marginTop: 4,
                                marginBottom: 10,
                                background: 'color-mix(in srgb, #dc2626 82%, var(--bg-tertiary))',
                            }}
                            disabled={!hasOtherSessions || bulkBusy}
                            onClick={() => setConfirmAction({ kind: 'others' })}
                        >
                            <ShieldOff size={15} /> قطع دسترسی دیگر دستگاه ها
                        </button>

                        {otherSessions.map((session) => (
                            <div
                                key={session.tokenHash}
                                className="profile__chat-id-card"
                            >
                                <div className="profile__chat-id-row" style={{ alignItems: 'center', justifyContent: 'space-between', direction: 'rtl', textAlign: 'right', minHeight: 62 }}>
                                    <div style={{ display: 'grid', gap: 3 }}>
                                        <p className="profile__chat-id-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <Laptop size={16} /> {session.deviceName || 'نامشخص'}
                                        </p>
                                        <p className="profile__field-label">آخرین استفاده: {toPersianDigits(toJalaliTehran(session.lastUsedAt))}</p>
                                        <p className="profile__field-label">ایجاد نشست: {toPersianDigits(toJalaliTehran(session.createdAt))}</p>
                                    </div>
                                    <button
                                        className="profile__avatar-btn profile__avatar-btn--danger"
                                        style={{ marginRight: 'auto', alignSelf: 'center' }}
                                        disabled={busyHash === session.tokenHash || bulkBusy}
                                        onClick={() => setConfirmAction({ kind: 'one', session })}
                                    >
                                        <ShieldOff size={14} /> قطع دسترسی
                                    </button>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>

            <AnimatePresence>
                {confirmAction && confirmMeta && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        ref={confirmOverlayRef}
                        style={{ zIndex: 120, background: 'rgba(0,0,0,.46)' }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                    >
                        <motion.div
                            className="chat-room-confirm-modal"
                            style={{ width: 'min(480px, calc(100vw - 24px))' }}
                            onMouseDown={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, y: 14, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h3 className="chat-room-confirm-modal__title">{confirmMeta.title}</h3>
                            <p className="chat-room-confirm-modal__text">{confirmMeta.text}</p>
                            <div className="chat-room-confirm-modal__actions">
                                <button className="chat-room-confirm-modal__btn" onClick={() => setConfirmAction(null)} disabled={bulkBusy || Boolean(busyHash)} type="button">لغو</button>
                                <button className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger" onClick={runConfirmAction} disabled={bulkBusy || Boolean(busyHash)} type="button">
                                    {confirmMeta.confirmLabel}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
