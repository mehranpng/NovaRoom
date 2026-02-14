import { Moon, Sun } from 'lucide-react';

interface DarkModeToggleProps {
  isDarkMode: boolean;
  onToggle: () => void;
}

export function DarkModeToggle({ isDarkMode, onToggle }: DarkModeToggleProps) {
  return (
    <button
      className="icon-btn"
      onClick={onToggle}
      aria-label={isDarkMode ? 'حالت روشن' : 'حالت تاریک'}
      title={isDarkMode ? 'حالت روشن' : 'حالت تاریک'}
      type="button"
    >
      {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
