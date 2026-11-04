export type NotificationType = 'success' | 'info' | 'error';

export type NotificationInput = {
  message: string;
  type?: NotificationType;
  durationMs?: number;
};

type Subscriber = (notification: Required<NotificationInput> & { id: string }) => void;

const subscribers = new Set<Subscriber>();

const normalizeInput = (input: string | NotificationInput): Required<NotificationInput> => {
  if (typeof input === 'string') {
    return { message: input, type: inferNotificationType(input), durationMs: 6200 };
  }

  const message = String(input.message ?? '').trim();
  return {
    message,
    type: input.type ?? inferNotificationType(message),
    durationMs: input.durationMs ?? 6200,
  };
};

export const inferNotificationType = (raw: string): NotificationType => {
  const value = raw.toLowerCase();
  if (/موفق|success|انجام شد|ثبت شد|created|saved/.test(value)) return 'success';
  if (/حداکثر|نباید|warning|info|اطلاع|توجه/.test(value)) return 'info';
  return 'error';
};

export const notify = (input: string | NotificationInput) => {
  const normalized = normalizeInput(input);
  if (!normalized.message) return;

  const notification = {
    ...normalized,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  subscribers.forEach((subscriber) => subscriber(notification));
};

export const subscribeNotifications = (subscriber: Subscriber) => {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
};
