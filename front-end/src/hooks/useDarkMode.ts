import { useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeTone = 'neutral' | 'custom';
export type ThemePalette = 'blue' | 'green' | 'purple' | 'orange' | 'rose' | 'teal' | 'amber' | 'red' | 'pink' | 'cyan';
export type AccentIntensity = 'low' | 'medium' | 'high';

const STORAGE_KEY = 'themeMode';
const TONE_STORAGE_KEY = 'themeTone';
const PALETTE_STORAGE_KEY = 'themePalette';
const LEGACY_DARK_MODE_KEY = 'darkMode';
const INTENSITY_STORAGE_KEY = 'themeAccentIntensity';



const intensityScale: Record<AccentIntensity, number> = {
  low: 0.56,
  medium: 0.78,
  high: 1,
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

function mixHex(baseHex: string, targetHex: string, amount: number): string {
  const base = hexToRgb(baseHex);
  const target = hexToRgb(targetHex);
  if (!base || !target) return baseHex;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    base.r + (target.r - base.r) * t,
    base.g + (target.g - base.g) * t,
    base.b + (target.b - base.b) * t,
  );
}

function buildAccentVarsWithIntensity(accentVars: Record<string, string>, isDarkMode: boolean, intensity: AccentIntensity): Record<string, string> {
  if (intensity === 'high') return accentVars;
  const keep = intensityScale[intensity];
  const blendTo = isDarkMode ? '#d1d5db' : '#ffffff';
  const next = { ...accentVars };
  next['--accent-primary'] = mixHex(accentVars['--accent-primary'], blendTo, 1 - keep);
  next['--accent-hover'] = mixHex(accentVars['--accent-hover'], blendTo, 1 - keep);
  next['--accent-soft-text'] = mixHex(accentVars['--accent-soft-text'], blendTo, 1 - keep * 0.85);
  if (isDarkMode) {
    const alpha = intensity === 'medium' ? '0.20' : '0.14';
    next['--accent-soft'] = `color-mix(in srgb, ${next['--accent-primary']} 24%, rgba(255,255,255,${alpha}))`;
  } else {
    const bgAmount = intensity === 'medium' ? '20%' : '12%';
    next['--accent-soft'] = `color-mix(in srgb, ${next['--accent-primary']} ${bgAmount}, #ffffff)`;
  }
  return next;
}
const paletteMeta: Record<ThemePalette, { label: string; color: string }> = {
  blue: { label: 'آبی', color: '#2563eb' },
  green: { label: 'سبز', color: '#16a34a' },
  purple: { label: 'بنفش', color: '#7c3aed' },
  orange: { label: 'نارنجی', color: '#ea580c' },
  rose: { label: 'رز', color: '#c026d3' },
  teal: { label: 'فیروزه‌ای', color: '#0f766e' },
  amber: { label: 'کهربایی', color: '#d97706' },
  red: { label: 'قرمز', color: '#dc2626' },
  pink: { label: 'صورتی', color: '#db2777' },
  cyan: { label: 'آبی روشن', color: '#0891b2' },
};

const paletteAccentVars: Record<ThemePalette, { light: Record<string, string>; dark: Record<string, string> }> = {
  blue: {
    light: { '--accent-primary': '#2563eb', '--accent-hover': '#1d4ed8', '--accent-soft': '#dbeafe', '--accent-soft-text': '#1e40af' },
    dark: { '--accent-primary': '#3b82f6', '--accent-hover': '#2563eb', '--accent-soft': 'rgba(59,130,246,0.24)', '--accent-soft-text': '#dbeafe' },
  },
  green: {
    light: { '--accent-primary': '#16a34a', '--accent-hover': '#15803d', '--accent-soft': '#dcfce7', '--accent-soft-text': '#166534' },
    dark: { '--accent-primary': '#22c55e', '--accent-hover': '#16a34a', '--accent-soft': 'rgba(34,197,94,0.22)', '--accent-soft-text': '#dcfce7' },
  },
  purple: {
    light: { '--accent-primary': '#7c3aed', '--accent-hover': '#6d28d9', '--accent-soft': '#ede9fe', '--accent-soft-text': '#5b21b6' },
    dark: { '--accent-primary': '#8b5cf6', '--accent-hover': '#7c3aed', '--accent-soft': 'rgba(139,92,246,0.24)', '--accent-soft-text': '#ede9fe' },
  },
  orange: {
    light: { '--accent-primary': '#ea580c', '--accent-hover': '#c2410c', '--accent-soft': '#ffedd5', '--accent-soft-text': '#9a3412' },
    dark: { '--accent-primary': '#f97316', '--accent-hover': '#ea580c', '--accent-soft': 'rgba(249,115,22,0.24)', '--accent-soft-text': '#ffedd5' },
  },
  rose: {
    light: { '--accent-primary': '#c026d3', '--accent-hover': '#a21caf', '--accent-soft': '#fae8ff', '--accent-soft-text': '#86198f' },
    dark: { '--accent-primary': '#d946ef', '--accent-hover': '#c026d3', '--accent-soft': 'rgba(217,70,239,0.24)', '--accent-soft-text': '#f5d0fe' },
  },
  teal: {
    light: { '--accent-primary': '#0f766e', '--accent-hover': '#115e59', '--accent-soft': '#ccfbf1', '--accent-soft-text': '#134e4a' },
    dark: { '--accent-primary': '#14b8a6', '--accent-hover': '#0f766e', '--accent-soft': 'rgba(20,184,166,0.24)', '--accent-soft-text': '#ccfbf1' },
  },
  amber: {
    light: { '--accent-primary': '#d97706', '--accent-hover': '#b45309', '--accent-soft': '#fef3c7', '--accent-soft-text': '#92400e' },
    dark: { '--accent-primary': '#f59e0b', '--accent-hover': '#d97706', '--accent-soft': 'rgba(245,158,11,0.24)', '--accent-soft-text': '#fef3c7' },
  },
  red: {
    light: { '--accent-primary': '#dc2626', '--accent-hover': '#b91c1c', '--accent-soft': '#fee2e2', '--accent-soft-text': '#991b1b' },
    dark: { '--accent-primary': '#ef4444', '--accent-hover': '#dc2626', '--accent-soft': 'rgba(239,68,68,0.24)', '--accent-soft-text': '#fecaca' },
  },
  pink: {
    light: { '--accent-primary': '#db2777', '--accent-hover': '#be185d', '--accent-soft': '#fce7f3', '--accent-soft-text': '#9d174d' },
    dark: { '--accent-primary': '#ec4899', '--accent-hover': '#db2777', '--accent-soft': 'rgba(236,72,153,0.24)', '--accent-soft-text': '#fbcfe8' },
  },
  cyan: {
    light: { '--accent-primary': '#0891b2', '--accent-hover': '#0e7490', '--accent-soft': '#cffafe', '--accent-soft-text': '#155e75' },
    dark: { '--accent-primary': '#06b6d4', '--accent-hover': '#0891b2', '--accent-soft': 'rgba(6,182,212,0.24)', '--accent-soft-text': '#a5f3fc' },
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

function getInitialIntensity(): AccentIntensity {
  if (typeof window === 'undefined') return 'medium';
  const stored = localStorage.getItem(INTENSITY_STORAGE_KEY);
  if (stored === 'low' || stored === 'medium' || stored === 'high') return stored;
  return 'medium';
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
    '--bg-primary': 'color-mix(in srgb, var(--accent-primary) 7%, #16181d)',
    '--bg-secondary': 'color-mix(in srgb, var(--accent-primary) 12%, #1f232b)',
    '--bg-tertiary': 'color-mix(in srgb, var(--accent-primary) 16%, #272c36)',
    '--border-primary': 'color-mix(in srgb, var(--accent-primary) 18%, #323846)',
    '--border-secondary': 'color-mix(in srgb, var(--accent-primary) 24%, #3b4350)',
    '--hover-bg': 'color-mix(in srgb, var(--accent-primary) 20%, #2b313d)',
    '--hover-bg-light': 'color-mix(in srgb, var(--accent-primary) 16%, #252b35)',
    '--message-theirs-bg': 'color-mix(in srgb, var(--accent-primary) 12%, #2b313d)',
    '--input-bg': 'color-mix(in srgb, var(--accent-primary) 14%, #2b313d)',
    '--input-bg-focus': 'color-mix(in srgb, var(--accent-primary) 20%, #343b49)',
    '--reply-box-bg': 'color-mix(in srgb, var(--accent-primary) 14%, #2b313d)',
    '--reply-box-border': 'color-mix(in srgb, var(--accent-primary) 18%, #343b49)',
  };
};

export function useDarkMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);
  const [themeTone, setThemeTone] = useState<ThemeTone>(getInitialTone);
  const [themePalette, setThemePalette] = useState<ThemePalette>(getInitialPalette);
  const [accentIntensity, setAccentIntensity] = useState<AccentIntensity>(getInitialIntensity);
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
    localStorage.setItem(INTENSITY_STORAGE_KEY, accentIntensity);

    const baseVars = isDarkMode ? neutralThemeVars.dark : neutralThemeVars.light;
    Object.entries(baseVars).forEach(([key, value]) => root.style.setProperty(key, value));
    root.style.setProperty('--message-mine-text', accentIntensity === 'low' && !isDarkMode ? '#111827' : '#ffffff');
    root.style.setProperty('--message-reply-text', accentIntensity === 'low' && !isDarkMode ? '#111827' : (isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.9)'));
    root.style.setProperty('--message-reply-text-secondary', accentIntensity === 'low' && !isDarkMode ? '#111827' : (isDarkMode ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.95)'));

    const baseAccentVars = isDarkMode ? paletteAccentVars[themePalette].dark : paletteAccentVars[themePalette].light;
    const accentVars = buildAccentVarsWithIntensity(baseAccentVars, isDarkMode, accentIntensity);
    Object.entries(accentVars).forEach(([key, value]) => root.style.setProperty(key, value));
    root.style.setProperty('--status-online-color', 'color-mix(in srgb, var(--accent-primary) 68%, var(--text-primary))');

    if (themeTone === 'custom') {
      const customSurfaceVars = createCustomSurfaceVars(isDarkMode);
      Object.entries(customSurfaceVars).forEach(([key, value]) => root.style.setProperty(key, value));
    }

    const computed = getComputedStyle(root);
    const headerColor = computed.getPropertyValue('--bg-secondary').trim()
      || computed.getPropertyValue('--bg-primary').trim()
      || (isDarkMode ? '#22252b' : '#f9fafb');
    const themeColor = headerColor;
    const themeMetas = Array.from(document.querySelectorAll('meta[name="theme-color"]')) as HTMLMetaElement[];
    if (themeMetas.length === 0) {
      const m = document.createElement('meta');
      m.name = 'theme-color';
      document.head.appendChild(m);
      themeMetas.push(m);
    }
    themeMetas.forEach((m) => {
      m.setAttribute('content', themeColor);
      m.removeAttribute('media');
    });

    const ensureThemeMetaForScheme = (scheme: 'dark' | 'light') => {
      let m = document.querySelector(`meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`) as HTMLMetaElement | null;
      if (!m) {
        m = document.createElement('meta');
        m.name = 'theme-color';
        m.setAttribute('media', `(prefers-color-scheme: ${scheme})`);
        document.head.appendChild(m);
      }
      m.setAttribute('content', themeColor);
    };

    ensureThemeMetaForScheme('light');
    ensureThemeMetaForScheme('dark');
    document.body.style.backgroundColor = themeColor;

    const ensureMeta = (name: string) => {
      let m = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!m) {
        m = document.createElement('meta');
        m.name = name;
        document.head.appendChild(m);
      }
      m.setAttribute('content', themeColor);
    };

    ensureMeta('msapplication-navbutton-color');
    (root.style as any).colorScheme = isDarkMode ? 'dark' : 'light';
  }, [isDarkMode, themeMode, themeTone, themePalette, accentIntensity]);

  return {
    themeMode,
    setThemeMode,
    isDarkMode,
    themeTone,
    setThemeTone,
    themePalette,
    setThemePalette,
    paletteOptions: paletteMeta,
    accentIntensity,
    setAccentIntensity,
  };
}
