import { useEffect, useState } from 'react';

export function useDarkMode() {
  // Initialize from sessionStorage or default to light mode
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const stored = sessionStorage.getItem('darkMode');
    return stored === 'true';
  });

  useEffect(() => {
    // Apply or remove dark mode class to html element
    if (isDarkMode) {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
    // Save preference to sessionStorage
    sessionStorage.setItem('darkMode', String(isDarkMode));
  }, [isDarkMode]);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => !prev);
  };

  return { isDarkMode, toggleDarkMode };
}
