import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { NotificationType } from '../utils/notificationBus';
import { subscribeNotifications } from '../utils/notificationBus';
import './NotificationCenter.css';

type NotificationItem = {
  id: string;
  message: string;
  type: NotificationType;
  durationMs: number;
  leaving?: boolean;
};

const EXIT_MS = 220;
const DRAG_DISMISS_THRESHOLD = 72;

const getTypeMeta = (type: NotificationType) => {
  if (type === 'success') return { icon: '✓', className: 'notification--success' };
  if (type === 'info') return { icon: '!', className: 'notification--info' };
  return { icon: '✕', className: 'notification--error' };
};

const NotificationCard = ({
  item,
  stackIndex,
  onDismiss,
}: {
  item: NotificationItem;
  stackIndex: number;
  onDismiss: (id: string) => void;
}) => {
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ active: boolean; startX: number; pointerId: number | null }>({
    active: false,
    startX: 0,
    pointerId: null,
  });

  useEffect(() => {
    if (!item.leaving) return;
    const timer = window.setTimeout(() => onDismiss(item.id), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [item.id, item.leaving, onDismiss]);

  const { icon, className } = useMemo(() => getTypeMeta(item.type), [item.type]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { active: true, startX: e.clientX, pointerId: e.pointerId };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const next = e.clientX - dragRef.current.startX;
    setOffsetX(next);
  };

  const finishDrag = (target: HTMLElement | null) => {
    if (target && dragRef.current.pointerId !== null) {
      try {
        target.releasePointerCapture(dragRef.current.pointerId);
      } catch {
        // Ignore release errors.
      }
    }

    const shouldDismiss = Math.abs(offsetX) > DRAG_DISMISS_THRESHOLD;
    dragRef.current = { active: false, startX: 0, pointerId: null };
    setDragging(false);
    setOffsetX(0);
    if (shouldDismiss) onDismiss(item.id);
  };

  const pointerOpacity = Math.max(0.45, 1 - Math.abs(offsetX) / 220);
  const dragTilt = Math.max(-8, Math.min(8, offsetX / 22));

  return (
    <div
      className={`notification ${className} ${item.leaving ? 'notification--leaving' : ''} ${dragging ? 'notification--dragging' : ''}`}
      style={{
        zIndex: 1000 - stackIndex,
        transform: `translateY(${stackIndex * 8}px) translateX(${offsetX}px) rotate(${dragTilt}deg)`,
        opacity: item.leaving ? 0 : pointerOpacity,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishDrag(e.currentTarget)}
      onPointerCancel={(e) => finishDrag(e.currentTarget)}
    >
      <span className="notification__icon" aria-hidden="true">{icon}</span>
      <p className="notification__message">{item.message}</p>
    </div>
  );
};

export const NotificationCenter = () => {
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeNotifications((incoming) => {
      setItems((prev) => [{ ...incoming }, ...prev]);
      window.setTimeout(() => {
        setItems((prev) => prev.map((n) => (n.id === incoming.id ? { ...n, leaving: true } : n)));
      }, incoming.durationMs);
    });

    return unsubscribe;
  }, []);

  const markDismiss = (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, leaving: true } : n)));
  };

  const removeDismissed = (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="notification-center" aria-live="polite" aria-atomic="false">
      {items.map((item, index) => (
        <NotificationCard
          key={item.id}
          item={item}
          stackIndex={index}
          onDismiss={(id) => {
            if (item.leaving) {
              removeDismissed(id);
            } else {
              markDismiss(id);
            }
          }}
        />
      ))}
    </div>
  );
};
