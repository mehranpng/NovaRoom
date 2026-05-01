import { ArrowLeft, ChevronLeft, Laptop, Palette } from 'lucide-react';
import { motion } from 'framer-motion';
import { Devices } from './Devices';
import { ThemeSettings } from './ThemeSettings';
import { LoginLogs } from './LoginLogs';

interface SettingsProps {
  section: 'menu' | 'devices' | 'theme' | 'logs';
  onBack: () => void;
  onOpenSection: (section: 'devices' | 'theme' | 'logs') => void;
  onBackToMenu: () => void;
  loginEvents: any[];
  hasUnseenLoginLogs?: boolean;
}

export function Settings({ section, onBack, onOpenSection, onBackToMenu, loginEvents, hasUnseenLoginLogs }: SettingsProps) {
  if (section === 'devices') {
    return <Devices onBack={onBackToMenu} onOpenLogs={() => onOpenSection('logs')} hasUnseenLoginLogs={hasUnseenLoginLogs} />;
  }
  if (section === 'logs') {
    return <LoginLogs onBack={() => onOpenSection('devices')} events={loginEvents} />;
  }

  if (section === 'theme') {
    return (
      <motion.div className="profile" style={{ fontFamily: 'Vazir, sans-serif' }} initial={{ opacity: 0, y: 8, scale: 0.995 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
        <div className="profile__header" style={{ direction: 'ltr' }}>
          <button onClick={onBackToMenu} className="profile__header-back"><ArrowLeft size={22} /></button>
          <h1 className="profile__header-title">تم</h1>
          <div className="profile__header-spacer" />
        </div>
        <ThemeSettings />
      </motion.div>
    );
  }

  return (
    <div className="profile" style={{ fontFamily: 'Vazir, sans-serif' }}>
      <div className="profile__header" style={{ direction: 'ltr' }}>
        <button onClick={onBack} className="profile__header-back"><ArrowLeft size={22} /></button>
        <h1 className="profile__header-title">تنظیمات</h1>
        <div className="profile__header-spacer" />
      </div>

      <div className="profile__content" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 12, paddingInline: 14, paddingTop: 12, flex: '0 0 auto' }}>
        <button
          type="button"
          className="popover__item"
          onClick={() => onOpenSection('devices')}
          style={{ border: '1px solid var(--border-primary)', borderRadius: 14, height: 60, justifyContent: 'space-between', direction: 'rtl', padding: '6px 15px', position: 'relative' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'right' }}>
            <Laptop size={18} /> دستگاه‌ها
          </span>
          {hasUnseenLoginLogs && <span style={{ position: 'absolute', top: 12, left: 12, width: 8, height: 8, borderRadius: 99, background: 'var(--accent-primary)' }} />}
          <ChevronLeft size={18} style={{ marginInlineStart: 8 }} />
        </button>

        <button
          type="button"
          className="popover__item"
          onClick={() => onOpenSection('theme')}
          style={{ border: '1px solid var(--border-primary)', borderRadius: 14, height: 60, justifyContent: 'space-between', direction: 'rtl', padding: '6px 15px' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textAlign: 'right' }}>
            <Palette size={18} /> تم
          </span>
          <ChevronLeft size={18} style={{ marginInlineStart: 8 }} />
        </button>
      </div>
    </div>
  );
}
