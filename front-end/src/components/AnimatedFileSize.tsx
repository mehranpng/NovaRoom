import { memo, useEffect, useRef, useState } from 'react';
import { formatFileSize } from '../utils/fileUtils';

const SKIP_AFTER = 1024 * 1024 * 1024;
const MIN_SIZE_INCREASE = 256 * 1024;
const UPDATES_PER_SECOND = 10;

export const AnimatedFileSize = memo(function AnimatedFileSize({ size, progress, className }: { size: number; progress?: number; className?: string }) {
  const [currentSize, setCurrentSize] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (progress === undefined) {
      timerRef.current = window.setTimeout(() => setCurrentSize(0), 0);
    } else {
      const target = size * progress;
      if (target > SKIP_AFTER || progress >= 1) {
        timerRef.current = window.setTimeout(() => setCurrentSize(target), 0);
      } else {
        const tick = () => {
          setCurrentSize((current) => {
            const diff = target - current;
            if (diff <= 0) return current;
            return Math.min(target, current + Math.max(MIN_SIZE_INCREASE, diff / UPDATES_PER_SECOND));
          });
          timerRef.current = window.setTimeout(tick, 1000 / UPDATES_PER_SECOND);
        };
        timerRef.current = window.setTimeout(tick, 0);
      }
    }

    return () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };
  }, [progress, size]);

  if (progress === undefined || progress >= 1) {
    return <span className={className}>{formatFileSize(size, 1)}</span>;
  }

  return <span className={className} dir="ltr">{formatFileSize(currentSize, 2)} / {formatFileSize(size, 1)}</span>;
});
