import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { NotificationType } from '../utils/notificationBus';
import { subscribeNotifications } from '../utils/notificationBus';
import './NotificationCenter.css';

type NotificationItem = {
  id: string;
  message: string;
  type: NotificationType;
  durationMs: number;
};

const EXIT_MS = 220;

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

const NotificationCard = ({ item, stackIndex }: { item: NotificationItem; stackIndex: number }) => {
  const typeClass = useMemo(() => getTypeClassName(item.type), [item.type]);

  return (
    <motion.div
      className={`notification ${typeClass}`}
      style={{ zIndex: 1000 - stackIndex }}
      initial={{ y: -26, opacity: 0, scale: 0.97 }}
      animate={{ y: stackIndex * 10, opacity: 1, scale: 1, x: 0 }}
      exit={{ y: -24, opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2, ease: 'linear' }}
    >
      <span className="notification__icon" aria-hidden="true">
        <IconGlyph type={item.type} />
      </span>
      <p className="notification__message">{item.message}</p>
    </motion.div>
  );
};

export const NotificationCenter = () => {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const removalTimersRef = useRef<Record<string, number>>({});

  const dismissNotification = (id: string) => {
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

      window.setTimeout(() => dismissNotification(incoming.id), incoming.durationMs);
    });

    return () => {
      unsubscribe();
      Object.values(removalTimersRef.current).forEach((t) => window.clearTimeout(t));
      removalTimersRef.current = {};
    };
  }, []);

  return (
    <div className="notification-center" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <NotificationCard
            key={item.id}
            item={item}
            stackIndex={index}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
