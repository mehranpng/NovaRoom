import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import TelegramIcon from './TelegramIcon';
import { getSessionDeviceMeta } from '../utils/sessionDevice';
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
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  const formattedEvents = useMemo(() => {
    return events.slice(0, 10).map((event) => {
      const device = toPersianDigits(toTitleCaseDevice(event.deviceName || 'نامشخص'));
      const ip = toPersianDigits(event.ipAddress || '-');
      const { date, time } = toJalaliTehran(event.createdAt);
      const meta = getSessionDeviceMeta(event.deviceName || '');
      return {
        key: `${event.tokenHash}-${event.createdAt}`,
        device: `${device}${event.isCurrentDevice ? ' (این دستگاه)' : ''}`,
        subtitle: `آی‌پی ${ip} • ${date} ساعت ${time}`,
        unseen: Boolean(event.unseenForCurrent),
        meta,
      };
    });
  }, [events]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const updateScrollable = () => {
      setIsScrollable(el.scrollHeight > el.clientHeight + 1);
    };
    updateScrollable();
    const ro = new ResizeObserver(updateScrollable);
    ro.observe(el);
    window.addEventListener('resize', updateScrollable);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateScrollable);
    };
  }, [formattedEvents]);

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
      <div
        ref={contentRef}
        className="profile__content tg-settings-scroll"
        onScroll={handleScroll}
        style={{
          overflowY: isScrollable ? 'auto' : 'hidden',
          paddingBottom: isScrollable ? 104 : 24,
        }}
      >
        {formattedEvents.length === 0 ? (
          <div style={{ textAlign: 'center', direction: 'rtl', opacity: 0.8, fontSize: 13, padding: '14px 0' }}>لاگ ورودی وجود ندارد.</div>
        ) : (
          <>
            <div className="tg-island-title">گزارش ورودهای اخیر</div>
            <div className="tg-island">
              {formattedEvents.map((item, idx) => (
                <div key={item.key}>
                  {idx > 0 && <div className="tg-island__divider" aria-hidden="true" />}
                  <div className="tg-row">
                    <span className={cx('tg-icon-backdrop', `tg-icon-backdrop--${item.meta.color}`)} aria-hidden="true">
                      <TelegramIcon name={item.meta.icon} size={20} />
                    </span>
                    <div className="tg-list-item__copy">
                      <span className="tg-list-item__title">{item.device}</span>
                      <span className="tg-list-item__subtitle">{item.subtitle}</span>
                    </div>
                    {item.unseen && <span className="tg-list-item__dot" aria-hidden="true" />}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
