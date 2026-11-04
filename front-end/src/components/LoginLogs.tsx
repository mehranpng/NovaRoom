import { useMemo } from 'react';
import { ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';

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

const jalaliDateFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const tehranTimeFormatter = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const toJalaliTehran = (timestamp: number): { date: string; time: string } => {
  const dt = new Date(timestamp);
  return {
    date: toPersianDigits(jalaliDateFormatter.format(dt)),
    time: toPersianDigits(tehranTimeFormatter.format(dt)),
  };
};

export function LoginLogs({ onBack, events }: { onBack: () => void; events: LoginEvent[] }) {
  const { scrolled, handleScroll } = useScrollFade();

  const formattedEvents = useMemo(() => {
    return events.slice(0, 10).map((event) => {
      const device = toPersianDigits(toTitleCaseDevice(event.deviceName || 'نامشخص'));
      const ip = toPersianDigits(event.ipAddress || '-');
      const { date, time } = toJalaliTehran(event.createdAt);
      return {
        key: `${event.tokenHash}-${event.createdAt}`,
        text: `دستگاه ${device} با آی‌پی ${ip} در تاریخ ${date} و در ساعت ${time} وارد شد${event.isCurrentDevice ? ' (این دستگاه)' : ''}.`,
        unseen: Boolean(event.unseenForCurrent),
      };
    });
  }, [events]);

  return (
    <motion.div className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
      <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
      <div className="profile__header">
        <div className="profile__header-side">
          <button onClick={onBack} className="profile__header-back back-icon-btn" aria-label="بازگشت به دستگاه‌ها">
            <ChevronLeft size={22} />
          </button>
        </div>
        <h1 className="profile__header-title">لاگ ورود</h1>
      </div>
      <div className="profile__content" onScroll={handleScroll} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingInline: 14, paddingTop: 68 }}>
        {formattedEvents.length === 0 ? (
          <div style={{ textAlign: 'center', direction: 'rtl', opacity: 0.8, fontSize: 13, padding: '14px 0' }}>لاگ ورودی وجود ندارد.</div>
        ) : (
          formattedEvents.map((item) => (
            <div
              key={item.key}
              style={{
                borderRadius: 9999,
                background: 'var(--glass-surface-soft)',
                border: '1px solid var(--glass-border)',
                boxShadow: 'var(--shadow-xs)',
                padding: '12px 18px',
                direction: 'rtl',
                textAlign: 'right',
                contain: 'content',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>
                <p
                  className="profile__field-label"
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    margin: 0,
                    position: 'relative',
                    paddingRight: item.unseen ? 14 : 0,
                    fontFamily: 'Vazir, sans-serif',
                    textTransform: 'none',
                    letterSpacing: 'normal',
                    color: 'var(--text-primary)',
                  }}
                >
                  {item.unseen && (
                    <span
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 7,
                        width: 7,
                        height: 7,
                        borderRadius: 99,
                        background: 'var(--accent-primary)',
                      }}
                    />
                  )}
                  {item.text}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
