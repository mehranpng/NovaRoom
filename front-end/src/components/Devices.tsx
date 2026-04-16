import { ArrowLeft, Laptop, Shield, ShieldOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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

    const hasOtherSessions = useMemo(() => sessions.some((s) => !s.current), [sessions]);

    const revokeOne = async (session: DeviceSession) => {
        if (session.current || busyHash || bulkBusy) return;
        const confirmed = window.confirm('آیا از قطع دسترسی این دستگاه مطمئن هستید؟');
        if (!confirmed) return;
        setBusyHash(session.tokenHash);
        try {
            await apiFetch(`/auth/sessions/${encodeURIComponent(session.tokenHash)}`, { method: 'DELETE' });
            setSessions((prev) => prev.filter((s) => s.tokenHash !== session.tokenHash));
        } catch {
            alert('قطع دسترسی انجام نشد');
        } finally {
            setBusyHash(null);
        }
    };

    const revokeOthers = async () => {
        if (!hasOtherSessions || busyHash || bulkBusy) return;
        const confirmed = window.confirm('آیا از قطع دسترسی همه دستگاه‌های دیگر مطمئن هستید؟');
        if (!confirmed) return;
        setBulkBusy(true);
        try {
            await apiFetch('/auth/sessions/revoke-others', { method: 'POST' });
            setSessions((prev) => prev.filter((s) => s.current));
        } catch {
            alert('قطع دسترسی سایر دستگاه‌ها انجام نشد');
        } finally {
            setBulkBusy(false);
        }
    };

    return (
        <div className="profile" dir="rtl" style={{ fontFamily: 'Vazir, sans-serif' }}>
            <div className="profile__header">
                <button onClick={onBack} className="profile__header-back"><ArrowLeft size={22} /></button>
                <h1 className="profile__header-title">دستگاه‌ها</h1>
                <div className="profile__header-spacer" />
            </div>

            <div className="profile__content" style={{ gap: 12, paddingInline: 14 }}>
                <div className="profile__chat-id-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, direction: 'rtl' }}>
                    <div>
                        <p className="profile__field-label">مدیریت نشست‌های فعال</p>
                    </div>
                    <button className="profile__save-btn" style={{ marginLeft: 'auto' }} disabled={!hasOtherSessions || bulkBusy} onClick={revokeOthers}>
                        <ShieldOff size={14} /> قطع دسترسی سایرین
                    </button>
                </div>

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
                        <div className="profile__chat-id-row" style={{ alignItems: 'flex-start', direction: 'rtl', textAlign: 'right' }}>
                            <div style={{ display: 'grid', gap: 6 }}>
                                <p className="profile__chat-id-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Laptop size={16} /> {session.deviceName || 'نامشخص'}
                                    {session.current ? <span style={{ fontSize: 12, opacity: 0.85 }}>(دستگاه فعلی)</span> : null}
                                </p>
                                <p className="profile__field-label">آخرین استفاده: {toPersianDigits(toJalaliTehran(session.lastUsedAt))}</p>
                                <p className="profile__field-label">ایجاد نشست: {toPersianDigits(toJalaliTehran(session.createdAt))}</p>
                            </div>
                            {session.current ? (
                                <span className="profile__copy-btn" style={{ cursor: 'default', opacity: 0.9 }}><Shield size={16} /></span>
                            ) : (
                                <button className="profile__avatar-btn profile__avatar-btn--danger" style={{ marginLeft: 'auto' }} disabled={busyHash === session.tokenHash || bulkBusy} onClick={() => revokeOne(session)}>
                                    <ShieldOff size={14} /> قطع دسترسی
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
