import { Search, MessageCirclePlus, Menu, User as UserIcon, LogOut, Bookmark, Settings as SettingsIcon, AlignJustify, Trash2, RefreshCw, Pin, PinOff, MessageSquarePlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Chat, User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { cx } from '../utils/cx';
import { EmptyState } from './EmptyState';
import { ChatListSkeleton } from './ChatListSkeleton';
import { useDarkMode } from '../hooks/useDarkMode';
import { API_BASE_URL } from '../config/api';

interface ChatListProps {
    chats: Chat[];
    currentUser: User;
    activeChatId: string | null;
    wsConnected: boolean;
    wsReconnectExhausted: boolean;
    onSelectChat: (chatId: string) => void;
    onOpenProfile: () => void;
    onNewChatClick: () => void;
    onLogout: () => void;
    onOpenAIChat: () => void;
    onOpenSavedMessages: () => void;
    onOpenSettings: () => void;
    onReconnectNow: () => void;
    onDragHoverChat?: (chatId: string) => void;
    loading?: boolean;
}

type IconProps = {
    size?: number;
    className?: string;
    style?: CSSProperties;
    title?: string;
};

function FilledGroupIcon({ size = 16, className, style, title }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={className}
            style={style}
            aria-hidden={title ? undefined : true}
            role={title ? 'img' : 'presentation'}
        >
            {title ? <title>{title}</title> : null}
            <path
                fill="currentColor"
                d="M7.6 11.2c1.8 0 3.3-1.5 3.3-3.3S9.4 4.6 7.6 4.6 4.3 6.1 4.3 7.9s1.5 3.3 3.3 3.3Zm8.8 0c1.7 0 3.1-1.4 3.1-3.1S18.1 5 16.4 5s-3.1 1.4-3.1 3.1 1.4 3.1 3.1 3.1Zm-8.8 1.2c-2.9 0-5.3 2.3-5.3 5.2v1c0 .5.4.9.9.9h9.4c.5 0 .9-.4.9-.9v-1c0-2.9-2.4-5.2-5.9-5.2Zm9.1.3c-.7 0-1.4.1-2 .3 1.4 1.1 2.3 2.7 2.4 4.6h4.9c.5 0 .9-.4.9-.9v-.6c0-2-1.7-3.4-4.2-3.4Z"
            />
        </svg>
    );
}

function FilledMegaphoneIcon({ size = 14, className, style, title }: IconProps) {
    return (
        <span className={className} style={{ display: 'inline-flex', ...style }} title={title}>
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M3 10.5c0-.83.67-1.5 1.5-1.5H7l7.8-4.68A1 1 0 0 1 16.3 5v14a1 1 0 0 1-1.5.86L7 15H4.5A1.5 1.5 0 0 1 3 13.5v-3Z" fill="currentColor" />
                <path d="M9 15.5 10.8 20a1 1 0 0 1-1.86.74L7.1 16" fill="currentColor" opacity=".9" />
                <path d="M18.8 8.2a1 1 0 0 1 1.4 0 5 5 0 0 1 0 7.07 1 1 0 1 1-1.4-1.42 3 3 0 0 0 0-4.23 1 1 0 0 1 0-1.42Z" fill="currentColor" />
            </svg>
        </span>
    );
}

function FilledBotIcon({ size = 14, className, style, title }: IconProps) {
    return (
        <span className={className} style={{ display: 'inline-flex', ...style }} title={title}>
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="4" y="7" width="16" height="12" rx="5" fill="currentColor" />
                <rect x="10.8" y="3" width="2.4" height="4" rx="1.2" fill="currentColor" />
                <circle cx="9.2" cy="12.6" r="1.4" fill="white" />
                <circle cx="14.8" cy="12.6" r="1.4" fill="white" />
                <rect x="8.5" y="15.3" width="7" height="1.6" rx=".8" fill="white" />
            </svg>
        </span>
    );
}

const TEHRAN_TZ = 'Asia/Tehran';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const toPersianDigits = (value: string | number): string => String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);

function normalizeTs(ts: any): number {
    if (ts == null) return Date.now();
    if (typeof ts === 'string') {
        const n = Date.parse(ts);
        return Number.isFinite(n) ? n : Date.now();
    }
    if (typeof ts === 'number') {
        return ts < 1_000_000_000_000 ? ts * 1000 : ts;
    }
    if (ts instanceof Date) return ts.getTime();
    return Date.now();
}

const tehranTimeFmt = new Intl.DateTimeFormat('fa-IR', {
    timeZone: TEHRAN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

const tehranYmdFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const tehranWeekdayFmt = new Intl.DateTimeFormat('fa-IR', {
    timeZone: TEHRAN_TZ,
    weekday: 'long',
});

const tehranJalaliFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
const tehranJalaliDayMonthFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: TEHRAN_TZ,
    day: 'numeric',
    month: 'long',
});
const tehranJalaliYearFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
});

function tehranYMD(ts: any): string {
    return tehranYmdFmt.format(new Date(normalizeTs(ts)));
}

function tehranMidnightEpoch(ts: any): number {
    const ymd = tehranYMD(ts);
    // Iran has fixed UTC+03:30 offset.
    return new Date(`${ymd}T00:00:00+03:30`).getTime();
}

function formatTime(timestamp: any): string {
    const normalizedTimestamp = normalizeTs(timestamp);
    const now = Date.now();
    const today = tehranMidnightEpoch(now);
    const thatDay = tehranMidnightEpoch(normalizedTimestamp);
    const diffMs = today - thatDay;
    const diffDays = Math.round(diffMs / 86400000);

    const d = new Date(normalizedTimestamp);

    // Same day
    if (diffDays === 0) {
        return tehranTimeFmt.format(d);
    }
    // Yesterday
    if (diffDays === 1) {
        return 'دیروز';
    }
    // Two days ago up to six days: weekday in Persian
    if (diffDays >= 2 && diffDays <= 6) {
        return tehranWeekdayFmt.format(d);
    }
    const currentYear = tehranJalaliYearFmt.format(new Date(now));
    const messageYear = tehranJalaliYearFmt.format(d);
    if (currentYear === messageYear) {
        return tehranJalaliDayMonthFmt.format(d);
    }
    return tehranJalaliFmt.format(d);
}

function getFilePreviewLabel(file: any): string {
    const mimeType = String(file?.mimeType || file?.type || '').toLowerCase();
    const fileType = String(file?.fileType || file?.kind || file?.mediaType || file?.messageType || '').toLowerCase();
    const fileName = String(file?.fileName || file?.name || '').toLowerCase();
    const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';

    if (mimeType.startsWith('image/') || fileType.includes('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return '🖼️ تصویر';
    if (mimeType.startsWith('video/') || fileType.includes('video') || ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'].includes(ext)) return '🎥 ویدیو';
    if (mimeType.startsWith('audio/') || fileType.includes('audio') || fileType.includes('voice') || ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(ext)) return '🎵 صوت';
    return '📎 فایل';
}

function extractLastMessageFile(lastMessage: any): any {
    if (!lastMessage) return null;
    const detectedFile = (
        lastMessage?.file ||
        lastMessage?.attachment ||
        lastMessage?.media ||
        lastMessage?.document ||
        lastMessage?.message?.file ||
        lastMessage?.message?.attachment ||
        lastMessage?.message?.media ||
        lastMessage?.payload?.file ||
        lastMessage?.payload?.attachment ||
        lastMessage?.payload?.media ||
        null
    );
    if (detectedFile) return detectedFile;

    const rootFileId = String(
        lastMessage?.fileId
        || lastMessage?.file_id
        || lastMessage?.mediaId
        || lastMessage?.media_id
        || lastMessage?.attachmentId
        || ''
    ).trim();
    const rootMime = String(lastMessage?.mimeType || lastMessage?.mime_type || '').trim();
    const rootFileName = String(lastMessage?.fileName || lastMessage?.file_name || lastMessage?.name || '').trim();
    const rootType = String(lastMessage?.messageType || lastMessage?.message_type || lastMessage?.fileType || lastMessage?.file_type || lastMessage?.mediaType || '').trim();
    if (rootFileId || rootMime || rootFileName || rootType) {
        return {
            fileId: rootFileId,
            mimeType: rootMime,
            fileName: rootFileName,
            fileType: rootType,
            messageType: rootType,
        };
    }
    return null;
}

function extractLastMessageText(lastMessage: any): string {
    if (!lastMessage) return '';
    return String(
        lastMessage?.caption
        || lastMessage?.text
        || lastMessage?.message?.caption
        || lastMessage?.message?.text
        || lastMessage?.payload?.caption
        || lastMessage?.payload?.text
        || lastMessage?.message_caption
        || lastMessage?.fileCaption
        || lastMessage?.file_caption
        || ''
    ).trim();
}

function getLastMessagePreview(lastMessage: any, fallback: string): string {
    if (!lastMessage) return fallback;
    const text = extractLastMessageText(lastMessage)
        .replace(/\[(file|image|video|audio)\]/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const file = extractLastMessageFile(lastMessage);
    if (file) {
        const prefix = getFilePreviewLabel(file);
        return text ? `${prefix} • ${text}` : prefix;
    }
    const messageType = String(
        lastMessage?.messageType
        || lastMessage?.message_type
        || lastMessage?.type
        || lastMessage?.payload?.type
        || lastMessage?.payload?.messageType
        || ''
    ).toLowerCase();
    if (messageType.includes('image')) return text ? `🖼️ تصویر • ${text}` : '🖼️ تصویر';
    if (messageType.includes('video')) return text ? `🎥 ویدیو • ${text}` : '🎥 ویدیو';
    if (messageType.includes('audio') || messageType.includes('voice')) return text ? `🎵 صوت • ${text}` : '🎵 صوت';
    if (messageType.includes('file') || messageType.includes('document') || messageType.includes('attachment')) return text ? `📎 فایل • ${text}` : '📎 فایل';

    const normalizedText = text.toLowerCase();
    if (['[file]', 'file', 'attachment'].includes(normalizedText)) return '📎 فایل';
    if (['[image]', 'image', 'photo'].includes(normalizedText)) return '🖼️ تصویر';
    if (['[video]', 'video'].includes(normalizedText)) return '🎥 ویدیو';
    if (['[audio]', 'audio', 'voice'].includes(normalizedText)) return '🎵 صوت';
    return text || fallback;
}

function getGroupStats(chat: Chat): { totalMembers: number; onlineMembers: number } | null {
    const anyChat = chat as any;
    const totalMembers = Number(
        anyChat?.totalMembers
        ?? anyChat?.membersCount
        ?? anyChat?.memberCount
        ?? anyChat?.group?.totalMembers
        ?? anyChat?.group?.membersCount
        ?? 0
    );
    const onlineMembers = Number(
        anyChat?.onlineMembers
        ?? anyChat?.onlineCount
        ?? anyChat?.group?.onlineMembers
        ?? anyChat?.group?.onlineCount
        ?? 0
    );
    if (!Number.isFinite(totalMembers) || totalMembers <= 0) return null;
    return {
        totalMembers,
        onlineMembers: Number.isFinite(onlineMembers) ? Math.max(0, onlineMembers) : 0,
    };
}

function useIsMobile(breakpointPx = 768) {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;

        const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
        const onChange = () => setIsMobile(mq.matches);

        onChange();

        // Safari < 14
        // eslint-disable-next-line deprecation/deprecation
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        // eslint-disable-next-line deprecation/deprecation
        else mq.addListener(onChange);

        return () => {
            // eslint-disable-next-line deprecation/deprecation
            if (mq.removeEventListener) mq.removeEventListener('change', onChange);
            // eslint-disable-next-line deprecation/deprecation
            else mq.removeListener(onChange);
        };
    }, [breakpointPx]);

    return isMobile;
}

const PINNED_STORAGE_KEY_PREFIX = 'pinnedChats:';

function getPinnedKey(userId: string) {
    return `${PINNED_STORAGE_KEY_PREFIX}${userId}`;
}

function safeJsonParse<T>(value: string | null): T | null {
    if (!value) return null;
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

function resolveVerified(val: any): boolean {
    if (val === null || val === undefined) return false;
    if (val === false || val === 0 || val === 'false' || val === '0') return false;
    return true;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers || {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });

    if (!res.ok) {
        let detail = 'Request failed';
        try {
            const j = await res.json();
            detail = j?.detail || detail;
        } catch {
            // ignore
        }
        throw new Error(detail);
    }

    return (await res.json()) as T;
}

type ConfirmAction = null | { kind: 'delete_chat' | 'delete_group' | 'leave_group' | 'logout'; chatId: string };

export function ChatList({
    chats,
    currentUser,
    activeChatId,
    wsConnected,
    wsReconnectExhausted,
    onSelectChat,
    onOpenProfile,
    onNewChatClick,
    onLogout,
    onOpenAIChat,
    onOpenSavedMessages,
    onOpenSettings,
    onReconnectNow,
    onDragHoverChat,
    loading = false,
}: ChatListProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    useDarkMode();

    const isMobile = useIsMobile(768);

    // Keep a local copy so we can remove deleted/left chats immediately.
    const [localChats, setLocalChats] = useState<Chat[]>(chats);
    useEffect(() => {
        setLocalChats((prev) => {
            const prevById = new Map(prev.map((c) => [c.id, c]));
            return chats.map((chat) => {
                const prevChat = prevById.get(chat.id);
                if (!prevChat) return chat;

                const incomingUnread = Number(chat.unreadCount || 0);
                const previousUnread = Number(prevChat.unreadCount || 0);
                const isActive = Boolean(activeChatId) && chat.id === activeChatId;
                const sameLastMessageId = Boolean(
                    prevChat.lastMessage?.id &&
                    chat.lastMessage?.id &&
                    prevChat.lastMessage.id === chat.lastMessage.id
                );

                // Guard against intermittent stale unread=0 payloads that can make
                // another chat's unread badge disappear until full refresh.
                const shouldKeepPreviousUnread = !isActive && sameLastMessageId && incomingUnread === 0 && previousUnread > 0;

                return {
                    ...chat,
                    unreadCount: shouldKeepPreviousUnread ? previousUnread : incomingUnread,
                };
            });
        });
    }, [chats, activeChatId]);

    const isVerifiedUser = resolveVerified((currentUser as any)?.verified);

    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const pinnedIdsRef = useRef<string[]>([]);

    const [chatActionMenu, setChatActionMenu] = useState<null | { chatId: string; top: number; left: number }>(null);
    const chatItemsRef = useRef<HTMLDivElement | null>(null);
    const chatActionMenuRef = useRef<HTMLDivElement | null>(null);
    const chatActionBtnRef = useRef<HTMLElement | null>(null);
    const dragHoverTimerRef = useRef<number | null>(null);
    const dragHoverTargetRef = useRef<string | null>(null);
    const [dragHoverChatId, setDragHoverChatId] = useState<string | null>(null);

    const [pinBusy, setPinBusy] = useState<Record<string, boolean>>({});
    const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});

    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
    const confirmOverlayRef = useRef<HTMLDivElement | null>(null);

    const isFileDragEvent = (e: ReactDragEvent) => {
        const types = e.dataTransfer?.types;
        if (!types) return false;
        return Array.from(types).includes('Files');
    };

    const queueDragHoverOpenChat = (chatId: string) => {
        if (!onDragHoverChat) return;
        if (dragHoverTargetRef.current === chatId) return;
        dragHoverTargetRef.current = chatId;
        setDragHoverChatId(chatId);
        if (dragHoverTimerRef.current) window.clearTimeout(dragHoverTimerRef.current);
        dragHoverTimerRef.current = window.setTimeout(() => {
            onDragHoverChat(chatId);
            dragHoverTimerRef.current = null;
        }, 140);
    };

    useEffect(() => () => {
        if (dragHoverTimerRef.current) window.clearTimeout(dragHoverTimerRef.current);
        dragHoverTargetRef.current = null;
    }, []);

    const clearDragHoverState = () => {
        if (dragHoverTimerRef.current) {
            window.clearTimeout(dragHoverTimerRef.current);
            dragHoverTimerRef.current = null;
        }
        dragHoverTargetRef.current = null;
        setDragHoverChatId(null);
    };

    useEffect(() => {
        clearDragHoverState();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeChatId]);

    useEffect(() => {
        const onGlobalDragFinish = () => clearDragHoverState();
        window.addEventListener('drop', onGlobalDragFinish);
        window.addEventListener('dragend', onGlobalDragFinish);
        return () => {
            window.removeEventListener('drop', onGlobalDragFinish);
            window.removeEventListener('dragend', onGlobalDragFinish);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const confirmMeta = useMemo(() => {
        if (!confirmAction) return null;
        if (confirmAction.kind === 'leave_group') {
            return {
                title: 'خروج از گروه؟',
                text: 'آیا می‌خواهید از گروه خارج شوید؟ گروه برای شما حذف خواهد شد.',
                confirmLabel: 'خروج',
            };
        }
        if (confirmAction.kind === 'delete_group') {
            return {
                title: 'گروه حذف شود؟',
                text: 'گروه و تمام پیام‌ها برای همه حذف خواهد شد.',
                confirmLabel: 'حذف',
            };
        }
        if (confirmAction.kind === 'logout') {
            return {
                title: 'خروج از حساب؟',
                text: 'آیا می‌خواهید از حساب کاربری خارج شوید؟',
                confirmLabel: 'خروج',
            };
        }
        return {
            title: 'گفتگو حذف شود؟',
            text: 'این عمل گفتگو و تمام پیام‌ها را برای هر دو کاربر حذف خواهد کرد.',
            confirmLabel: 'حذف',
        };
    }, [confirmAction]);

    useEffect(() => {
        pinnedIdsRef.current = pinnedIds;
    }, [pinnedIds]);

    // Load pinned from localStorage quickly, then try syncing from backend.
    useEffect(() => {
        const key = getPinnedKey(currentUser.chatId);
        const stored = safeJsonParse<{ ids: string[] }>(localStorage.getItem(key));
        if (stored?.ids?.length) {
            setPinnedIds(stored.ids.slice(0, 20));
        }

        apiFetch<{ pinnedChatIds: string[] }>('/profile/me/pins')
            .then((r) => {
                const ids = (r?.pinnedChatIds || []).slice(0, 20);
                setPinnedIds(ids);
                localStorage.setItem(key, JSON.stringify({ ids }));
            })
            .catch(() => {
                // ignore network/auth errors and rely on local state
            });
    }, [currentUser.chatId]);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (!menuRef.current) return;
            if (menuRef.current.contains(e.target as Node)) return;
            setMenuOpen(false);
        };
        if (menuOpen) {
            document.addEventListener('mousedown', onDocClick);
        }
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [menuOpen]);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (chatActionMenuRef.current?.contains(target)) return;
            if (chatActionBtnRef.current?.contains(target)) return;
            setChatActionMenu(null);
        };

        if (chatActionMenu) {
            document.addEventListener('mousedown', onDocClick);
        }
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [chatActionMenu]);

    useEffect(() => {
        if (!confirmAction) return;

        const onDocMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            const modal = confirmOverlayRef.current?.querySelector('.chat-room-confirm-modal');
            if (modal && !modal.contains(target)) {
                setConfirmAction(null);
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setConfirmAction(null);
        };

        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [confirmAction]);

    const getContact = (chat: Chat): User => {
        if (chat.otherUser) {
            return {
                ...chat.otherUser,
                chatId: chat.participantIds.find(id => id !== currentUser.chatId) || '',
                // Make sure online is always boolean so Avatar renders the status dot.
                online: typeof chat.otherUser.online === 'boolean' ? chat.otherUser.online : false,
                verified: Boolean((chat.otherUser as any)?.verified),
            };
        }

        const contactId = chat.participantIds.find((id) => id !== currentUser.chatId) || 'Unknown';
        return {
            chatId: contactId,
            name: contactId,
            username: contactId.toLowerCase(),
            bio: '',
            avatar: '',
            online: false,
            verified: false,
        };
    };

    const savedMessagesId = `saved_messages_${currentUser.chatId}`;

    const isPinned = (chatId: string) => pinnedIds.includes(chatId);

    const persistPinned = (ids: string[]) => {
        const key = getPinnedKey(currentUser.chatId);
        localStorage.setItem(key, JSON.stringify({ ids }));
    };

    const removePinnedIfNeeded = (chatId: string) => {
        const prev = pinnedIdsRef.current;
        if (!prev.includes(chatId)) return;
        const next = prev.filter((id) => id !== chatId);
        setPinnedIds(next);
        persistPinned(next);
    };

    const removeChatLocally = (chatId: string) => {
        setLocalChats((prev) => prev.filter((c) => c.id !== chatId));
        removePinnedIfNeeded(chatId);
    };

    const togglePin = async (chatId: string) => {
        if (pinBusy[chatId]) return;

        const prev = pinnedIdsRef.current;
        const currentlyPinned = prev.includes(chatId);

        if (!currentlyPinned && prev.length >= 20) {
            alert('حداکثر ۲۰ گفتگو را می‌توانید سنجاق کنید');
            return;
        }

        setPinBusy((m) => ({ ...m, [chatId]: true }));

        // optimistic update
        const next = currentlyPinned ? prev.filter((id) => id !== chatId) : [chatId, ...prev];
        setPinnedIds(next);
        persistPinned(next);

        try {
            const url = `/profile/me/pins/${encodeURIComponent(chatId)}`;
            const r = currentlyPinned
                ? await apiFetch<{ pinnedChatIds: string[] }>(url, { method: 'DELETE' })
                : await apiFetch<{ pinnedChatIds: string[] }>(url, { method: 'POST' });

            const ids = (r?.pinnedChatIds || []).slice(0, 20);
            setPinnedIds(ids);
            persistPinned(ids);
        } catch (e: any) {
            // rollback by refetch
            apiFetch<{ pinnedChatIds: string[] }>('/profile/me/pins')
                .then((r) => {
                    const ids = (r?.pinnedChatIds || []).slice(0, 20);
                    setPinnedIds(ids);
                    persistPinned(ids);
                })
                .catch(() => {
                    // if we can't refetch, keep optimistic state
                });
            alert(e?.message || 'خطا در تغییر وضعیت سنجاق');
        } finally {
            setPinBusy((m) => ({ ...m, [chatId]: false }));
        }
    };

    const requestDeleteChat = (chatId: string, isGroup: boolean) => {
        setConfirmAction({ kind: isGroup ? 'delete_group' : 'delete_chat', chatId });
    };

    const requestLeaveGroup = (chatId: string) => {
        setConfirmAction({ kind: 'leave_group', chatId });
    };

    const requestLogout = () => {
        setConfirmAction({ kind: 'logout', chatId: '__logout__' });
    };

    const runConfirmAction = async () => {
        if (!confirmAction) return;
        const { kind, chatId } = confirmAction;
        if (actionBusy[chatId]) return;

        setActionBusy((m) => ({ ...m, [chatId]: true }));
        try {
            if (kind === 'logout') {
                onLogout();
            } else if (kind === 'leave_group') {
                await apiFetch(`/groups/${encodeURIComponent(chatId)}/leave`, { method: 'POST' });
                removeChatLocally(chatId);
            } else {
                await apiFetch(`/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
                removeChatLocally(chatId);
            }
            setConfirmAction(null);
        } catch {
            if (kind === 'leave_group') alert('خروج از گروه با خطا مواجه شد');
            else if (kind === 'delete_group') alert('حذف گروه با خطا مواجه شد');
            else if (kind === 'logout') alert('خروج از حساب با خطا مواجه شد');
            else alert('حذف گفتگو با خطا مواجه شد');
        } finally {
            setActionBusy((m) => ({ ...m, [chatId]: false }));
        }
    };

    const openActionMenu = (chatId: string, btnEl: HTMLElement, menuItemCount: number) => {
        const r = btnEl.getBoundingClientRect();
        const menuWidth = 190;
        const menuHeight = (menuItemCount * 40) + 14;
        const padding = 8;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        const preferredTop = r.bottom + 6;
        const preferredBottomTop = r.top - menuHeight - 6;
        const top = preferredTop + menuHeight <= viewportHeight - padding
            ? preferredTop
            : Math.max(padding, preferredBottomTop);

        const preferredLeft = r.right - menuWidth;
        const left = Math.max(padding, Math.min(preferredLeft, viewportWidth - menuWidth - padding));

        setChatActionMenu((prev) => (prev?.chatId === chatId ? null : { chatId, top, left }));
    };

    useEffect(() => {
        if (!chatActionMenu) return;

        const closeMenu = () => setChatActionMenu(null);
        const listEl = chatItemsRef.current;

        window.addEventListener('resize', closeMenu);
        window.addEventListener('scroll', closeMenu, true);
        listEl?.addEventListener('scroll', closeMenu);

        return () => {
            window.removeEventListener('resize', closeMenu);
            window.removeEventListener('scroll', closeMenu, true);
            listEl?.removeEventListener('scroll', closeMenu);
        };
    }, [chatActionMenu]);

    const isGroupChat = (chat: Chat) => {
        const anyChat = chat as any;
        return Boolean(
            anyChat?.chatType === 'group' ||
            anyChat?.id?.startsWith?.('grp_') ||
            (anyChat?.otherUser && Boolean((anyChat.otherUser as any)?.isGroup))
        );
    };

    // Sort all chats by last message timestamp, but keep pinned at top.
    // Within pinned: order by latest lastMessage as well.
    const sortedChats = [...localChats].sort((a, b) => {
        const aPinned = isPinned(a.id) ? 1 : 0;
        const bPinned = isPinned(b.id) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;

        const aTime = a.lastMessage ? normalizeTs(a.lastMessage.timestamp) : 0;
        const bTime = b.lastMessage ? normalizeTs(b.lastMessage.timestamp) : 0;
        return bTime - aTime;
    });

    // Apply search filter
    const filteredChats = sortedChats.filter((chat) => {
        // Don't filter if no search query
        if (!searchQuery) return true;

        // Check if it's saved messages
        if (chat.id === savedMessagesId) {
            return (
                'پیام‌های ذخیره شده'.includes(searchQuery) ||
                'saved'.includes(searchQuery.toLowerCase()) ||
                'ذخیره'.includes(searchQuery)
            );
        }

        // Search in regular chats
        const contact = getContact(chat);
        return (
            contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            contact.username.toLowerCase().includes(searchQuery.toLowerCase())
        );
    });

    const hasActiveChat = Boolean(activeChatId);

    // Check if we should show AI chat in search results
    const showAIChat = !searchQuery || 'NovaRoom AI'.includes(searchQuery.toLowerCase()) || 'دستیار'.includes(searchQuery);

    const confirmBusy = confirmAction ? Boolean(actionBusy[confirmAction.chatId]) : false;
    const actionMenuChat = chatActionMenu
        ? localChats.find((chat) => chat.id === chatActionMenu.chatId) || null
        : null;
    const actionMenuPinned = actionMenuChat ? isPinned(actionMenuChat.id) : false;
    const actionMenuSaved = actionMenuChat ? actionMenuChat.id === savedMessagesId : false;
    const actionMenuGroup = actionMenuChat ? isGroupChat(actionMenuChat) : false;

    return (
        <div className="chat-list" style={{ position: 'relative' }}>
            {/* Header */}
            <div className="chat-list__header">
                <div className="chat-list__header-left">
                    <button onClick={onOpenProfile}>
                        <Avatar name={currentUser.name} size="sm" src={currentUser.avatar} />
                    </button>
                    <div className="chat-list__title-wrap">
                        <h1 className="chat-list__title">
                            {wsConnected ? 'NovaRoom' : (wsReconnectExhausted ? 'Disconnected' : 'Connecting...')}
                        </h1>
                        {!wsConnected && wsReconnectExhausted && (
                            <button
                                type="button"
                                className="chat-list__reconnect-btn"
                                onClick={() => {
                                    onReconnectNow();
                                }}
                            >
                                <RefreshCw size={16} />
                            </button>
                        )}
                    </div>
                </div>
                <div className="chat-list__header-actions">
                    <button className="icon-btn" onClick={onNewChatClick}>
                        <MessageCirclePlus size={20} />
                    </button>

                    <div className="chat-list__menu" ref={menuRef}>
                        <button
                            className="icon-btn"
                            onClick={() => setMenuOpen(v => !v)}
                            aria-label="Menu"
                            type="button"
                        >
                            <Menu size={20} />
                        </button>

                        {menuOpen && (
                            <div className="popover popover--mini popover--right">
                                <button className="popover__item" onClick={() => { setMenuOpen(false); onOpenProfile(); }} type="button">
                                    <UserIcon size={16} />
                                    پروفایل
                                </button>
                                <button className="popover__item" onClick={() => { setMenuOpen(false); onOpenSavedMessages(); }} type="button">
                                    <Bookmark size={16} />
                                    پیام‌های ذخیره شده
                                </button>
                                <button className="popover__item" onClick={() => { setMenuOpen(false); onOpenSettings(); }} type="button">
                                    <SettingsIcon size={16} />
                                    تنظیمات
                                </button>
                                <button className="popover__item popover__item--danger" onClick={() => { setMenuOpen(false); requestLogout(); }} type="button">
                                    <LogOut size={16} />
                                    خروج
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="chat-list__search">
                <div className="chat-list__search-wrapper">
                    <span className="chat-list__search-icon">
                        <Search size={16} />
                    </span>
                    <input
                        type="text"
                        placeholder="جستجوی گفتگو..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="chat-list__search-input"
                    />
                </div>
            </div>

            {/* Chat List */}
            <div
                className="chat-list__items"
                ref={chatItemsRef}
                style={{ position: 'relative' }}
                onDrop={clearDragHoverState}
                onDragEnd={clearDragHoverState}
            >
                {/* AI Chat - Always pinned at top */}
                {showAIChat && (
                    <button
                        onClick={onOpenAIChat}
                        className="chat-list__item chat-list__item--ai"
                    >
                        <img
                            src="/avatars/ai.png"
                            alt="NovaRoom AI"
                            style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '50%',
                                objectFit: 'cover',
                                flexShrink: 0,
                            }}
                        />
                        <div className="chat-list__item-content">
                            <div className="chat-list__item-row">
                                <span
                                    className="chat-list__item-name"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                >
                                    <FilledBotIcon size={14} style={{ opacity: 0.95 }} />
                                    Nova AI
                                    <VerifiedBadge size={14} />
                                </span>
                            </div>
                            <div className="chat-list__item-preview">
                                <p className="chat-list__item-text">
                                    دستیار هوشمند شما
                                </p>
                            </div>
                        </div>
                    </button>
                )}

                {/* All chats - sorted by pinned then timestamp */}
                {loading ? (
                    <ChatListSkeleton />
                ) : localChats.length === 0 ? (
                    isMobile && !hasActiveChat ? <EmptyState /> : null
                ) : filteredChats.length === 0 ? (
                    <div className="chat-list__empty">
                        <MessageSquarePlus size={48} strokeWidth={1} />
                        <p>گفتگویی یافت نشد</p>
                    </div>
                ) : (
                    filteredChats.map((chat) => {
                        const isActive = activeChatId === chat.id;
                        const isSaved = chat.id === savedMessagesId;
                        const pinned = isPinned(chat.id);
                        const group = !isSaved && isGroupChat(chat);
                        const isOfficial = chat.id === 'official-channel';

                        if (isSaved) {
                            return (
                                <button
                                    key={chat.id}
                                    onClick={() => onSelectChat(chat.id)}
                                    onDragEnter={(e) => {
                                        if (!isFileDragEvent(e)) return;
                                        queueDragHoverOpenChat(chat.id);
                                    }}
                                    onDragOver={(e) => {
                                        if (!isFileDragEvent(e)) return;
                                        e.preventDefault();
                                        queueDragHoverOpenChat(chat.id);
                                    }}
                                    className={cx('chat-list__item', isActive && 'chat-list__item--active', dragHoverChatId === chat.id && 'chat-list__item--drag-hover')}
                                >
                                    <Avatar name="" size="md" savedMessages={true} />
                                    <div className="chat-list__item-content">
                                        <div className="chat-list__item-row">
                                            <span
                                                className="chat-list__item-name"
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                            >
                                                پیام‌های ذخیره شده
                                                {pinned ? (
                                                    <Pin
                                                        size={14}
                                                        className="chat-list__pin-icon"
                                                        aria-label="سنجاق شده"
                                                        style={{ opacity: 0.95, fill: 'currentColor' }}
                                                    />
                                                ) : null}
                                            </span>
                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                                {chat.lastMessage && (
                                                    <span className="chat-list__item-time">
                                                        {toPersianDigits(formatTime(chat.lastMessage.timestamp))}
                                                    </span>
                                                )}
                                                <button
                                                    className="icon-btn icon-btn--xs"
                                                    type="button"
                                                    aria-label="Saved messages actions"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        chatActionBtnRef.current = e.currentTarget;
                                                        openActionMenu(chat.id, e.currentTarget, 1);
                                                    }}
                                                >
                                                    <AlignJustify size={16} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="chat-list__item-preview">
                                            <p className="chat-list__item-text">
                                                {getLastMessagePreview(chat.lastMessage, 'پیام‌های ذخیره شده شما')}
                                            </p>
                                            {chat.unreadCount > 0 && (
                                                <span className="chat-list__unread-badge">{toPersianDigits(chat.unreadCount)}</span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        }

                        const isMine = chat.lastMessage?.senderId === currentUser.chatId;
                        const contact = getContact(chat);
                        const blockedRelation = Boolean((chat.otherUser as any)?.blockedByMe || (chat.otherUser as any)?.blockedByOther);
                        const unreadCount = typeof chat.unreadCount === 'number' && chat.unreadCount > 0 ? chat.unreadCount : 0;
                        const groupStats = group ? getGroupStats(chat) : null;

                        return (
                            <button
                                key={chat.id}
                                onClick={() => onSelectChat(chat.id)}
                                onDragEnter={(e) => {
                                    if (!isFileDragEvent(e)) return;
                                    queueDragHoverOpenChat(chat.id);
                                }}
                                onDragOver={(e) => {
                                    if (!isFileDragEvent(e)) return;
                                    e.preventDefault();
                                    queueDragHoverOpenChat(chat.id);
                                }}
                                className={cx(
                                    'chat-list__item',
                                    isActive && 'chat-list__item--active',
                                    pinned && 'chat-list__item--pinned',
                                    dragHoverChatId === chat.id && 'chat-list__item--drag-hover'
                                )}
                            >
                                <Avatar
                                    name={contact.name}
                                    size="md"
                                    online={group || blockedRelation ? undefined : contact.online}
                                    src={contact.avatar}
                                />

                                <div className="chat-list__item-content">
                                    <div className="chat-list__item-row">
                                        <span
                                            className="chat-list__item-name"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                        >
                                            {group ? (
                                                chat.id === 'official-channel'
                                                    ? <FilledMegaphoneIcon size={14} title="کانال رسمی" style={{ opacity: 0.95 }} />
                                                    : <FilledGroupIcon size={14} title="گروه" style={{ opacity: 0.9 }} />
                                            ) : null}
                                            {contact.name}
                                            {contact.verified ? <VerifiedBadge size={14} /> : null}
                                            {pinned ? (
                                                <Pin
                                                    size={14}
                                                    className="chat-list__pin-icon"
                                                    aria-label="سنجاق شده"
                                                    style={{ opacity: 0.95, fill: 'currentColor' }}
                                                />
                                            ) : null}
                                        </span>

                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                            {chat.lastMessage && (
                                                <span className="chat-list__item-time">
                                                    {toPersianDigits(formatTime(chat.lastMessage.timestamp))}
                                                </span>
                                            )}

                                            <button
                                                className="icon-btn icon-btn--xs"
                                                type="button"
                                                aria-label="Chat actions"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    chatActionBtnRef.current = e.currentTarget;
                                                    const menuItemCount = group
                                                        ? (isVerifiedUser ? 3 : 2)
                                                        : 2;
                                                    openActionMenu(chat.id, e.currentTarget, menuItemCount);
                                                }}
                                            >
                                                <AlignJustify size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="chat-list__item-preview">
                                        <p className="chat-list__item-text">
                                            {group && groupStats ? (
                                                <span style={{ direction: 'rtl', display: 'inline-flex', alignItems: 'center', gap: 4, marginInlineEnd: 6 }}>
                                                    <span style={{ color: 'var(--accent-soft-text)' }}>{toPersianDigits(groupStats.onlineMembers)} آنلاین</span>
                                                    <span style={{ color: 'var(--text-muted)' }}>•</span>
                                                    <span style={{ color: 'var(--text-secondary)' }}>{toPersianDigits(groupStats.totalMembers)} عضو</span>
                                                    <span style={{ color: 'var(--text-muted)' }}>|</span>
                                                </span>
                                            ) : null}
                                            {isMine && <span className="chat-list__item-text-prefix">شما: </span>}
                                            {getLastMessagePreview(chat.lastMessage, 'هنوز پیامی ارسال نشده')}
                                        </p>
                                        {unreadCount > 0 && (
                                            <span className="chat-list__unread-badge">{toPersianDigits(unreadCount)}</span>
                                        )}
                                    </div>
                                </div>

                            </button>
                        );
                    })
                )}
            </div>

            {chatActionMenu && actionMenuChat && (
                <div
                    ref={chatActionMenuRef}
                    className="popover popover--mini"
                    style={{ top: chatActionMenu.top, left: chatActionMenu.left, right: 'auto', position: 'fixed', zIndex: 120 }}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                >
                    <button
                        className="popover__item"
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setChatActionMenu(null);
                            togglePin(actionMenuChat.id);
                        }}
                        disabled={Boolean(pinBusy[actionMenuChat.id])}
                        style={pinBusy[actionMenuChat.id] ? { opacity: 0.6, cursor: 'default' } : undefined}
                    >
                        {actionMenuPinned ? <PinOff size={16} /> : <Pin size={16} />}
                        {actionMenuPinned ? 'برداشتن سنجاق' : 'سنجاق'}
                    </button>

                    {actionMenuSaved || actionMenuChat?.id === 'official-channel' ? null : actionMenuGroup ? (
                        <>
                            <button
                                className="popover__item popover__item--danger"
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setChatActionMenu(null);
                                    requestLeaveGroup(actionMenuChat.id);
                                }}
                                disabled={Boolean(actionBusy[actionMenuChat.id])}
                                style={actionBusy[actionMenuChat.id] ? { opacity: 0.6, cursor: 'default' } : undefined}
                            >
                                <LogOut size={16} />
                                خروج از گروه
                            </button>

                            {isVerifiedUser && (
                                <button
                                    className="popover__item popover__item--danger"
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setChatActionMenu(null);
                                        requestDeleteChat(actionMenuChat.id, true);
                                    }}
                                    disabled={Boolean(actionBusy[actionMenuChat.id])}
                                    style={actionBusy[actionMenuChat.id] ? { opacity: 0.6, cursor: 'default' } : undefined}
                                >
                                    <Trash2 size={16} />
                                    حذف گروه
                                </button>
                            )}
                        </>
                    ) : (
                        <button
                            className="popover__item popover__item--danger"
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setChatActionMenu(null);
                                requestDeleteChat(actionMenuChat.id, false);
                            }}
                            disabled={Boolean(actionBusy[actionMenuChat.id])}
                            style={actionBusy[actionMenuChat.id] ? { opacity: 0.6, cursor: 'default' } : undefined}
                        >
                            <Trash2 size={16} />
                            حذف گفتگو
                        </button>
                    )}
                </div>
            )}

            {/* Custom confirm modal (same classes as ChatRoom) */}
            <AnimatePresence>
                {confirmAction && confirmMeta && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        ref={confirmOverlayRef}
                        style={{ zIndex: 120 }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                        <motion.div
                            className="chat-room-confirm-modal"
                            onMouseDown={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, y: 14, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h3 className="chat-room-confirm-modal__title">{confirmMeta.title}</h3>
                            <p className="chat-room-confirm-modal__text">{confirmMeta.text}</p>
                            <div className="chat-room-confirm-modal__actions">
                                <button
                                    className="chat-room-confirm-modal__btn"
                                    onClick={() => setConfirmAction(null)}
                                    disabled={confirmBusy}
                                    type="button"
                                >
                                    لغو
                                </button>
                                <button
                                    className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger"
                                    onClick={runConfirmAction}
                                    disabled={confirmBusy}
                                    type="button"
                                >
                                    {confirmMeta.confirmLabel}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
