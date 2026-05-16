import { ArrowLeft } from 'lucide-react';

interface LoginEvent {
  tokenHash: string;
  deviceName?: string;
  ipAddress?: string;
  createdAt: number;
  isCurrentDevice: boolean;
  unseenForCurrent?: boolean;
}

const toPersianDigits = (value: string | number): string => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);


const toTitleCaseDevice = (value: string): string => {
  const text = String(value || '').trim();
  if (!text) return 'نامشخص';
  return text
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
};

const toJalaliTehran = (timestamp: number): string => {
  const dt = new Date(timestamp);
  const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
  const time = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(dt);
  return `${date} • ${time}`;
};

export function LoginLogs({ onBack, events }: { onBack: () => void; events: LoginEvent[] }) {
  return (
    <div className="profile" style={{ fontFamily: 'Vazir, sans-serif', textTransform: 'none', letterSpacing: 'normal' }}>
      <div className="profile__header" style={{ direction: 'ltr' }}>
        <button onClick={onBack} className="profile__header-back"><ArrowLeft size={22} /></button>
        <h1 className="profile__header-title">لاگ ورود</h1>
        <div className="profile__header-spacer" />
      </div>
      <div className="profile__content" style={{ gap: 8, paddingInline: 14, paddingTop: 12 }}>
        {events.length === 0 ? <div style={{ textAlign: 'center', direction: 'rtl', opacity: 0.8, fontSize: 13, padding: '14px 0' }}>لاگ ورودی وجود ندارد.</div> : events.slice(0, 10).map((event) => (
          <div key={`${event.tokenHash}-${event.createdAt}`} className="profile__chat-id-card">
            <div className="profile__chat-id-row" style={{ alignItems: 'center', justifyContent: 'space-between', direction: 'rtl', textAlign: 'right', minHeight: 44, paddingBlock: 6 }}>
              <div style={{ display: 'grid', gap: 3 }}>
                <p className="profile__field-label" style={{ fontSize: 12.5, lineHeight: 1.6, position: 'relative', paddingRight: 16, fontFamily: 'Vazir, sans-serif', textTransform: 'none', letterSpacing: 'normal' }}>
                  دستگاه {toPersianDigits(toTitleCaseDevice(event.deviceName || 'نامشخص'))} با آی‌پی {toPersianDigits(event.ipAddress || '-')} در ساعت و تاریخ {toPersianDigits(toJalaliTehran(event.createdAt))} ورود کرد{event.isCurrentDevice ? ' (این دستگاه)' : ''}.
                  {event.unseenForCurrent && <span style={{ position: 'absolute', right: 0, top: 8, width: 8, height: 8, borderRadius: 99, background: 'var(--accent-primary)' }} />}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
