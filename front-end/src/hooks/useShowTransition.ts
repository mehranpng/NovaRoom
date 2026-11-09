import { useEffect, useState } from 'react';

export function useShowTransition(isOpen: boolean, closeDuration = 300) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      let second = 0;
      const first = requestAnimationFrame(() => {
        setShouldRender(true);
        second = requestAnimationFrame(() => setIsVisible(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    const hideFrame = requestAnimationFrame(() => setIsVisible(false));
    const timer = window.setTimeout(() => setShouldRender(false), closeDuration);
    return () => {
      cancelAnimationFrame(hideFrame);
      window.clearTimeout(timer);
    };
  }, [isOpen, closeDuration]);

  return { shouldRender, className: isVisible ? 'open' : '' };
}
