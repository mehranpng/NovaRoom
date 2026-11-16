self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const toPersianNumber = (value) => Number(value).toLocaleString('fa-IR');

const formatRemaining = (sec) => {
    const total = Math.max(1, Math.round(Number(sec) || 10));
    if (total < 60) return `${toPersianNumber(total)} ثانیه`;
    const mins = Math.floor(total / 60);
    const rem = total % 60;
    return rem === 0
        ? `${toPersianNumber(mins)} دقیقه`
        : `${toPersianNumber(mins)} دقیقه و ${toPersianNumber(rem)} ثانیه`;
};

const activeChatByClient = new Map();
const SW_CONFIG_CACHE = 'nr-sw-meta';
const SW_API_BASE_KEY = '/__nr_api_base__';
let configuredApiBase = null;

async function saveApiBase(apiBase) {
    if (typeof apiBase !== 'string' || !apiBase.trim()) return;
    configuredApiBase = apiBase.trim().replace(/\/+$/, '');
    try {
        const cache = await caches.open(SW_CONFIG_CACHE);
        await cache.put(SW_API_BASE_KEY, new Response(configuredApiBase));
    } catch {
        void 0;
    }
}

async function getApiBase() {
    if (configuredApiBase) return configuredApiBase;
    try {
        const cache = await caches.open(SW_CONFIG_CACHE);
        const res = await cache.match(SW_API_BASE_KEY);
        if (res) {
            const text = (await res.text()).trim().replace(/\/+$/, '');
            if (text) {
                configuredApiBase = text;
                return text;
            }
        }
    } catch {
        void 0;
    }
    return '/api';
}

async function verifyChessPush(data) {
    if (!data || data.kind !== 'chess' || !data.gameId) return true;
    try {
        const apiBase = await getApiBase();
        const params = new URLSearchParams();
        if (data.event) params.set('event', String(data.event));
        if (data.warnKey) params.set('warnKey', String(data.warnKey));
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 4500) : null;
        try {
            const res = await fetch(
                `${apiBase}/chess/games/${encodeURIComponent(String(data.gameId))}/push-status?${params.toString()}`,
                { cache: 'no-store', signal: controller ? controller.signal : undefined }
            );
            if (res.status === 404 || res.status === 410) return false;
            if (res.ok) {
                const json = await res.json();
                if (json && json.valid === false) return false;
            }
            return true;
        } finally {
            if (timer) clearTimeout(timer);
        }
    } catch {
        if (data.expiresAt && Date.now() > Number(data.expiresAt)) return false;
        return true;
    }
}

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'nr-config' && typeof event.data.apiBase === 'string') {
        event.waitUntil(saveApiBase(event.data.apiBase));
        return;
    }
    if (event.data && event.data.type === 'nr-active-chat' && event.source && event.source.id) {
        if (event.data.chatId) {
            activeChatByClient.set(event.source.id, String(event.data.chatId));
        } else {
            activeChatByClient.delete(event.source.id);
        }
    }
});

const pathFor = (data) => {
    if (data.kind === 'chess') {
        if (data.event === 'matchmaking_searching') return '/chess';
        return '/chess/game/' + data.gameId;
    }
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
            if (data.kind === 'chess' && data.event === 'matchmaking_searching') {
                return pathname.startsWith('/chess/game/');
            }
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

    if (data.kind === 'chess') {
        const stillValid = await verifyChessPush(data);
        if (!stillValid) {
            if (data.event === 'matchmaking_searching' && data.gameId) {
                const existing = await self.registration.getNotifications({ tag: 'chess:online-search' });
                existing.forEach((n) => {
                    if (n.data && n.data.gameId === data.gameId) n.close();
                });
            }
            return;
        }
    }

    const tag =
        data.kind === 'chess'
            ? data.event === 'matchmaking_searching'
                ? 'chess:online-search'
                : 'chess:' + data.gameId
            : 'chat:' + data.chatId;
    const previous = (await self.registration.getNotifications({ tag }))[0];
    const count = ((previous && previous.data && previous.data.count) || 0) + 1;
    const countText = toPersianNumber(count);

    let title = '';
    let body = '';
    if (data.kind === 'chess') {
        if (data.event === 'matchmaking_searching') {
            title = 'شطرنج آنلاین';
            body = `${data.senderName} آماده رقابت در شطرنج آنلاین است • برای شروع ضربه بزنید`;
        } else if (data.event === 'matchmaking_matched') {
            title = 'شطرنج آنلاین';
            body = `حریف پیدا شد! بازی شما با ${data.senderName} آغاز شد`;
        } else if (data.event === 'timer_warning') {
            title = 'شطرنج';
            const remText = formatRemaining(data.remainingSeconds);
            body =
                data.reason === 'double_disconnect'
                    ? `اتصال قطع شده است! تا ${remText} دیگر به بازی برگردید`
                    : `نوبت شماست! اگر تا ${remText} دیگر برنگردید بازی را واگذار می‌کنید`;
        } else {
            title = 'شطرنج';
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
    const isSilent = Boolean(data.silent);
    await self.registration.showNotification(title, {
        body,
        tag,
        renotify: !isSilent,
        icon: data.icon,
        badge: '/logo/badge.png',
        dir: 'rtl',
        lang: 'fa',
        silent: isSilent || hasTab,
        data: { url: data.url, count, gameId: data.gameId || null },
    });

    if (!isSilent && hasTab) {
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
