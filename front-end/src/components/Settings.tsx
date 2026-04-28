import { ArrowLeft, ChevronLeft, Laptop, Palette } from 'lucide-react';
import { Devices } from './Devices';
import { ThemeSettings } from './ThemeSettings';

interface SettingsProps {
  section: 'menu' | 'devices' | 'theme';
  onBack: () => void;
  onOpenSection: (section: 'devices' | 'theme') => void;
  onBackToMenu: () => void;
}

export function Settings({ section, onBack, onOpenSection, onBackToMenu }: SettingsProps) {
  if (section === 'devices') {
    return <Devices onBack={onBackToMenu} />;
  }

  if (section === 'theme') {
    return (
      <div className="profile" style={{ fontFamily: 'Vazir, sans-serif' }}>
        <div className="profile__header" style={{ direction: 'ltr' }}>
          <button onClick={onBackToMenu} className="profile__header-back"><ArrowLeft size={22} /></button>
          <h1 className="profile__header-title">تم</h1>
          <div className="profile__header-spacer" />
        </div>
        <ThemeSettings />
      </div>
    );
  }

  return (
    <div className="profile" style={{ fontFamily: 'Vazir, sans-serif' }}>
      <div className="profile__header" style={{ direction: 'ltr' }}>
        <button onClick={onBack} className="profile__header-back"><ArrowLeft size={22} /></button>
        <h1 className="profile__header-title">تنظیمات</h1>
        <div className="profile__header-spacer" />
      </div>

      <div className="profile__content" style={{ gap: 10, paddingInline: 14 }}>
        <button
          type="button"
          className="popover__item"
          onClick={() => onOpenSection('devices')}
          style={{ border: '1px solid var(--border-primary)', borderRadius: 14, minHeight: 50, justifyContent: 'space-between' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Laptop size={18} /> دستگاه‌ها
          </span>
          <ChevronLeft size={18} />
        </button>

        <button
          type="button"
          className="popover__item"
          onClick={() => onOpenSection('theme')}
          style={{ border: '1px solid var(--border-primary)', borderRadius: 14, minHeight: 50, justifyContent: 'space-between' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Palette size={18} /> تم
          </span>
          <ChevronLeft size={18} />
        </button>
      </div>
    </div>
  );
}
