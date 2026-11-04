import { Monitor, Moon, Sun } from 'lucide-react';
import { type ThemeMode } from '../hooks/useDarkMode';

interface DarkModeToggleProps {
  themeMode: ThemeMode;
  onToggle: () => void;
}

export function DarkModeToggle({ themeMode, onToggle }: DarkModeToggleProps) {
  const nextMode: ThemeMode =
    themeMode === 'system' ? 'light' : themeMode === 'light' ? 'dark' : 'system';

  const labelByMode: Record<ThemeMode, string> = {
    system: 'سیستم',
    light: 'روشن',
    dark: 'تاریک',
  };

  return (
    <button
      className="icon-btn"
      onClick={onToggle}
      aria-label={`تم فعلی: ${labelByMode[themeMode]} | بعدی: ${labelByMode[nextMode]}`}
      title={`تم فعلی: ${labelByMode[themeMode]} | بعدی: ${labelByMode[nextMode]}`}
      type="button"
    >
      {themeMode === 'system' && <Monitor size={20} />}
      {themeMode === 'light' && <Sun size={20} />}
      {themeMode === 'dark' && <Moon size={20} />}
    </button>
  );
}
