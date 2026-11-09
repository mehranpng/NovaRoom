import { useEffect, useRef } from 'react';
import { CloseIcon } from './icons/TelegramIcons';

type ProgressSpinnerProps = {
  progress?: number;
  size?: 's' | 'm' | 'l';
  noCross?: boolean;
  ariaLabel?: string;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
};

const SIZES = { s: 42, m: 48, l: 54 };
const STROKE_WIDTH = 2;
const PADDING = 2;
const MIN_PROGRESS = 0.05;
const MAX_PROGRESS = 1;
const GROW_DURATION = 600;
const ROTATE_DURATION = 2000;

export function ProgressSpinner({ progress = 0, size = 'l', noCross = false, ariaLabel, onClick }: ProgressSpinnerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const sizePx = SIZES[size];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let isFirst = true;
    let displayed = MIN_PROGRESS;
    let growFrom = MIN_PROGRESS;
    let growStartedAt = Date.now();
    let prevProgress: number | undefined;
    let frame = 0;

    const loop = () => {
      if (!canvasRef.current) return;
      if (progressRef.current !== prevProgress) {
        growFrom = Math.min(Math.max(MIN_PROGRESS, displayed), MAX_PROGRESS);
        growStartedAt = Date.now();
        prevProgress = progressRef.current;
      }
      const target = Math.min(Math.max(MIN_PROGRESS, progressRef.current), MAX_PROGRESS);
      const t = Math.min(1, (Date.now() - growStartedAt) / GROW_DURATION);
      const eased = 1 - (1 - t) ** 3;
      displayed = growFrom + (target - growFrom) * eased;
      drawSpinnerArc(canvasRef.current, sizePx * dpr, STROKE_WIDTH * dpr, '#fff', displayed, dpr, isFirst, reducedMotion ? 0 : undefined);
      isFirst = false;
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  const px = SIZES[size];

  return (
    <div
      className={`progress-spinner progress-spinner--${size}${noCross ? ' progress-spinner--no-cross' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={ariaLabel}
    >
      {!noCross && <CloseIcon className="progress-spinner__cross" size={26} />}
      <canvas ref={canvasRef} className="progress-spinner__canvas" style={{ width: px, height: px }} />
    </div>
  );
}

function drawSpinnerArc(
  canvas: HTMLCanvasElement,
  size: number,
  strokeWidth: number,
  color: string,
  progress: number,
  dpr: number,
  shouldInit = false,
  rotationOffset?: number,
) {
  const centerCoordinate = size / 2;
  const radius = (size - strokeWidth) / 2 - PADDING * dpr;
  const offset = rotationOffset ?? (Date.now() % ROTATE_DURATION) / ROTATE_DURATION;
  const startAngle = 2 * Math.PI * offset;
  const endAngle = startAngle + 2 * Math.PI * progress;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (shouldInit) {
    canvas.width = size;
    canvas.height = size;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
  }

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(centerCoordinate, centerCoordinate, radius, startAngle, endAngle);
  ctx.stroke();
}
