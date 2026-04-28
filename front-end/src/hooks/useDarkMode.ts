import { useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeTone = 'neutral' | 'custom';
export type ThemePalette = 'blue' | 'green' | 'purple' | 'orange' | 'rose' | 'teal' | 'indigo' | 'amber';

const STORAGE_KEY = 'themeMode';
const TONE_STORAGE_KEY = 'themeTone';
const PALETTE_STORAGE_KEY = 'themePalette';
const LEGACY_DARK_MODE_KEY = 'darkMode';

const paletteMeta: Record<ThemePalette, { label: string; color: string }> = {
  blue: { label: 'آبی', color: '#2563eb' },
  green: { label: 'سبز', color: '#16a34a' },
  purple: { label: 'بنفش', color: '#7c3aed' },
  orange: { label: 'نارنجی', color: '#ea580c' },
  rose: { label: 'رز', color: '#e11d48' },
  teal: { label: 'فیروزه‌ای', color: '#0f766e' },
  indigo: { label: 'ایندیگو', color: '#4338ca' },
  amber: { label: 'کهربایی', color: '#d97706' },
};

const paletteAccentVars: Record<ThemePalette, { light: Record<string, string>; dark: Record<string, string> }> = {
  blue: {
    light: { '--accent-primary': '#2563eb', '--accent-hover': '#1d4ed8', '--accent-soft': '#dbeafe', '--accent-soft-text': '#1e40af' },
    dark: { '--accent-primary': '#60a5fa', '--accent-hover': '#3b82f6', '--accent-soft': 'rgba(96,165,250,0.18)', '--accent-soft-text': '#bfdbfe' },
  },
  green: {
    light: { '--accent-primary': '#16a34a', '--accent-hover': '#15803d', '--accent-soft': '#dcfce7', '--accent-soft-text': '#166534' },
    dark: { '--accent-primary': '#4ade80', '--accent-hover': '#22c55e', '--accent-soft': 'rgba(74,222,128,0.16)', '--accent-soft-text': '#bbf7d0' },
  },
  purple: {
    light: { '--accent-primary': '#7c3aed', '--accent-hover': '#6d28d9', '--accent-soft': '#ede9fe', '--accent-soft-text': '#5b21b6' },
    dark: { '--accent-primary': '#a78bfa', '--accent-hover': '#8b5cf6', '--accent-soft': 'rgba(167,139,250,0.17)', '--accent-soft-text': '#ddd6fe' },
  },
  orange: {
    light: { '--accent-primary': '#ea580c', '--accent-hover': '#c2410c', '--accent-soft': '#ffedd5', '--accent-soft-text': '#9a3412' },
    dark: { '--accent-primary': '#fb923c', '--accent-hover': '#f97316', '--accent-soft': 'rgba(251,146,60,0.17)', '--accent-soft-text': '#fed7aa' },
  },
  rose: {
    light: { '--accent-primary': '#e11d48', '--accent-hover': '#be123c', '--accent-soft': '#ffe4e6', '--accent-soft-text': '#9f1239' },
    dark: { '--accent-primary': '#fb7185', '--accent-hover': '#f43f5e', '--accent-soft': 'rgba(251,113,133,0.17)', '--accent-soft-text': '#fecdd3' },
  },
  teal: {
    light: { '--accent-primary': '#0f766e', '--accent-hover': '#115e59', '--accent-soft': '#ccfbf1', '--accent-soft-text': '#134e4a' },
    dark: { '--accent-primary': '#2dd4bf', '--accent-hover': '#14b8a6', '--accent-soft': 'rgba(45,212,191,0.17)', '--accent-soft-text': '#99f6e4' },
  },
  indigo: {
    light: { '--accent-primary': '#4338ca', '--accent-hover': '#3730a3', '--accent-soft': '#e0e7ff', '--accent-soft-text': '#312e81' },
    dark: { '--accent-primary': '#818cf8', '--accent-hover': '#6366f1', '--accent-soft': 'rgba(129,140,248,0.16)', '--accent-soft-text': '#c7d2fe' },
  },
  amber: {
    light: { '--accent-primary': '#d97706', '--accent-hover': '#b45309', '--accent-soft': '#fef3c7', '--accent-soft-text': '#92400e' },
    dark: { '--accent-primary': '#fbbf24', '--accent-hover': '#f59e0b', '--accent-soft': 'rgba(251,191,36,0.18)', '--accent-soft-text': '#fde68a' },
  },
};

const neutralThemeVars = {
  light: {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f9fafb',
    '--bg-tertiary': '#f3f4f6',
    '--border-primary': '#f3f4f6',
    '--border-secondary': '#e5e7eb',
    '--text-primary': '#111827',
    '--text-secondary': '#6b7280',
    '--text-tertiary': '#9ca3af',
    '--hover-bg': '#f3f4f6',
    '--hover-bg-light': '#f9fafb',
    '--message-theirs-bg': '#ffffff',
    '--message-theirs-text': '#111827',
    '--input-bg': '#f3f4f6',
    '--input-bg-focus': '#f9fafb',
    '--reply-box-bg': '#f9fafb',
    '--reply-box-border': '#f3f4f6',
    '--reply-box-text': '#374151',
    '--reply-box-text-secondary': '#6b7280',
  },
  dark: {
    '--bg-primary': '#1b1d21',
    '--bg-secondary': '#22252b',
    '--bg-tertiary': '#2a2e35',
    '--border-primary': '#313741',
    '--border-secondary': '#3b4350',
    '--text-primary': '#f3f4f6',
    '--text-secondary': '#d1d5db',
    '--text-tertiary': '#9ca3af',
    '--hover-bg': '#323846',
    '--hover-bg-light': '#2a303b',
    '--message-theirs-bg': '#2d323c',
    '--message-theirs-text': '#f3f4f6',
    '--input-bg': '#2d323c',
    '--input-bg-focus': '#3a414d',
    '--reply-box-bg': '#2d323c',
    '--reply-box-border': '#3a414d',
    '--reply-box-text': '#f3f4f6',
    '--reply-box-text-secondary': '#d1d5db',
  },
};

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'system' || stored === 'light' || stored === 'dark') return stored;
  const legacyDarkMode = localStorage.getItem(LEGACY_DARK_MODE_KEY);
  if (legacyDarkMode === 'true') return 'dark';
  if (legacyDarkMode === 'false') return 'light';
  return 'system';
}

function getInitialTone(): ThemeTone {
  if (typeof window === 'undefined') return 'neutral';
  return localStorage.getItem(TONE_STORAGE_KEY) === 'custom' ? 'custom' : 'neutral';
}

function getInitialPalette(): ThemePalette {
  if (typeof window === 'undefined') return 'blue';
  const stored = localStorage.getItem(PALETTE_STORAGE_KEY) as ThemePalette | null;
  return stored && stored in paletteMeta ? stored : 'blue';
}

const createCustomSurfaceVars = (isDarkMode: boolean): Record<string, string> => {
  if (!isDarkMode) {
    return {
      '--bg-primary': 'color-mix(in srgb, var(--accent-primary) 8%, #ffffff)',
      '--bg-secondary': 'color-mix(in srgb, var(--accent-primary) 14%, #ffffff)',
      '--bg-tertiary': 'color-mix(in srgb, var(--accent-primary) 20%, #ffffff)',
      '--border-primary': 'color-mix(in srgb, var(--accent-primary) 24%, #e5e7eb)',
      '--border-secondary': 'color-mix(in srgb, var(--accent-primary) 34%, #d1d5db)',
      '--hover-bg': 'color-mix(in srgb, var(--accent-primary) 26%, #f3f4f6)',
      '--hover-bg-light': 'color-mix(in srgb, var(--accent-primary) 16%, #f9fafb)',
      '--message-theirs-bg': 'color-mix(in srgb, var(--accent-primary) 10%, #ffffff)',
      '--input-bg': 'color-mix(in srgb, var(--accent-primary) 18%, #f3f4f6)',
      '--input-bg-focus': 'color-mix(in srgb, var(--accent-primary) 24%, #f3f4f6)',
      '--reply-box-bg': 'color-mix(in srgb, var(--accent-primary) 14%, #f9fafb)',
      '--reply-box-border': 'color-mix(in srgb, var(--accent-primary) 24%, #e5e7eb)',
    };
  }

  return {
    '--bg-primary': 'color-mix(in srgb, var(--accent-primary) 12%, #14161a)',
    '--bg-secondary': 'color-mix(in srgb, var(--accent-primary) 18%, #1c1f26)',
    '--bg-tertiary': 'color-mix(in srgb, var(--accent-primary) 24%, #242934)',
    '--border-primary': 'color-mix(in srgb, var(--accent-primary) 26%, #323846)',
    '--border-secondary': 'color-mix(in srgb, var(--accent-primary) 34%, #3b4350)',
    '--hover-bg': 'color-mix(in srgb, var(--accent-primary) 30%, #2b313d)',
    '--hover-bg-light': 'color-mix(in srgb, var(--accent-primary) 24%, #252b35)',
    '--message-theirs-bg': 'color-mix(in srgb, var(--accent-primary) 18%, #2b313d)',
    '--input-bg': 'color-mix(in srgb, var(--accent-primary) 22%, #2b313d)',
    '--input-bg-focus': 'color-mix(in srgb, var(--accent-primary) 30%, #343b49)',
    '--reply-box-bg': 'color-mix(in srgb, var(--accent-primary) 20%, #2b313d)',
    '--reply-box-border': 'color-mix(in srgb, var(--accent-primary) 28%, #343b49)',
  };
};

export function useDarkMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [themeTone, setThemeTone] = useState<ThemeTone>(getInitialTone);
  const [themePalette, setThemePalette] = useState<ThemePalette>(getInitialPalette);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const isDarkMode = useMemo(() => {
    if (themeMode === 'dark') return true;
    if (themeMode === 'light') return false;
    return systemPrefersDark;
  }, [themeMode, systemPrefersDark]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark-mode', isDarkMode);

    localStorage.setItem(STORAGE_KEY, themeMode);
    localStorage.setItem(TONE_STORAGE_KEY, themeTone);
    localStorage.setItem(PALETTE_STORAGE_KEY, themePalette);

    const baseVars = isDarkMode ? neutralThemeVars.dark : neutralThemeVars.light;
    Object.entries(baseVars).forEach(([key, value]) => root.style.setProperty(key, value));

    const accentVars = isDarkMode ? paletteAccentVars[themePalette].dark : paletteAccentVars[themePalette].light;
    Object.entries(accentVars).forEach(([key, value]) => root.style.setProperty(key, value));

    if (themeTone === 'custom') {
      const customSurfaceVars = createCustomSurfaceVars(isDarkMode);
      Object.entries(customSurfaceVars).forEach(([key, value]) => root.style.setProperty(key, value));
    }

    const themeColor = getComputedStyle(root).getPropertyValue('--bg-primary').trim() || (isDarkMode ? '#1b1d21' : '#ffffff');
    const ensureMeta = (name: string) => {
      let m = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!m) {
        m = document.createElement('meta');
        m.name = name;
        document.head.appendChild(m);
      }
      m.setAttribute('content', themeColor);
    };

    ensureMeta('theme-color');
    ensureMeta('msapplication-navbutton-color');
    (root.style as any).colorScheme = isDarkMode ? 'dark' : 'light';
  }, [isDarkMode, themeMode, themeTone, themePalette]);

  return {
    themeMode,
    setThemeMode,
    isDarkMode,
    themeTone,
    setThemeTone,
    themePalette,
    setThemePalette,
    paletteOptions: paletteMeta,
  };
}
