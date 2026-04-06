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

const EXIT_MS = 260;
const DRAG_DISMISS_THRESHOLD = 56;

const IconGlyph = ({ type }: { type: NotificationType }) => {
  if (type === 'success') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.8 7.8-5.6 6a1 1 0 0 1-1.45.02l-2.56-2.56a1 1 0 0 1 1.42-1.42l1.82 1.82 4.87-5.22a1 1 0 0 1 1.46 1.36Z" />
      </svg>
    );
  }

  if (type === 'info') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 14.5a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Zm1.2-2.9a1 1 0 1 1-2 0V7.4a1 1 0 1 1 2 0v6.2Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.6 13.6a1 1 0 0 1-1.4 1.4L12 14.8 9.8 17a1 1 0 1 1-1.4-1.4l2.2-2.2-2.2-2.2a1 1 0 0 1 1.4-1.4l2.2 2.2 2.2-2.2a1 1 0 0 1 1.4 1.4l-2.2 2.2 2.2 2.2Z" />
    </svg>
  );
};

const getTypeClassName = (type: NotificationType) => {
  if (type === 'success') return 'notification--success';
  if (type === 'info') return 'notification--info';
  return 'notification--error';
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
  const offsetRef = useRef(0);
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

  const typeClass = useMemo(() => getTypeClassName(item.type), [item.type]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { active: true, startX: e.clientX, pointerId: e.pointerId };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const next = e.clientX - dragRef.current.startX;
    offsetRef.current = next;
    setOffsetX(next);
  };

  const finishDrag = (target: HTMLElement) => {
    if (dragRef.current.pointerId !== null) {
      try {
        target.releasePointerCapture(dragRef.current.pointerId);
      } catch {
        // ignore
      }
    }

    const distance = Math.abs(offsetRef.current);
    dragRef.current = { active: false, startX: 0, pointerId: null };
    offsetRef.current = 0;
    setDragging(false);
    setOffsetX(0);

    if (distance >= DRAG_DISMISS_THRESHOLD) {
      onDismiss(item.id);
    }
  };

  const pointerOpacity = Math.max(0.35, 1 - Math.abs(offsetX) / 180);
  const dragTilt = Math.max(-7, Math.min(7, offsetX / 18));

  return (
    <div
      className={`notification ${typeClass} ${item.leaving ? 'notification--leaving' : ''} ${dragging ? 'notification--dragging' : ''}`}
      style={{
        zIndex: 1000 - stackIndex,
        transform: `translateY(${stackIndex * 9}px) translateX(${offsetX}px) rotate(${dragTilt}deg)`,
        opacity: item.leaving ? 0 : pointerOpacity,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishDrag(e.currentTarget)}
      onPointerCancel={(e) => finishDrag(e.currentTarget)}
    >
      <span className="notification__icon" aria-hidden="true">
        <IconGlyph type={item.type} />
      </span>
      <p className="notification__message">{item.message}</p>
    </div>
  );
};

export const NotificationCenter = () => {
  const [items, setItems] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeNotifications((incoming) => {
      setItems((prev) => [{ ...incoming }, ...prev]);

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(42);
      }

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
