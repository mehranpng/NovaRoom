import { useEffect, useState, useRef } from 'react';
import { Check, Download, Loader2, Monitor, Moon, Sun, Trash2, Smile, Palette, Wallpaper } from 'lucide-react';
import { cx } from '../utils/cx';
import { useScrollFade } from '../hooks/useScrollFade';
import { useDarkMode, type AccentIntensity, type ThemeMode, type ThemePalette, type ThemeTone } from '../hooks/useDarkMode';
import { WALLPAPER_OPTIONS, generateWallpaperDataUri, getWallpaperSize, scaleWallpaperOpacity } from '../utils/chatWallpapers';
import { toPersianDigits } from '../utils/format';
import {
    isEmojiFontDownloaded,
    isEmojiFontActive,
    downloadEmojiFont,
    saveAndActivateEmojiFont,
    toggleEmojiFontActive,
    removeEmojiFont,
} from '../utils/emojiFont';

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
    const { scrolled, handleScroll } = useScrollFade();
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
        blurEffect,
        setBlurEffect,
        chatWallpaper,
        setChatWallpaper,
        chatWallpaperIntensity,
        setChatWallpaperIntensity,
    } = useDarkMode();
    const ultraDarkAvailable = isDarkMode;
    const shouldDisableCustomTone = isDarkMode && ultraDarkMode;

    const activeAccentColor = paletteOptions[themePalette]?.color || '#3b82f6';
    const previewPatternUri = generateWallpaperDataUri(
        chatWallpaper,
        activeAccentColor,
        scaleWallpaperOpacity(isDarkMode ? 0.18 : 0.12, chatWallpaperIntensity)
    );

    const [emojiDownloaded, setEmojiDownloaded] = useState<boolean>(false);
    const [emojiActive, setEmojiActive] = useState<boolean>(false);
    const [isDownloadingEmoji, setIsDownloadingEmoji] = useState<boolean>(false);
    const [emojiProgress, setEmojiProgress] = useState<number>(0);
    const [emojiLoadedMB, setEmojiLoadedMB] = useState<string>('0');
    const [emojiError, setEmojiError] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        isEmojiFontDownloaded().then((downloaded) => {
            setEmojiDownloaded(downloaded);
            setEmojiActive(downloaded && isEmojiFontActive());
        });
    }, []);

    const handleDownloadEmoji = async () => {
        setEmojiError(null);
        setIsDownloadingEmoji(true);
        setEmojiProgress(0);
        setEmojiLoadedMB('0');
        const controller = new AbortController();
        abortControllerRef.current = controller;
        try {
            const buffer = await downloadEmojiFont((loaded, total) => {
                const percent = total > 0 ? (loaded / total) * 100 : 0;
                setEmojiProgress(percent);
                setEmojiLoadedMB((loaded / (1024 * 1024)).toFixed(1));
            }, controller.signal);
            await saveAndActivateEmojiFont(buffer);
            setEmojiDownloaded(true);
            setEmojiActive(true);
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate(15);
            }
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                setEmojiError('خطا در دانلود فونت. لطفاً اتصال اینترنت را بررسی کنید.');
            }
        } finally {
            setIsDownloadingEmoji(false);
            abortControllerRef.current = null;
        }
    };

    const handleCancelDownload = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsDownloadingEmoji(false);
        setEmojiProgress(0);
    };

    const handleToggleEmoji = async () => {
        const nextState = !emojiActive;
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(10);
        }
        const success = await toggleEmojiFontActive(nextState);
        if (success) {
            setEmojiActive(nextState);
        }
    };

    const handleDeleteEmoji = async () => {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(15);
        }
        await removeEmojiFont();
        setEmojiDownloaded(false);
        setEmojiActive(false);
    };

    useEffect(() => {
        if (shouldDisableCustomTone && themeTone === 'custom') {
            setThemeTone('neutral');
        }
    }, [shouldDisableCustomTone, themeTone, setThemeTone]);

    return (
        <>
        <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
        <div className="profile__content" onScroll={handleScroll} style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingInline: 14, paddingTop: 68, paddingBottom: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, direction: 'rtl', textAlign: 'right' }}>
                <div className="profile__section-title">
                    <span className="profile__section-icon"><Sun size={15} /></span>
                    حالت و پوسته
                </div>
                <div className="profile__chat-id-card profile__chat-id-card--flat">
                    <p className="profile__field-label" style={{ marginBottom: 10 }}>حالت نمایش</p>
                    <div style={{ display: 'grid', gap: 8 }}>
                        {modeOptions.map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                type="button"
                                className="popover__item"
                                onClick={() => setThemeMode(value)}
                                style={{ borderRadius: 999, justifyContent: 'space-between', border: '1px solid var(--glass-border)' }}
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
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', direction: 'rtl' }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>افکت تاری (Blur)</span>
                        <button
                            type="button"
                            onClick={() => {
                                if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                                    navigator.vibrate(10);
                                }
                                setBlurEffect((prev) => !prev);
                            }}
                            aria-label="toggle blur effect"
                            style={{
                                width: 48,
                                height: 28,
                                borderRadius: 999,
                                cursor: 'pointer',
                                border: isDarkMode
                                    ? (blurEffect ? '1px solid color-mix(in srgb, var(--accent-primary) 70%, var(--border-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 35%, var(--border-primary))')
                                    : (blurEffect ? '1px solid color-mix(in srgb, var(--text-primary) 28%, var(--accent-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 24%, var(--border-primary))'),
                                background: blurEffect ? 'var(--accent-primary)' : (isDarkMode ? 'var(--bg-tertiary)' : 'color-mix(in srgb, var(--text-primary) 30%, var(--bg-primary))'),
                                position: 'relative',
                                transition: 'all .2s ease',
                            }}
                        >
                            <span style={{ position: 'absolute', top: 2, right: blurEffect ? 2 : 22, width: 22, height: 22, borderRadius: '50%', background: isDarkMode ? '#fff' : (blurEffect ? '#fff' : '#d3d3d3'), transition: 'all .2s ease' }} />
                        </button>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, direction: 'rtl', textAlign: 'right' }}>
                <div className="profile__section-title">
                    <span className="profile__section-icon"><Palette size={15} /></span>
                    رنگ‌بندی و پالت
                </div>

                <div className="profile__chat-id-card profile__chat-id-card--flat">
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
                                    borderRadius: 18,
                                    border: '1px solid var(--glass-border)',
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

                <div className="profile__chat-id-card profile__chat-id-card--flat">
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

                <div className="profile__chat-id-card profile__chat-id-card--flat">
                    <p className="profile__field-label" style={{ marginBottom: 10 }}>پالت‌های رنگی</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                        {(Object.entries(paletteOptions) as Array<[ThemePalette, { label: string; color: string }]>).map(([palette, meta]) => (
                            <button
                                key={palette}
                                type="button"
                                onClick={() => setThemePalette(palette)}
                                style={{
                                    fontFamily: 'Vazir, sans-serif',
                                    border: `1px solid ${themePalette === palette ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
                                    background: 'var(--glass-surface-soft)',
                                    color: 'var(--text-primary)',
                                    borderRadius: 999,
                                    minHeight: 46,
                                    padding: '8px 14px',
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, direction: 'rtl', textAlign: 'right' }}>
                <div className="profile__section-title">
                    <span className="profile__section-icon"><Wallpaper size={15} /></span>
                    طرح پس‌زمینه چت
                </div>

                <div className="profile__chat-id-card profile__chat-id-card--flat">
                    <p className="profile__field-label" style={{ marginBottom: 10 }}>پیش‌نمایش</p>

                    <div style={{
                        position: 'relative',
                        minHeight: 124,
                        borderRadius: 18,
                        overflow: 'hidden',
                        border: '1px solid var(--glass-border)',
                        background: 'var(--chat-room-bg, var(--bg-secondary))',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        padding: '12px 14px',
                        gap: 8,
                    }}>
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            pointerEvents: 'none',
                            backgroundImage: previewPatternUri ? `url("${previewPatternUri}")` : 'none',
                            backgroundRepeat: 'repeat',
                            backgroundSize: getWallpaperSize(chatWallpaper),
                        }} />

                        <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div className="message-item">
                                <div className="message-row message-row--mine">
                                    <div className="message-bubble message-bubble--mine msg-shape--single">
                                        <div className="message-text">بهترین ادمین نواروم کیه به نظرت؟</div>
                                        <div className="message-meta message-meta--mine">
                                            <span className="message-time">۱۲:۳۰</span>
                                            <span className="message-seen message-seen--double" aria-label="seen">
                                                <Check size={12} strokeWidth={2.5} className="message-seen__check message-seen__check--first" />
                                                <Check size={12} strokeWidth={2.5} className="message-seen__check message-seen__check--second" />
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="message-item">
                                <div className="message-row message-row--theirs">
                                    <div className="message-bubble message-bubble--theirs msg-shape--single">
                                        <div className="message-text">قطعاً طاها</div>
                                        <div className="message-reactions">
                                            <span className="message-reaction">
                                                <span className="message-reaction__emoji">🤣</span>
                                            </span>
                                        </div>
                                        <div className="message-meta message-meta--theirs">
                                            <span className="message-time">۱۲:۳۱</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <p className="profile__field-label" style={{ marginTop: 16, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                        <span>شدت الگو</span>
                        <span style={{ fontFamily: 'Vazir, sans-serif' }}>{toPersianDigits(chatWallpaperIntensity)}٪</span>
                    </p>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        className="theme-intensity-slider"
                        dir="rtl"
                        value={chatWallpaperIntensity}
                        disabled={chatWallpaper === 'none'}
                        aria-label="شدت الگو"
                        onChange={(e) => setChatWallpaperIntensity(Number(e.currentTarget.value))}
                        style={{
                            width: '100%',
                            border: 'none',
                            outline: 'none',
                            boxShadow: 'none',
                            background: `linear-gradient(270deg, var(--accent-primary) 0%, var(--accent-primary) ${chatWallpaperIntensity}%, var(--border-secondary) ${chatWallpaperIntensity}%, var(--border-secondary) 100%)`,
                        }}
                    />

                    <p className="profile__field-label" style={{ marginTop: 16, marginBottom: 10 }}>انتخاب الگو</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                        {WALLPAPER_OPTIONS.map((option) => {
                            const isSelected = chatWallpaper === option.id;
                            const cardPatternUri = option.id === 'none'
                                ? null
                                : generateWallpaperDataUri(option.id, activeAccentColor, isDarkMode ? 0.32 : 0.22);

                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    aria-label={option.label}
                                    onClick={() => {
                                        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                                            navigator.vibrate(10);
                                        }
                                        setChatWallpaper(option.id);
                                    }}
                                    style={{
                                        position: 'relative',
                                        overflow: 'hidden',
                                        fontFamily: "'Nunito', 'Vazir', sans-serif",
                                        border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
                                        background: isSelected
                                            ? 'color-mix(in srgb, var(--accent-primary) 12%, var(--glass-surface-soft))'
                                            : 'var(--glass-surface-soft)',
                                        color: 'var(--text-primary)',
                                        borderRadius: 14,
                                        minHeight: 48,
                                        padding: '8px 14px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        cursor: 'pointer',
                                        transition: 'border-color .15s ease, background .15s ease',
                                    }}
                                >
                                    {cardPatternUri ? (
                                        <span
                                            aria-hidden="true"
                                            style={{
                                                position: 'absolute',
                                                inset: 0,
                                                pointerEvents: 'none',
                                                backgroundImage: `url("${cardPatternUri}")`,
                                                backgroundRepeat: 'repeat',
                                                backgroundSize: getWallpaperSize(option.id),
                                                opacity: isSelected ? 1 : 0.85,
                                            }}
                                        />
                                    ) : null}

                                    <span style={{
                                        position: 'relative',
                                        zIndex: 2,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        width: '100%',
                                    }}>
                                        {option.id === 'none' ? (
                                            <span style={{
                                                fontSize: 13,
                                                fontWeight: isSelected ? 700 : 500,
                                                color: 'var(--text-primary)',
                                                letterSpacing: '0.2px',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                paddingLeft: 4,
                                            }}>
                                                {option.label}
                                            </span>
                                        ) : null}
                                        {isSelected ? (
                                            <span style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                width: 20,
                                                height: 20,
                                                borderRadius: '50%',
                                                background: 'var(--accent-primary)',
                                                color: '#ffffff',
                                                flexShrink: 0,
                                                marginInlineStart: 'auto',
                                            }}>
                                                <Check size={12} strokeWidth={3} />
                                            </span>
                                        ) : null}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, direction: 'rtl', textAlign: 'right' }}>
                <div className="profile__section-title">
                    <span className="profile__section-icon"><Smile size={15} /></span>
                    فونت و ایموجی
                </div>
                <div className="profile__chat-id-card profile__chat-id-card--flat">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <p className="profile__field-label" style={{ margin: 0 }}>فونت ایموجی Apple</p>
                        <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: emojiActive ? 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'var(--bg-tertiary)', color: emojiActive ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                            {emojiDownloaded ? (emojiActive ? 'فعال' : 'غیرفعال') : 'دانلود نشده'}
                        </span>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                        اعمال ایموجی‌های Apple بر روی تمام بخش‌های برنامه.
                    </p>

                    <div style={{
                        padding: '10px 14px',
                        borderRadius: 999,
                        background: 'var(--glass-surface-soft)',
                        border: '1px solid var(--glass-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        fontSize: 22,
                        marginBottom: 14,
                    }}>
                        <span>✨</span>
                        <span>🔥</span>
                        <span>❤️</span>
                        <span>😂</span>
                        <span>👍</span>
                        <span>🎉</span>
                        <span>🚀</span>
                        <span>🪐</span>
                    </div>

                    {emojiError && (
                        <div style={{ fontSize: 12, color: 'var(--color-danger, #ef4444)', marginBottom: 10 }}>
                            {emojiError}
                        </div>
                    )}

                    {isDownloadingEmoji ? (
                        <div style={{ display: 'grid', gap: 10, width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <Loader2 size={14} className="spin" /> در حال دریافت فونت...
                                </span>
                                <span>{Math.round(emojiProgress)}٪ ({emojiLoadedMB} مگابایت)</span>
                            </div>
                            <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'var(--border-secondary)', overflow: 'hidden' }}>
                                <div style={{ width: `${emojiProgress}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width .2s ease' }} />
                            </div>
                            <button
                                type="button"
                                onClick={handleCancelDownload}
                                style={{
                                    padding: '6px 14px',
                                    borderRadius: 999,
                                    border: '1px solid var(--border-primary)',
                                    background: 'transparent',
                                    color: 'var(--text-secondary)',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                    alignSelf: 'flex-start',
                                    fontFamily: 'inherit',
                                }}
                            >
                                انصراف
                            </button>
                        </div>
                    ) : !emojiDownloaded ? (
                        <button
                            type="button"
                            onClick={handleDownloadEmoji}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                padding: '10px 18px',
                                borderRadius: 999,
                                border: '1px solid var(--accent-primary)',
                                background: 'var(--accent-primary)',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: 13,
                                fontWeight: 600,
                                fontFamily: 'inherit',
                                width: '100%',
                                transition: 'all .2s ease',
                            }}
                        >
                            <Download size={16} />
                            دانلود
                        </button>
                    ) : (
                        <div style={{ display: 'grid', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                                    فعال بودن فونت ایموجی
                                </span>
                                <button
                                    type="button"
                                    onClick={handleToggleEmoji}
                                    aria-label="toggle ios emoji font"
                                    style={{
                                        width: 48,
                                        height: 28,
                                        borderRadius: 999,
                                        cursor: 'pointer',
                                        border: isDarkMode
                                            ? (emojiActive ? '1px solid color-mix(in srgb, var(--accent-primary) 70%, var(--border-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 35%, var(--border-primary))')
                                            : (emojiActive ? '1px solid color-mix(in srgb, var(--text-primary) 28%, var(--accent-primary))' : '1px solid color-mix(in srgb, var(--text-primary) 24%, var(--border-primary))'),
                                        background: emojiActive ? 'var(--accent-primary)' : (isDarkMode ? 'var(--bg-tertiary)' : 'color-mix(in srgb, var(--text-primary) 30%, var(--bg-primary))'),
                                        position: 'relative',
                                        transition: 'all .2s ease',
                                    }}
                                >
                                    <span style={{ position: 'absolute', top: 2, right: emojiActive ? 2 : 22, width: 22, height: 22, borderRadius: '50%', background: isDarkMode ? '#fff' : (emojiActive ? '#fff' : '#d3d3d3'), transition: 'all .2s ease' }} />
                                </button>
                            </div>

                            <div style={{ paddingTop: 10, borderTop: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'flex-start' }}>
                                <button
                                    type="button"
                                    onClick={handleDeleteEmoji}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '7px 14px',
                                        borderRadius: 999,
                                        border: '1px solid color-mix(in srgb, var(--color-danger, #ef4444) 30%, transparent)',
                                        background: 'color-mix(in srgb, var(--color-danger, #ef4444) 8%, transparent)',
                                        color: 'var(--color-danger, #ef4444)',
                                        cursor: 'pointer',
                                        fontSize: 12,
                                        fontFamily: 'inherit',
                                    }}
                                >
                                    <Trash2 size={14} />
                                    حذف فونت از حافظه مرورگر
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
        </>
    );
}
