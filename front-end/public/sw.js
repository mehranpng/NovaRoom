self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const toPersianNumber = (value) => Number(value).toLocaleString('fa-IR');

const activeChatByClient = new Map();

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'nr-active-chat' && event.source && event.source.id) {
        if (event.data.chatId) {
            activeChatByClient.set(event.source.id, String(event.data.chatId));
        } else {
            activeChatByClient.delete(event.source.id);
        }
    }
});

const pathFor = (data) => {
    if (data.kind === 'chess') return '/chess/game/' + data.gameId;
    if (data.chatId === 'official-channel') return '/official-channel';
    return '/chat/' + encodeURIComponent(data.chatId);
};

const isViewingTarget = (windows, data, path) =>
    windows.some((client) => {
        if (client.visibilityState !== 'visible') return false;
        if (data.kind !== 'chess' && data.chatId && activeChatByClient.get(client.id) === String(data.chatId)) {
            return true;
        }
        try {
            const pathname = new URL(client.url).pathname;
            if (pathname === path) return true;
            if (data.kind !== 'chess' && data.chatId) {
                return decodeURIComponent(pathname) === '/chat/' + String(data.chatId);
            }
            return false;
        } catch {
            return false;
        }
    });

async function handlePush(event) {
    const data = event.data ? event.data.json() : null;
    if (!data) return;
    const path = pathFor(data);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (isViewingTarget(windows, data, path)) return;

    const tag =
        data.kind === 'chess' ? 'chess:' + data.gameId : 'chat:' + data.chatId;
    const previous = (await self.registration.getNotifications({ tag }))[0];
    const count = ((previous && previous.data && previous.data.count) || 0) + 1;
    const countText = toPersianNumber(count);

    let title = '';
    let body = '';
    if (data.kind === 'chess') {
        title = 'شطرنج';
        if (data.event === 'timer_warning') {
            const secText = toPersianNumber(data.remainingSeconds || 10);
            body =
                data.reason === 'double_disconnect'
                    ? `اتصال قطع شده است! تا ${secText} ثانیه دیگر به بازی برگردید`
                    : `نوبت شماست! اگر تا ${secText} ثانیه دیگر برنگردید بازی را واگذار می‌کنید`;
        } else {
            body = `${data.senderName} به بازی شما پیوست`;
        }
    } else if (data.chatType === 'group') {
        title = data.chatTitle;
        body = data.mentioned
            ? `${data.senderName} شما را منشن کرد یا به شما پاسخ داد`
            : count === 1
              ? `یک پیام جدید از ${data.senderName}`
              : `${countText} پیام جدید در گروه`;
    } else if (data.chatType === 'official') {
        title = 'کانال رسمی';
        body = count === 1 ? 'یک پیام جدید' : `${countText} پیام جدید`;
    } else {
        title = data.senderName;
        body = count === 1 ? 'یک پیام جدید' : `${countText} پیام جدید`;
    }

    const hasTab = windows.length > 0;
    await self.registration.showNotification(title, {
        body,
        tag,
        renotify: true,
        icon: data.icon,
        badge: '/logo/badge.png',
        dir: 'rtl',
        lang: 'fa',
        silent: data.silent || hasTab,
        data: { url: data.url, count },
    });

    if (!data.silent && hasTab) {
        windows.forEach((client) => client.postMessage({ type: 'nr-push-shown', chatId: data.chatId || null }));
    }
}

self.addEventListener('push', (event) => {
    event.waitUntil(handlePush(event));
});

self.addEventListener('notificationclick', (event) => {
    event.waitUntil(
        (async () => {
            event.notification.close();
            const url =
                (event.notification.data && event.notification.data.url) || '/';
            const windows = await self.clients.matchAll({
                type: 'window',
                includeUncontrolled: true,
            });
            const target = windows.find((client) => {
                try {
                    return new URL(client.url).origin === self.location.origin;
                } catch {
                    return false;
                }
            });
            if (target) {
                await target.focus();
                target.postMessage({ type: 'nr-open-url', url });
                return;
            }
            await self.clients.openWindow(url);
        })()
    );
});
