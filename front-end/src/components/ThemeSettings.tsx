import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useDarkMode, type AccentIntensity, type ThemeMode, type ThemePalette, type ThemeTone } from '../hooks/useDarkMode';

const modeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'سیستم', icon: Monitor },
  { value: 'light', label: 'روشن', icon: Sun },
  { value: 'dark', label: 'تاریک', icon: Moon },
];

const intensityOptions: Array<{ value: AccentIntensity; label: string }> = [
  { value: 'low', label: 'کم' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'زیاد' },
];

const toneOptions: Array<{ value: ThemeTone; label: string; description: string }> = [
  { value: 'neutral', label: 'خنثی', description: 'فقط رنگ‌های اصلی تغییر می‌کند.' },
  { value: 'custom', label: 'کلی', description: 'کل ظاهر برنامه با پالت رنگی می‌شود.' },
];

export function ThemeSettings() {
  const {
    themeMode,
    setThemeMode,
    themeTone,
    setThemeTone,
    themePalette,
    setThemePalette,
    paletteOptions,
    accentIntensity,
    setAccentIntensity,
  } = useDarkMode();

  return (
    <div className="profile__content" style={{ gap: 12, paddingInline: 14, paddingTop: 12 }}>
      <div className="profile__chat-id-card" style={{ direction: 'rtl', textAlign: 'right' }}>
        <p className="profile__field-label" style={{ marginBottom: 10 }}>حالت نمایش</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {modeOptions.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              className="popover__item"
              onClick={() => setThemeMode(value)}
              style={{ borderRadius: 12, justifyContent: 'space-between', border: '1px solid var(--border-primary)' }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon size={16} /> {label}
              </span>
              {themeMode === value ? <Check size={16} /> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="profile__chat-id-card" style={{ direction: 'rtl', textAlign: 'right' }}>
        <p className="profile__field-label" style={{ marginBottom: 10 }}>رنگ‌بندی تم</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {toneOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="popover__item"
              onClick={() => setThemeTone(option.value)}
              style={{ borderRadius: 12, border: '1px solid var(--border-primary)', alignItems: 'start', flexDirection: 'column', gap: 4, direction: 'rtl', textAlign: 'right' }}
            >
              <span style={{ display: 'inline-flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{option.label}</span>
                {themeTone === option.value ? <Check size={16} style={{ alignSelf: 'center' }} /> : null}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{option.description}</span>
            </button>
          ))}
        </div>
      </div>



      <div className="profile__chat-id-card" style={{ direction: 'rtl', textAlign: 'right' }}>
        <p className="profile__field-label" style={{ marginBottom: 10 }}>شدت رنگ‌های اصلی</p>
        <div style={{ display: 'grid', gap: 8 }}>
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            className="theme-intensity-slider"
            dir="rtl"
            value={intensityOptions.findIndex((o) => o.value === accentIntensity)}
            onChange={(e) => setAccentIntensity(intensityOptions[Number(e.currentTarget.value)]?.value ?? 'high')}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              background: `linear-gradient(270deg, var(--accent-primary) 0%, var(--accent-primary) ${(intensityOptions.findIndex((o) => o.value === accentIntensity) / 2) * 100}%, var(--border-secondary) ${(intensityOptions.findIndex((o) => o.value === accentIntensity) / 2) * 100}%, var(--border-secondary) 100%)`,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: 12 }}>
            {intensityOptions.map((option) => (
              <span key={option.value} style={{ color: accentIntensity === option.value ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: accentIntensity === option.value ? 700 : 500 }}>{option.label}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="profile__chat-id-card" style={{ direction: 'rtl', textAlign: 'right' }}>
        <p className="profile__field-label" style={{ marginBottom: 10 }}>رنگ‌های آماده</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {(Object.entries(paletteOptions) as Array<[ThemePalette, { label: string; color: string }]>).map(([palette, meta]) => (
            <button
              key={palette}
              type="button"
              onClick={() => setThemePalette(palette)}
              style={{
                fontFamily: 'Vazir, sans-serif',
                border: `1px solid ${themePalette === palette ? 'var(--accent-primary)' : 'var(--border-primary)'}`,
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                borderRadius: 14,
                minHeight: 48,
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: 'Vazir, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: 999, background: meta.color, border: '1px solid rgba(255,255,255,0.3)' }} />
                {meta.label}
              </span>
              {themePalette === palette ? <Check size={15} /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
