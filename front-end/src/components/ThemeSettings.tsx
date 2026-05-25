import { useEffect } from 'react';
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
        isDarkMode,
        ultraDarkMode,
        setUltraDarkMode,
    } = useDarkMode();
    const ultraDarkAvailable = isDarkMode;
    const shouldDisableCustomTone = isDarkMode && ultraDarkMode;

    useEffect(() => {
        if (shouldDisableCustomTone && themeTone === 'custom') {
            setThemeTone('neutral');
        }
    }, [shouldDisableCustomTone, themeTone, setThemeTone]);

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
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', direction: 'rtl' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>حالت فوق تاریک</span>
                    <button
                        type="button"
                        onClick={() => {
                            if (!ultraDarkAvailable) return;
                            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                                navigator.vibrate(10);
                            }
                            setUltraDarkMode((prev) => !prev);
                        }}
                        aria-label="toggle ultra dark mode"
                        disabled={!ultraDarkAvailable}
                        style={{
                            width: 48,
                            height: 28,
                            borderRadius: 999,
                            opacity: ultraDarkAvailable ? 1 : 0.45,
                            cursor: ultraDarkAvailable ? 'pointer' : 'not-allowed',
                            border: isDarkMode
                                ? (ultraDarkMode ? '1px solid color-mix(in srgb, var(--accent-primary) 70%, var(--border-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 35%, var(--border-primary))')
                                : (ultraDarkMode ? '1px solid color-mix(in srgb, var(--text-primary) 28%, var(--accent-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 24%, var(--border-primary))'),
                            background: ultraDarkMode ? 'var(--accent-primary)' : (isDarkMode ? 'var(--bg-tertiary)' : 'color-mix(in srgb, var(--text-primary) 30%, var(--bg-primary))'),
                            position: 'relative',
                            transition: 'all .2s ease',
                        }}
                    >
                        <span style={{ position: 'absolute', top: 2, right: ultraDarkMode ? 2 : 22, width: 22, height: 22, borderRadius: '50%', background: isDarkMode ? '#fff' : (ultraDarkMode ? '#fff' : '#d3d3d3'), transition: 'all .2s ease' }} />
                    </button>
                </div>
            </div>

            <div className="profile__chat-id-card" style={{ direction: 'rtl', textAlign: 'right' }}>
                <p className="profile__field-label" style={{ marginBottom: 10 }}>رنگ‌بندی تم</p>
                <div style={{ display: 'grid', gap: 8 }}>
                    {toneOptions.map((option) => (
                        (() => {
                            const isDisabled = option.value === 'custom' && shouldDisableCustomTone;
                            return (
                        <button
                            key={option.value}
                            type="button"
                            className="popover__item"
                            onClick={() => {
                                if (isDisabled) return;
                                setThemeTone(option.value);
                            }}
                            disabled={isDisabled}
                            style={{
                                borderRadius: 12,
                                border: '1px solid var(--border-primary)',
                                alignItems: 'start',
                                flexDirection: 'column',
                                gap: 4,
                                direction: 'rtl',
                                textAlign: 'right',
                                opacity: isDisabled ? 0.45 : 1,
                                cursor: isDisabled ? 'not-allowed' : 'pointer',
                                filter: isDisabled ? 'grayscale(0.2)' : 'none',
                            }}
                        >
                            <span style={{ display: 'inline-flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>{option.label}</span>
                                {themeTone === option.value ? <Check size={16} style={{ alignSelf: 'center' }} /> : null}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{option.description}</span>
                        </button>
                            );
                        })()
                    ))}
                </div>
            </div>



            <div className="profile__chat-id-card" style={{ direction: 'rtl', textAlign: 'right' }}>
                <p className="profile__field-label" style={{ marginBottom: 10 }}>شدت رنگ ها</p>
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
                <p className="profile__field-label" style={{ marginBottom: 10 }}>پالت‌های رنگی</p>
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
