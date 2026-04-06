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
  dismissDirection?: -1 | 0 | 1;
};

const EXIT_MS = 260;
const DRAG_DISMISS_THRESHOLD = 52;

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
  onDismiss: (id: string, direction?: -1 | 0 | 1) => void;
}) => {
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(0);
  const dragRef = useRef<{ active: boolean; startX: number; pointerId: number | null }>({
    active: false,
    startX: 0,
    pointerId: null,
  });

  const typeClass = useMemo(() => getTypeClassName(item.type), [item.type]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { active: true, startX: e.clientX, pointerId: e.pointerId };
    offsetRef.current = 0;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || item.leaving) return;
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

    const distance = offsetRef.current;
    dragRef.current = { active: false, startX: 0, pointerId: null };
    offsetRef.current = 0;
    setDragging(false);

    if (Math.abs(distance) >= DRAG_DISMISS_THRESHOLD) {
      onDismiss(item.id, distance > 0 ? 1 : -1);
      return;
    }

    setOffsetX(0);
  };

  const pointerOpacity = Math.max(0.35, 1 - Math.abs(offsetX) / 170);

  return (
    <div
      className={`notification ${typeClass} ${item.leaving ? `notification--leaving notification--leaving-${item.dismissDirection === 1 ? 'right' : item.dismissDirection === -1 ? 'left' : 'up'}` : ''} ${dragging ? 'notification--dragging' : ''}`}
      style={{
        zIndex: 1000 - stackIndex,
        transform: `translateY(${stackIndex * 9}px) translateX(${offsetX}px)`,
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
  const removalTimersRef = useRef<Record<string, number>>({});

  const dismissNotification = (id: string, direction: -1 | 0 | 1 = 0) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, leaving: true, dismissDirection: direction } : n)));
    if (removalTimersRef.current[id]) return;

    removalTimersRef.current[id] = window.setTimeout(() => {
      setItems((prev) => prev.filter((n) => n.id !== id));
      delete removalTimersRef.current[id];
    }, EXIT_MS);
  };

  useEffect(() => {
    const unsubscribe = subscribeNotifications((incoming) => {
      setItems((prev) => [{ ...incoming }, ...prev]);

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(42);
      }

      window.setTimeout(() => dismissNotification(incoming.id, 0), incoming.durationMs);
    });

    return () => {
      unsubscribe();
      Object.values(removalTimersRef.current).forEach((t) => window.clearTimeout(t));
      removalTimersRef.current = {};
    };
  }, []);

  return (
    <div className="notification-center" aria-live="polite" aria-atomic="false">
      {items.map((item, index) => (
        <NotificationCard
          key={item.id}
          item={item}
          stackIndex={index}
          onDismiss={dismissNotification}
        />
      ))}
    </div>
  );
};
