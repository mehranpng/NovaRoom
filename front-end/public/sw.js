self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const toPersianNumber = (value) => Number(value).toLocaleString('fa-IR');

const pathFor = (data) =>
    data.kind === 'chess' ? '/chess/game/' + data.gameId : '/chat/' + encodeURIComponent(data.chatId);

const isViewingPath = (windows, path) =>
    windows.some((client) => {
        if (!client.focused || client.visibilityState !== 'visible') return false;
        try {
            return new URL(client.url).pathname === path;
        } catch {
            return false;
        }
    });

async function handlePush(event) {
    const data = event.data ? event.data.json() : null;
    if (!data) return;
    const path = pathFor(data);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (isViewingPath(windows, path)) return;

    const tag =
        data.kind === 'chess' ? 'chess:' + data.gameId : 'chat:' + data.chatId;
    const previous = (await self.registration.getNotifications({ tag }))[0];
    const count = ((previous && previous.data && previous.data.count) || 0) + 1;
    const countText = toPersianNumber(count);

    let title = '';
    let body = '';
    if (data.kind === 'chess') {
        title = 'شطرنج';
        body = `${data.senderName} به بازی شما پیوست`;
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
        badge: '/logo/icon-192.png',
        dir: 'rtl',
        lang: 'fa',
        silent: data.silent || hasTab,
        data: { url: data.url, count },
    });

    if (!data.silent && hasTab) {
        windows.forEach((client) => client.postMessage({ type: 'nr-push-shown' }));
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
