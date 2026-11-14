import { useEffect, useMemo, useState, useRef } from 'react';
import { Check, Download, Loader2, Monitor, Moon, Sun, Trash2 } from 'lucide-react';
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
        visualEffects,
        setVisualEffects,
        chatWallpaper,
        setChatWallpaper,
        chatWallpaperIntensity,
        setChatWallpaperIntensity,
        chatWallpaperScale,
        setChatWallpaperScale,
    } = useDarkMode();
    const ultraDarkAvailable = isDarkMode;
    const shouldDisableCustomTone = isDarkMode && ultraDarkMode;

    const activeAccentColor = paletteOptions[themePalette]?.color || '#3b82f6';
    const previewPatternUri = useMemo(
        () => generateWallpaperDataUri(
            chatWallpaper,
            activeAccentColor,
            scaleWallpaperOpacity(isDarkMode ? 0.18 : 0.12, chatWallpaperIntensity)
        ),
        [chatWallpaper, activeAccentColor, isDarkMode, chatWallpaperIntensity]
    );
    const cardPatternUris = useMemo(
        () => new Map(WALLPAPER_OPTIONS.map((option) => [
            option.id,
            option.id === 'none' ? null : generateWallpaperDataUri(option.id, activeAccentColor, isDarkMode ? 0.32 : 0.22),
        ])),
        [activeAccentColor, isDarkMode]
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
        <div className="profile__content tg-settings-scroll" onScroll={handleScroll}>
            <div className="tg-island-title">حالت نمایش</div>
            <div className="tg-island">
                {modeOptions.map(({ value, label, icon: Icon }, idx) => (
                    <div key={value}>
                        {idx > 0 && <div className="tg-island__divider tg-island__divider--plain" aria-hidden="true" />}
                        <button
                            type="button"
                            className="tg-list-item"
                            onClick={() => setThemeMode(value)}
                        >
                            <span className="tg-list-item__copy" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <Icon size={18} />
                                <span className="tg-list-item__title">{label}</span>
                            </span>
                            {themeMode === value && (
                                <span className="tg-list-item__end" style={{ color: 'var(--accent-primary)' }}>
                                    <Check size={18} />
                                </span>
                            )}
                        </button>
                    </div>
                ))}
            </div>

            <div className="tg-island">
                <div className={cx('tg-row', !ultraDarkAvailable && 'tg-row--disabled')}>
                    <span className="tg-list-item__copy">
                        <span className="tg-list-item__title">حالت فوق تاریک</span>
                        <span className="tg-list-item__subtitle">پس‌زمینه مشکی خالص در حالت تاریک</span>
                    </span>
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
                        aria-pressed={ultraDarkMode}
                        disabled={!ultraDarkAvailable}
                        className={cx('tg-switch', ultraDarkMode && 'tg-switch--on')}
                    >
                        <span className="tg-switch__thumb" />
                    </button>
                </div>

                <div className="tg-island__divider tg-island__divider--plain" aria-hidden="true" />

                <div className="tg-row">
                    <span className="tg-list-item__copy">
                        <span className="tg-list-item__title">افکت Blur</span>
                        <span className="tg-list-item__subtitle">شفافیت شیشه‌ای در پنل‌ها و منوها</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                                navigator.vibrate(10);
                            }
                            setBlurEffect((prev) => !prev);
                        }}
                        aria-label="toggle blur effect"
                        aria-pressed={blurEffect}
                        className={cx('tg-switch', blurEffect && 'tg-switch--on')}
                    >
                        <span className="tg-switch__thumb" />
                    </button>
                </div>

                <div className="tg-island__divider tg-island__divider--plain" aria-hidden="true" />

                <div className="tg-row">
                    <span className="tg-list-item__copy">
                        <span className="tg-list-item__title">افکت‌ها</span>
                        <span className="tg-list-item__subtitle">افکت‌های بصری و انیمیشن‌های محیط برنامه</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                                navigator.vibrate(10);
                            }
                            setVisualEffects((prev) => !prev);
                        }}
                        aria-label="toggle visual effects"
                        aria-pressed={visualEffects}
                        className={cx('tg-switch', visualEffects && 'tg-switch--on')}
                    >
                        <span className="tg-switch__thumb" />
                    </button>
                </div>
            </div>

            <div className="tg-island-title">رنگ‌بندی و پالت</div>
            <div className="tg-island">
                {toneOptions.map((option, idx) => {
                    const isDisabled = option.value === 'custom' && shouldDisableCustomTone;
                    return (
                        <div key={option.value}>
                            {idx > 0 && <div className="tg-island__divider tg-island__divider--plain" aria-hidden="true" />}
                            <button
                                type="button"
                                className={cx('tg-list-item', isDisabled && 'tg-list-item--disabled')}
                                onClick={() => {
                                    if (isDisabled) return;
                                    setThemeTone(option.value);
                                }}
                                disabled={isDisabled}
                            >
                                <span className="tg-list-item__copy">
                                    <span className="tg-list-item__title">{option.label}</span>
                                    <span className="tg-list-item__subtitle">{option.description}</span>
                                </span>
                                {themeTone === option.value && (
                                    <span className="tg-list-item__end" style={{ color: 'var(--accent-primary)' }}>
                                        <Check size={18} />
                                    </span>
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="tg-island" style={{ padding: '14px 16px', gap: 10 }}>
                <p className="profile__field-label" style={{ margin: 0 }}>شدت رنگ ها</p>
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

            <div className="tg-island" style={{ padding: '14px 16px', gap: 10 }}>
                <p className="profile__field-label" style={{ margin: 0 }}>پالت‌های رنگی</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                    {(Object.entries(paletteOptions) as Array<[ThemePalette, { label: string; color: string }]>).map(([palette, meta]) => (
                        <button
                            key={palette}
                            type="button"
                            onClick={() => setThemePalette(palette)}
                            style={{
                                fontFamily: 'Vazir, sans-serif',
                                border: `1px solid ${themePalette === palette ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
                                background: themePalette === palette ? 'color-mix(in srgb, var(--accent-primary) 10%, var(--glass-surface-soft))' : 'var(--glass-surface-soft)',
                                color: 'var(--text-primary)',
                                borderRadius: 16,
                                minHeight: 44,
                                padding: '8px 14px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                cursor: 'pointer',
                            }}
                        >
                            <span style={{ fontFamily: 'Vazir, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 500 }}>
                                <span style={{ width: 16, height: 16, borderRadius: 999, background: meta.color, border: '1px solid rgba(255,255,255,0.3)' }} />
                                {meta.label}
                            </span>
                            {themePalette === palette ? <Check size={15} color="var(--accent-primary)" /> : null}
                        </button>
                    ))}
                </div>
            </div>

            <div className="tg-island-title">طرح پس‌زمینه چت</div>
            <div className="tg-island" style={{ padding: '14px 16px' }}>
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
                            backgroundSize: getWallpaperSize(chatWallpaper, chatWallpaperScale),
                        }} />

                        <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 4, direction: 'ltr' }}>
                            <div className="message-item">
                                <div className="message-row message-row--mine">
                                    <div className="message-bubble message-bubble--mine msg-shape--single">
                                        <div className="message-text">بهترین ادمین نواروم کیه به نظرت؟</div>
                                        <div className="message-footer-row">
                                            <div className="message-meta message-meta--mine" dir="ltr">
                                                <span className="message-time">۱۲:۳۰</span>
                                                <span className="message-status-icon message-status-icon--seen" aria-label="seen">
                                                    <svg width="16" height="11" viewBox="0 0 19 12" fill="none" aria-hidden="true">
                                                        <path d="M11.8 2.2L4.9 9.4L1.5 6.0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                                                        <path d="M17.3 2.2L10.4 9.4L8.2 7.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="message-item">
                                <div className="message-row message-row--theirs">
                                    <div className="message-bubble message-bubble--theirs msg-shape--single">
                                        <div className="message-text">قطعاً طاها</div>
                                        <div className="message-footer-row">
                                            <div className="message-reactions">
                                                <button type="button" className="message-reaction">
                                                    <span className="message-reaction__emoji">🤣</span>
                                                    <span className="message-reaction__count">۱</span>
                                                </button>
                                            </div>
                                            <div className="message-meta message-meta--theirs" dir="ltr">
                                                <span className="message-time">۱۲:۳۱</span>
                                            </div>
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

                    <p className="profile__field-label" style={{ marginTop: 16, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                        <span>اندازه الگو</span>
                        <span style={{ fontFamily: 'Vazir, sans-serif' }}>{toPersianDigits(chatWallpaperScale)}٪</span>
                    </p>
                    <input
                        type="range"
                        min={50}
                        max={200}
                        step={5}
                        className="theme-intensity-slider"
                        dir="rtl"
                        value={chatWallpaperScale}
                        disabled={chatWallpaper === 'none'}
                        aria-label="اندازه الگو"
                        onChange={(e) => setChatWallpaperScale(Number(e.currentTarget.value))}
                        style={{
                            width: '100%',
                            border: 'none',
                            outline: 'none',
                            boxShadow: 'none',
                            background: `linear-gradient(270deg, var(--accent-primary) 0%, var(--accent-primary) ${((chatWallpaperScale - 50) / 150) * 100}%, var(--border-secondary) ${((chatWallpaperScale - 50) / 150) * 100}%, var(--border-secondary) 100%)`,
                        }}
                    />

                    <p className="profile__field-label" style={{ marginTop: 16, marginBottom: 10 }}>انتخاب الگو</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                        {WALLPAPER_OPTIONS.map((option) => {
                            const isSelected = chatWallpaper === option.id;
                            const cardPatternUri = cardPatternUris.get(option.id);

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
                                        contain: 'paint',
                                        fontFamily: "'Nunito', 'Vazir', sans-serif",
                                        border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
                                        backgroundColor: isSelected
                                            ? 'color-mix(in srgb, var(--accent-primary) 12%, var(--glass-surface-soft))'
                                            : 'var(--glass-surface-soft)',
                                        backgroundImage: cardPatternUri ? `url("${cardPatternUri}")` : 'none',
                                        backgroundRepeat: 'repeat',
                                        backgroundSize: getWallpaperSize(option.id, chatWallpaperScale),
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
                                    <span style={{
                                        position: 'relative',
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

            <div className="tg-island-title">فونت و ایموجی</div>
            <div className="tg-island" style={{ padding: '14px 16px', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <p className="profile__field-label" style={{ margin: 0 }}>فونت ایموجی Apple</p>
                    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: emojiActive ? 'color-mix(in srgb, var(--accent-primary) 15%, transparent)' : 'var(--bg-tertiary)', color: emojiActive ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                        {emojiDownloaded ? (emojiActive ? 'فعال' : 'غیرفعال') : 'دانلود نشده'}
                    </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                    اعمال ایموجی‌های Apple بر روی تمام بخش‌های برنامه.
                </p>

                <div style={{
                    padding: '10px 14px',
                    borderRadius: 16,
                    background: 'var(--glass-surface-soft)',
                    border: '1px solid var(--glass-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    fontSize: 22,
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
                    <div style={{ fontSize: 12, color: 'var(--color-danger, #ef4444)' }}>
                        {emojiError}
                    </div>
                )}

                {isDownloadingEmoji ? (
                    <div style={{ display: 'grid', gap: 10, width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Loader2 size={14} className="animate-spin" /> در حال دریافت فونت...
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
                        className="tg-action-btn"
                        style={{ width: '100%' }}
                    >
                        <Download size={16} />
                        دانلود
                    </button>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="tg-row" style={{ paddingInline: 0 }}>
                            <span className="tg-list-item__title">فعال بودن فونت ایموجی</span>
                            <button
                                type="button"
                                onClick={handleToggleEmoji}
                                aria-label="toggle ios emoji font"
                                aria-pressed={emojiActive}
                                className={cx('tg-switch', emojiActive && 'tg-switch--on')}
                            >
                                <span className="tg-switch__thumb" />
                            </button>
                        </div>

                        <div style={{ paddingTop: 10, borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'flex-start' }}>
                            <button
                                type="button"
                                onClick={handleDeleteEmoji}
                                className="tg-action-btn tg-action-btn--danger"
                            >
                                <Trash2 size={14} />
                                حذف فونت از حافظه مرورگر
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </>
    );
}
