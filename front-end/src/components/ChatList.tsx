import TelegramIcon from './TelegramIcon';
import { BellOff } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Chat, User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { cx } from '../utils/cx';
import { isElementScrolled } from '../utils/scrollFade';
import { EmptyState } from './EmptyState';
import { ChatListSkeleton } from './ChatListSkeleton';
import { useDarkMode } from '../hooks/useDarkMode';
import { API_BASE_URL } from '../config/api';
import { getChatNotifyMode, setChatNotifyMode, useNotificationPrefs } from '../utils/pushNotifications';
import { useChatDrafts } from '../utils/chatDrafts';
import { dismissPwaBanner, triggerPwaInstall, usePwaInstall } from '../utils/pwaInstall';

interface ChatListProps {
    chats: Chat[];
    currentUser: User;
    activeChatId: string | null;
    wsConnected: boolean;
    wsReconnectExhausted: boolean;
    isUpdating?: boolean;
    interactiveOnlineUsers?: Record<string, number>;
    onSelectChat: (chatId: string) => void;
    onNewChatClick: () => void;
    onLogout: () => void;
    onOpenAIChat: () => void;
    onOpenSavedMessages: () => void;
    onReconnectNow: () => void;
    onDragHoverChat?: (chatId: string) => void;
    loading?: boolean;
    sendingChatIds?: Record<string, boolean>;
    scrollHidden?: boolean;
    onScrollHideChange?: (hidden: boolean) => void;
}

type IconProps = {
    size?: number;
    className?: string;
    style?: CSSProperties;
    title?: string;
};

function FilledMegaphoneIcon({ size = 14, className, style, title }: IconProps) {
    return (
        <span className={className} style={{ display: 'inline-flex', ...style }} title={title}>
            <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
                <path d="M13.258 22.38c.692 0 1.039 0 1.307.125.283.132.511.36.643.643.126.268.125.615.125 1.307v1.486a2.667 2.667 0 0 1-5.333 0v-1.486c0-.692 0-1.039.125-1.307.132-.283.36-.511.643-.643.269-.126.615-.125 1.308-.125zm11.43-18.987a2.67 2.67 0 0 1 2.07 1.011c.575.728.575 2.127.575 4.926v11.887c0 2.799 0 4.198-.575 4.926a2.67 2.67 0 0 1-2.07 1.011c-.927.008-2.032-.852-4.241-2.57l-3.676-2.86c-.35-.271-.525-.408-.708-.521a4 4 0 0 0-1.671-.573c-.215-.024-.437-.023-.88-.023H10a5.334 5.334 0 0 1 0-10.666h3.512c.443 0 .665 0 .88-.024a4 4 0 0 0 1.67-.573c.184-.113.36-.25.709-.522l3.676-2.86c2.209-1.717 3.314-2.577 4.242-2.57" fill="currentColor" />
            </svg>
        </span>
    );
}

function FilledGroupIcon({ size = 14, className, style, title }: IconProps) {
    return (
        <span className={className} style={{ display: 'inline-flex', ...style }} title={title}>
            <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
                <path d="M11.333 18c3.651 0 6.012 1.056 7.447 2.082q.023.016.044.033.168.12.32.24l.073.06q.109.09.209.176.064.055.125.11.138.125.258.243c.635.63.858 1.526.858 2.422 0 1.455-1.18 2.634-2.634 2.634H4.634C3.18 26 2 24.82 2 23.366c0-.896.223-1.791.858-2.422C4.052 19.759 6.618 18 11.333 18M22 19.333c4.037 0 6.236 1.462 7.26 2.45.546.525.74 1.282.74 2.04C30 25.025 29.025 26 27.823 26H22.1c.493-.759.78-1.663.78-2.634 0-1.208-.295-2.784-1.511-3.992l-.028-.026q.321-.015.659-.015m0-10.666c2.21 0 4 1.79 4 4s-1.79 4-4 4-4-1.791-4-4 1.79-4 4-4M11.333 6C13.911 6 16 8.09 16 10.667s-2.09 4.666-4.667 4.666-4.666-2.089-4.666-4.666S8.756 6 11.333 6" fill="currentColor" />
            </svg>
        </span>
    );
}

function ChatListOutgoingStatus({ status }: { status: 'sending' | 'sent' | 'seen' }) {
    if (status === 'sending') {
        return (
            <span className="chat-list__outgoing-status chat-list__outgoing-status--sending" aria-label="در حال ارسال">
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <circle cx="6" cy="6" r="4.75" stroke="currentColor" strokeWidth="1.25" opacity="0.85" />
                    <line x1="6" y1="6" x2="6" y2="3.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" className="message-status-clock-hand" />
                    <line x1="6" y1="6" x2="8" y2="6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                </svg>
            </span>
        );
    }
    if (status === 'sent') {
        return (
            <span className="chat-list__outgoing-status" aria-label="ارسال شده">
                <svg width="14" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
                    <path d="M13.6 2.2L6.2 9.6L2.4 5.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </span>
        );
    }
    return (
        <span className="chat-list__outgoing-status" aria-label="خوانده شده">
            <svg width="17" height="12" viewBox="0 0 19 12" fill="none" aria-hidden="true">
                <path d="M11.8 2.2L4.9 9.4L1.5 6.0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M17.3 2.2L10.4 9.4L8.2 7.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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
    
    return new Date(`${ymd}T00:00:00+03:30`).getTime();
}

const formatTimeCache = new Map<string, string>();

function formatTime(timestamp: any): string {
    const normalizedTimestamp = normalizeTs(timestamp);
    const now = Date.now();
    const cacheKey = `${Math.floor(now / 60000)}:${normalizedTimestamp}`;
    const cached = formatTimeCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const today = tehranMidnightEpoch(now);
    const thatDay = tehranMidnightEpoch(normalizedTimestamp);
    const diffMs = today - thatDay;
    const diffDays = Math.round(diffMs / 86400000);

    const d = new Date(normalizedTimestamp);

    let result: string;
    if (diffDays === 0) {
        result = tehranTimeFmt.format(d);
    } else if (diffDays === 1) {
        result = 'دیروز';
    } else if (diffDays >= 2 && diffDays <= 6) {
        result = tehranWeekdayFmt.format(d);
    } else {
        const currentYear = tehranJalaliYearFmt.format(new Date(now));
        const messageYear = tehranJalaliYearFmt.format(d);
        result = currentYear === messageYear
            ? tehranJalaliDayMonthFmt.format(d)
            : tehranJalaliFmt.format(d);
    }
    if (formatTimeCache.size > 1000) formatTimeCache.clear();
    formatTimeCache.set(cacheKey, result);
    return result;
}

function getFilePreviewLabel(file: any): string {
    const mimeType = String(file?.mimeType || file?.type || '').toLowerCase();
    const fileType = String(file?.fileType || file?.kind || file?.mediaType || file?.messageType || '').toLowerCase();
    const fileName = String(file?.fileName || file?.name || '').toLowerCase();
    const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';

    if (mimeType.startsWith('image/') || fileType.includes('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return '🖼️ تصویر';
    if (mimeType.startsWith('video/') || fileType.includes('video') || ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'].includes(ext)) return '🎥 ویدیو';
    if (mimeType.startsWith('audio/') || fileType.includes('audio') || fileType.includes('voice') || ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(ext)) return '🎵 آهنگ';
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
    if (messageType.includes('audio') || messageType.includes('voice')) return text ? `🎵 آهنگ • ${text}` : '🎵 آهنگ';
    if (messageType.includes('file') || messageType.includes('document') || messageType.includes('attachment')) return text ? `📎 فایل • ${text}` : '📎 فایل';

    const normalizedText = text.toLowerCase();
    if (['[file]', 'file', 'attachment'].includes(normalizedText)) return '📎 فایل';
    if (['[image]', 'image', 'photo'].includes(normalizedText)) return '🖼️ تصویر';
    if (['[video]', 'video'].includes(normalizedText)) return '🎥 ویدیو';
    if (['[audio]', 'audio', 'voice'].includes(normalizedText)) return '🎵 آهنگ';
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

        
        
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        
        else mq.addListener(onChange);

        return () => {
            
            if (mq.removeEventListener) mq.removeEventListener('change', onChange);
            
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
            
        }
        throw new Error(detail);
    }

    return (await res.json()) as T;
}

type ConfirmAction = null | { kind: 'delete_chat' | 'delete_group' | 'leave_group' | 'logout'; chatId: string };

export const ChatList = memo(function ChatList({
    chats,
    currentUser,
    activeChatId,
    wsConnected,
    isUpdating = false,
    interactiveOnlineUsers,
    onSelectChat,
    onNewChatClick,
    onLogout,
    onOpenAIChat: _onOpenAIChat,
    onOpenSavedMessages,
    onDragHoverChat,
    loading = false,
    sendingChatIds,
    scrollHidden,
    onScrollHideChange,
}: ChatListProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const notifyPrefs = useNotificationPrefs();
    const chatDrafts = useChatDrafts();
    useDarkMode();

    const isMobile = useIsMobile(768);

    const [localChats, setLocalChats] = useState<Chat[]>(chats);
    useEffect(() => {
        setLocalChats(chats);
    }, [chats]);

    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const pinnedIdsRef = useRef<string[]>([]);

    const [chatActionMenu, setChatActionMenu] = useState<null | { chatId: string; top: number; left: number }>(null);
    const [actionMenuSubmenu, setActionMenuSubmenu] = useState<null | 'notifications'>(null);
    const chatItemsRef = useRef<HTMLDivElement | null>(null);
    const chatActionMenuRef = useRef<HTMLDivElement | null>(null);
    const chatActionBtnRef = useRef<HTMLElement | null>(null);
    const menuOpenedAtRef = useRef(0);
    const menuClosedAtRef = useRef(0);
    const [menuPressSuppressed, setMenuPressSuppressed] = useState(false);
    const lastTouchAtRef = useRef(0);
    const longPressTimerRef = useRef<number | null>(null);
    const isLongPressTriggeredRef = useRef(false);
    const dragHoverTimerRef = useRef<number | null>(null);
    const dragHoverTargetRef = useRef<string | null>(null);
    const [dragHoverChatId, setDragHoverChatId] = useState<string | null>(null);

    const [listScrolled, setListScrolled] = useState(false);
    const [fabHidden, setFabHidden] = useState(false);
    const lastScrollTopRef = useRef(0);
    const fabHiddenRef = useRef(false);
    const effectiveFabHidden = scrollHidden !== undefined ? scrollHidden : fabHidden;

    useEffect(() => {
        if (scrollHidden !== undefined) {
            fabHiddenRef.current = scrollHidden;
            setFabHidden(scrollHidden);
        }
    }, [scrollHidden]);
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
        
    }, [activeChatId]);

    useEffect(() => {
        const onGlobalDragFinish = () => clearDragHoverState();
        window.addEventListener('drop', onGlobalDragFinish);
        window.addEventListener('dragend', onGlobalDragFinish);
        return () => {
            window.removeEventListener('drop', onGlobalDragFinish);
            window.removeEventListener('dragend', onGlobalDragFinish);
        };
        
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

    
    useEffect(() => {
        const key = getPinnedKey(currentUser.chatId);
        const stored = safeJsonParse<{ ids: string[] }>(localStorage.getItem(key));
        if (stored?.ids?.length) {
            setPinnedIds(stored.ids.slice(0, 5));
        }

        apiFetch<{ pinnedChatIds: string[] }>('/profile/me/pins')
            .then((r) => {
                const ids = (r?.pinnedChatIds || []).slice(0, 5);
                setPinnedIds(ids);
                localStorage.setItem(key, JSON.stringify({ ids }));
            })
            .catch(() => {
                
            });
    }, [currentUser.chatId]);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (Date.now() - menuOpenedAtRef.current < 250) return;
            const target = e.target as Node;
            if (chatActionMenuRef.current?.contains(target)) return;
            if (chatActionBtnRef.current?.contains(target)) return;
            if ((target as Element)?.closest?.('.chat-list__menu-backdrop')) return;
            setChatActionMenu(null);
        };

        let timerId: number | null = null;
        if (chatActionMenu) {
            timerId = window.setTimeout(() => {
                document.addEventListener('mousedown', onDocClick);
            }, 50);
        }
        return () => {
            if (timerId) window.clearTimeout(timerId);
            document.removeEventListener('mousedown', onDocClick);
        };
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

        if (!currentlyPinned && prev.length >= 5) {
            alert('حداکثر ۵ گفتگو را می‌توانید سنجاق کنید');
            return;
        }

        setPinBusy((m) => ({ ...m, [chatId]: true }));

        
        const next = currentlyPinned ? prev.filter((id) => id !== chatId) : [chatId, ...prev];
        setPinnedIds(next);
        persistPinned(next);

        try {
            const url = `/profile/me/pins/${encodeURIComponent(chatId)}`;
            const r = currentlyPinned
                ? await apiFetch<{ pinnedChatIds: string[] }>(url, { method: 'DELETE' })
                : await apiFetch<{ pinnedChatIds: string[] }>(url, { method: 'POST' });

            const ids = (r?.pinnedChatIds || []).slice(0, 5);
            setPinnedIds(ids);
            persistPinned(ids);
        } catch (e: any) {
            
            apiFetch<{ pinnedChatIds: string[] }>('/profile/me/pins')
                .then((r) => {
                    const ids = (r?.pinnedChatIds || []).slice(0, 5);
                    setPinnedIds(ids);
                    persistPinned(ids);
                })
                .catch(() => {
                    
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

    const openActionMenu = (chatId: string, btnEl: HTMLElement, menuItemCount: number, allowToggle = true) => {
        chatActionBtnRef.current = btnEl;
        setActionMenuSubmenu(null);
        menuOpenedAtRef.current = Date.now();
        const r = btnEl.getBoundingClientRect();
        const menuWidth = 190;
        const menuHeight = (menuItemCount * 40) + 14;
        const padding = 8;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        const preferredTop = r.bottom + 4;
        const preferredBottomTop = r.top - menuHeight - 4;
        const top = preferredTop + menuHeight <= viewportHeight - padding
            ? preferredTop
            : Math.max(padding, preferredBottomTop);

        const preferredLeft = r.right - menuWidth;
        const left = Math.max(padding, Math.min(preferredLeft, viewportWidth - menuWidth - padding));

        setChatActionMenu((prev) => {
            if (prev?.chatId === chatId) {
                return allowToggle && !isLongPressTriggeredRef.current ? null : prev;
            }
            return { chatId, top, left };
        });
    };

    const startLongPress = (chatId: string, el: HTMLElement, menuItemCount: number) => {
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
        isLongPressTriggeredRef.current = false;
        longPressTimerRef.current = window.setTimeout(() => {
            isLongPressTriggeredRef.current = true;
            window.setTimeout(() => {
                isLongPressTriggeredRef.current = false;
            }, 800);
            try {
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    navigator.vibrate(12);
                }
            } catch {
            }
            openActionMenu(chatId, el, menuItemCount, false);
        }, 500);
    };

    const cancelLongPress = () => {
        if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    useEffect(() => {
        if (!menuPressSuppressed) return;
        const release = () => setMenuPressSuppressed(false);
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
        window.addEventListener('touchend', release);
        window.addEventListener('mouseup', release);
        return () => {
            window.removeEventListener('pointerup', release);
            window.removeEventListener('pointercancel', release);
            window.removeEventListener('touchend', release);
            window.removeEventListener('mouseup', release);
        };
    }, [menuPressSuppressed]);

    useEffect(() => {
        if (!chatActionMenu) setActionMenuSubmenu(null);
    }, [chatActionMenu]);

    useEffect(() => {
        if (!chatActionMenu) return;

        const closeMenu = () => {
            if (Date.now() - menuOpenedAtRef.current < 350) return;
            setChatActionMenu(null);
        };
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

    
    
    const sortedChats = useMemo(() => {
        return [...localChats].sort((a, b) => {
            const aPinned = pinnedIds.includes(a.id) ? 1 : 0;
            const bPinned = pinnedIds.includes(b.id) ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;

            const aTime = a.lastMessage ? normalizeTs(a.lastMessage.timestamp) : 0;
            const bTime = b.lastMessage ? normalizeTs(b.lastMessage.timestamp) : 0;
            return bTime - aTime;
        });
    }, [localChats, pinnedIds]);

    const filteredChats = useMemo(() => {
        if (!searchQuery) return sortedChats;
        const lowerQuery = searchQuery.toLowerCase();
        return sortedChats.filter((chat) => {
            if (chat.id === savedMessagesId) {
                return (
                    'پیام‌های ذخیره شده'.includes(searchQuery) ||
                    'saved'.includes(lowerQuery) ||
                    'ذخیره'.includes(searchQuery)
                );
            }

            const contact = getContact(chat);
            return (
                contact.name.toLowerCase().includes(lowerQuery) ||
                contact.username.toLowerCase().includes(lowerQuery)
            );
        });
    }, [sortedChats, searchQuery, savedMessagesId, currentUser.chatId]);

    const hasActiveChat = Boolean(activeChatId);

    const confirmBusy = confirmAction ? Boolean(actionBusy[confirmAction.chatId]) : false;
    const actionMenuChat = chatActionMenu
        ? localChats.find((chat) => chat.id === chatActionMenu.chatId) || null
        : null;
    const actionMenuPinned = actionMenuChat ? isPinned(actionMenuChat.id) : false;
    const actionMenuSaved = actionMenuChat ? actionMenuChat.id === savedMessagesId : false;
    const actionMenuGroup = actionMenuChat ? isGroupChat(actionMenuChat) : false;
    const actionMenuOfficial = actionMenuChat?.id === 'official-channel';
    const actionMenuGroupNotifications = actionMenuGroup && !actionMenuOfficial;
    const actionMenuMode = actionMenuChat ? getChatNotifyMode(notifyPrefs, actionMenuChat.id) : 'all';
    const pwa = usePwaInstall();
    const showInstallBanner = pwa.isMobileWeb && !pwa.bannerDismissed;

    return (
        <div className={cx('chat-list', chatActionMenu && 'chat-list--menu-open', menuPressSuppressed && 'chat-list--press-suppressed')} style={{ position: 'relative' }}>
            <div className={cx('header-fade', 'header-fade--list', listScrolled && 'header-fade--visible')} aria-hidden="true" />
            <div className="chat-list__header">
                <div className="chat-list__header-row">
                    <div className={cx('chat-list__header-left', searchOpen && 'chat-list__header-left--hidden')}>
                        <div className="chat-list__title-wrap">
                            <span className="chat-list__brand-logo" aria-hidden="true" />
                            <h1 className="chat-list__title">
                                {isUpdating ? 'Updating...' : (wsConnected ? 'NovaRoom' : 'Connecting...')}
                            </h1>
                        </div>
                    </div>

                    <div className={cx('chat-list__inline-search', searchOpen && 'chat-list__inline-search--open')}>
                        <span className="chat-list__search-icon">
                            <TelegramIcon name="search" size={16} />
                        </span>
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="جستجوی گفتگو..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onBlur={() => {
                                setSearchOpen(false);
                                setSearchQuery('');
                            }}
                            className="chat-list__search-input"
                        />
                        <button
                            type="button"
                            className="chat-list__search-clear"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                setSearchQuery('');
                                setSearchOpen(false);
                                searchInputRef.current?.blur();
                            }}
                            aria-label="Close search"
                        >
                            <TelegramIcon name="close" size={16} />
                        </button>
                    </div>

                    <div className="chat-list__header-actions">
                        {!searchOpen && (
                            <button
                                className="icon-btn"
                                onClick={() => {
                                    setSearchOpen(true);
                                    window.setTimeout(() => {
                                        searchInputRef.current?.focus();
                                    }, 20);
                                }}
                                aria-label="Search"
                                type="button"
                            >
                                <TelegramIcon name="search" size={20} />
                            </button>
                        )}

                        <button
                            className="icon-btn"
                            onClick={onOpenSavedMessages}
                            aria-label="پیام‌های ذخیره شده"
                            type="button"
                        >
                            <TelegramIcon name="saved-messages" size={20} />
                        </button>
                    </div>
                </div>
            </div>

            <div
                className="chat-list__items"
                ref={chatItemsRef}
                onScroll={(event) => {
                    const el = event.currentTarget;
                    setListScrolled(isElementScrolled(el));
                    const st = el.scrollTop;
                    const delta = st - lastScrollTopRef.current;
                    let nextHidden = fabHiddenRef.current;
                    if (st <= 16) {
                        nextHidden = false;
                        lastScrollTopRef.current = st;
                    } else if (delta > 8) {
                        nextHidden = true;
                        lastScrollTopRef.current = st;
                    } else if (delta < -8) {
                        nextHidden = false;
                        lastScrollTopRef.current = st;
                    }
                    if (nextHidden !== fabHiddenRef.current) {
                        fabHiddenRef.current = nextHidden;
                        setFabHidden(nextHidden);
                        onScrollHideChange?.(nextHidden);
                    }
                }}
                style={{ position: 'relative' }}
                onDrop={clearDragHoverState}
                onDragEnd={clearDragHoverState}
            >
                {loading ? (
                    <ChatListSkeleton />
                ) : localChats.length === 0 ? (
                    isMobile && !hasActiveChat ? <EmptyState /> : null
                ) : filteredChats.length === 0 ? (
                    <div className="chat-list__empty">
                        <TelegramIcon name="message" size={48} />
                        <p>گفتگویی یافت نشد</p>
                    </div>
                ) : (
                    filteredChats.map((chat) => {
                        const isActive = activeChatId === chat.id;
                        const isSaved = chat.id === savedMessagesId;
                        const pinned = isPinned(chat.id);
                        const group = !isSaved && isGroupChat(chat);
                        const isOfficial = chat.id === 'official-channel';
                        const notifyMode = getChatNotifyMode(notifyPrefs, chat.id);

                        if (isSaved) {
                            const draftText = chat.id === activeChatId ? '' : (chatDrafts[chat.id]?.text || '').replace(/\s+/g, ' ').trim();
                            const savedUnread = Math.max(0, Number(chat.unreadCount || 0));
                            return (
                                <button
                                    key={chat.id}
                                    onClick={() => {
                                        if (isLongPressTriggeredRef.current) {
                                            isLongPressTriggeredRef.current = false;
                                            return;
                                        }
                                        if (chatActionMenu) {
                                            menuClosedAtRef.current = Date.now();
                                            setChatActionMenu(null);
                                            return;
                                        }
                                        if (Date.now() - menuClosedAtRef.current < 400) return;
                                        onSelectChat(chat.id);
                                    }}
                                    onMouseDown={(e) => {
                                        if (chatActionMenu) {
                                            setMenuPressSuppressed(true);
                                            return;
                                        }
                                        if (Date.now() - lastTouchAtRef.current < 800) return;
                                        startLongPress(chat.id, e.currentTarget, 1);
                                    }}
                                    onMouseUp={cancelLongPress}
                                    onMouseLeave={cancelLongPress}
                                    onTouchStart={(e) => {
                                        if (chatActionMenu) {
                                            setMenuPressSuppressed(true);
                                            return;
                                        }
                                        lastTouchAtRef.current = Date.now();
                                        startLongPress(chat.id, e.currentTarget, 1);
                                    }}
                                    style={{ touchAction: 'manipulation' }}
                                    onTouchEnd={cancelLongPress}
                                    onTouchMove={cancelLongPress}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        cancelLongPress();
                                        openActionMenu(chat.id, e.currentTarget, 1, !isLongPressTriggeredRef.current);
                                    }}
                                    onDragEnter={(e) => {
                                        if (!isFileDragEvent(e)) return;
                                        queueDragHoverOpenChat(chat.id);
                                    }}
                                    onDragOver={(e) => {
                                        if (!isFileDragEvent(e)) return;
                                        e.preventDefault();
                                        queueDragHoverOpenChat(chat.id);
                                    }}
                                    className={cx('chat-list__item', isActive && 'chat-list__item--active', pinned && 'chat-list__item--pinned', chatActionMenu?.chatId === chat.id && 'chat-list__item--menu-open', dragHoverChatId === chat.id && 'chat-list__item--drag-hover')}
                                >
                                    <Avatar name="" size="md-lg" savedMessages={true} />
                                    <div className="chat-list__item-content">
                                        <div className="chat-list__item-row">
                                            <span className="chat-list__item-name-group">
                                                <span className="chat-list__item-name">پیام‌های ذخیره شده</span>
                                                {pinned ? (
                                                    <span className="chat-list__pin-badge" role="img" aria-label="سنجاق شده">
                                                        <TelegramIcon name="pin-filled" size={14} className="chat-list__pin-icon" />
                                                    </span>
                                                ) : null}
                                            </span>
                                            <div className="chat-list__item-meta">
                                                {chat.lastMessage && (
                                                    <span className="chat-list__item-time">
                                                        {toPersianDigits(formatTime(chat.lastMessage.timestamp))}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="chat-list__item-preview">
                                            <p className="chat-list__item-text">
                                                {draftText ? (
                                                    <>
                                                        <span className="chat-list__item-draft-prefix">پیش‌نویس: </span>
                                                        <span className="chat-list__item-draft-text">{draftText}</span>
                                                    </>
                                                ) : (
                                                    getLastMessagePreview(chat.lastMessage, 'پیام‌های ذخیره شده شما')
                                                )}
                                            </p>
                                            {savedUnread > 0 && (
                                                <div className="chat-list__badges">
                                                    <span className="chat-list__unread-badge">{toPersianDigits(savedUnread)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        }

                        const isMine = chat.lastMessage?.senderId === currentUser.chatId;
                        const draftText = chat.id === activeChatId ? '' : (chatDrafts[chat.id]?.text || '').replace(/\s+/g, ' ').trim();
                        const contact = getContact(chat);
                        const blockedRelation = Boolean((chat.otherUser as any)?.blockedByMe || (chat.otherUser as any)?.blockedByOther);
                        const unreadCount = Math.max(0, Number(chat.unreadCount || 0));
                        const unreadMentionCount = (!isOfficial && !isSaved && group) ? (chat.unreadMentionIds?.length || 0) : 0;
                        const unreadReactionCount = (!isOfficial && !isSaved) ? (chat.unreadReactionIds?.length || 0) : 0;
                        const groupStats = group ? getGroupStats(chat) : null;
                        const canManageGroup = Boolean(currentUser.adminLevel) || (group && chat.otherUser?.createdBy === currentUser.chatId);
                        const menuItemCount = group
                            ? (canManageGroup ? 4 : 3)
                            : (isOfficial ? 2 : 3);

                        return (
                            <button
                                key={chat.id}
                                onClick={() => {
                                    if (isLongPressTriggeredRef.current) {
                                        isLongPressTriggeredRef.current = false;
                                        return;
                                    }
                                    if (chatActionMenu) {
                                        menuClosedAtRef.current = Date.now();
                                        setChatActionMenu(null);
                                        return;
                                    }
                                    if (Date.now() - menuClosedAtRef.current < 400) return;
                                    onSelectChat(chat.id);
                                }}
                                onMouseDown={(e) => {
                                    if (chatActionMenu) {
                                        setMenuPressSuppressed(true);
                                        return;
                                    }
                                    if (Date.now() - lastTouchAtRef.current < 800) return;
                                    startLongPress(chat.id, e.currentTarget, menuItemCount);
                                }}
                                onMouseUp={cancelLongPress}
                                onMouseLeave={cancelLongPress}
                                onTouchStart={(e) => {
                                    if (chatActionMenu) {
                                        setMenuPressSuppressed(true);
                                        return;
                                    }
                                    lastTouchAtRef.current = Date.now();
                                    startLongPress(chat.id, e.currentTarget, menuItemCount);
                                }}
                                style={{ touchAction: 'manipulation' }}
                                onTouchEnd={cancelLongPress}
                                onTouchMove={cancelLongPress}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    cancelLongPress();
                                    openActionMenu(chat.id, e.currentTarget, menuItemCount, !isLongPressTriggeredRef.current);
                                }}
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
                                    chatActionMenu?.chatId === chat.id && 'chat-list__item--menu-open',
                                    dragHoverChatId === chat.id && 'chat-list__item--drag-hover'
                                )}
                            >
                                <Avatar
                                    name={contact.name}
                                    size="md-lg"
                                    userId={group ? undefined : contact.chatId}
                                    isChessChampion={group ? false : contact.isChessChampion}
                                    online={group || blockedRelation ? undefined : Boolean((interactiveOnlineUsers && contact.chatId && interactiveOnlineUsers[contact.chatId]) || contact.online)}
                                    src={isOfficial ? '/logo/ch.png' : contact.avatar}
                                />

                                <div className="chat-list__item-content">
                                    <div className="chat-list__item-row">
                                        <span className="chat-list__item-name-group">
                                            {group ? (
                                                chat.id === 'official-channel'
                                                    ? <FilledMegaphoneIcon size={15} title="کانال رسمی" className="chat-list__type-icon" />
                                                    : <FilledGroupIcon size={15} title="گروه" className="chat-list__type-icon" />
                                            ) : null}
                                            <span className="chat-list__item-name">{contact.name}</span>
                                            {contact.verified ? <VerifiedBadge size={14} /> : null}
                                            {pinned ? (
                                                <span className="chat-list__pin-badge" role="img" aria-label="سنجاق شده">
                                                    <TelegramIcon name="pin-filled" size={14} className="chat-list__pin-icon" />
                                                </span>
                                            ) : null}
                                            {notifyMode === 'muted' ? (
                                                <BellOff size={14} className="chat-list__mute-icon" aria-label="بی‌صدا" />
                                            ) : notifyMode === 'mentions' ? (
                                                <span role="img" aria-label="فقط منشن و پاسخ" className="chat-list__mute-icon-wrap">
                                                    <TelegramIcon name="mention" size={14} className="chat-list__mute-icon" />
                                                </span>
                                            ) : null}
                                        </span>

                                        <div className="chat-list__item-meta">
                                            {chat.lastMessage && (isMine || sendingChatIds?.[chat.id]) && !draftText && (
                                                <ChatListOutgoingStatus
                                                    status={
                                                        sendingChatIds?.[chat.id] || chat.lastMessage.deliveryStatus === 'sending'
                                                            ? 'sending'
                                                            : chat.lastMessage.seen
                                                                ? 'seen'
                                                                : 'sent'
                                                    }
                                                />
                                            )}
                                            {chat.lastMessage && (
                                                <span className="chat-list__item-time">
                                                    {toPersianDigits(formatTime(chat.lastMessage.timestamp))}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="chat-list__item-preview">
                                        <p className="chat-list__item-text">
                                            {draftText ? (
                                                <>
                                                    <span className="chat-list__item-draft-prefix">پیش‌نویس: </span>
                                                    <span className="chat-list__item-draft-text">{draftText}</span>
                                                </>
                                            ) : (
                                                <>
                                                    {group && groupStats ? (
                                                        <span className="chat-list__group-stats">
                                                            <span className="chat-list__group-online">{toPersianDigits(groupStats.onlineMembers)} آنلاین</span>
                                                            <span className="chat-list__group-sep">•</span>
                                                            <span className="chat-list__group-total">{toPersianDigits(groupStats.totalMembers)} عضو</span>
                                                            <span className="chat-list__group-sep">|</span>
                                                        </span>
                                                    ) : null}
                                                    {isMine && <span className="chat-list__item-text-prefix">شما: </span>}
                                                    {getLastMessagePreview(chat.lastMessage, 'هنوز پیامی ارسال نشده')}
                                                </>
                                            )}
                                        </p>
                                        {(unreadReactionCount > 0 || unreadMentionCount > 0 || unreadCount > 0) && (
                                            <div className="chat-list__badges">
                                                {unreadReactionCount > 0 && (
                                                    <span className="chat-list__reaction-badge" aria-label="واکنش جدید">
                                                        <TelegramIcon name="heart" size={14} />
                                                    </span>
                                                )}
                                                {unreadMentionCount > 0 && (
                                                    <span className="chat-list__mention-badge" aria-label="منشن یا پاسخ جدید">
                                                        <TelegramIcon name="mention" size={14} />
                                                    </span>
                                                )}
                                                {unreadCount > 0 && (
                                                    <span className={cx('chat-list__unread-badge', notifyMode === 'muted' && 'chat-list__unread-badge--muted')}>{toPersianDigits(unreadCount)}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                            </button>
                        );
                    })
                )}
            </div>

            <button
                type="button"
                className={cx('chat-list__fab', showInstallBanner && 'chat-list__fab--above-banner', effectiveFabHidden && 'chat-list__fab--hidden')}
                onClick={onNewChatClick}
                aria-label="گفتگوی جدید"
            >
                <TelegramIcon name="new-chat-filled" size={24} />
            </button>

            <AnimatePresence>
                {showInstallBanner && (
                    <motion.div
                        className="pwa-install-banner"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        <button
                            type="button"
                            className="pwa-install-banner__main"
                            onClick={() => void triggerPwaInstall()}
                        >
                            <span className="pwa-install-banner__icon" aria-hidden="true">
                                <img src="/logo/icon-192.png" alt="" />
                            </span>
                            <span className="pwa-install-banner__text">
                                برای تجربه بهتر، اپلیکیشن را نصب کنید
                            </span>
                        </button>
                        <button
                            type="button"
                            className="pwa-install-banner__close"
                            onClick={(e) => {
                                e.stopPropagation();
                                dismissPwaBanner();
                            }}
                            aria-label="بستن پیشنهاد نصب"
                        >
                            <TelegramIcon name="close" size={16} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {chatActionMenu && actionMenuChat && (
                <div
                    className="chat-list__menu-backdrop"
                    aria-hidden="true"
                    onPointerDown={(e) => {
                        e.preventDefault();
                        menuClosedAtRef.current = Date.now();
                        setChatActionMenu(null);
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        if (Date.now() - menuOpenedAtRef.current < 450) return;
                        menuClosedAtRef.current = Date.now();
                        setChatActionMenu(null);
                    }}
                />
            )}
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
                    {actionMenuSubmenu === 'notifications' && actionMenuGroupNotifications ? (
                        <>
                            <button
                                type="button"
                                className="popover__item"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setActionMenuSubmenu(null);
                                }}
                                style={{ direction: 'rtl', justifyContent: 'flex-end', gap: 6, padding: '4px 10px 8px', fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}
                            >
                                <span>اعلان‌ها</span>
                                <TelegramIcon name="previous" size={16} />
                            </button>
                            <button
                                className="popover__item"
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setChatActionMenu(null);
                                    void setChatNotifyMode(actionMenuChat.id, 'all');
                                }}
                            >
                                <TelegramIcon name="unmute" size={16} />
                                همه پیام‌ها
                                {actionMenuMode === 'all' && <TelegramIcon name="check" size={16} style={{ marginInlineStart: 'auto' }} />}
                            </button>
                            <button
                                className="popover__item"
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setChatActionMenu(null);
                                    void setChatNotifyMode(actionMenuChat.id, 'mentions');
                                }}
                            >
                                <TelegramIcon name="mention" size={16} />
                                فقط منشن و پاسخ
                                {actionMenuMode === 'mentions' && <TelegramIcon name="check" size={16} style={{ marginInlineStart: 'auto' }} />}
                            </button>
                            <button
                                className="popover__item"
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setChatActionMenu(null);
                                    void setChatNotifyMode(actionMenuChat.id, 'muted');
                                }}
                            >
                                <TelegramIcon name="mute" size={16} />
                                بی‌صدا
                                {actionMenuMode === 'muted' && <TelegramIcon name="check" size={16} style={{ marginInlineStart: 'auto' }} />}
                            </button>
                        </>
                    ) : (
                        <>
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
                                {actionMenuPinned ? <TelegramIcon name="unpin" size={16} /> : <TelegramIcon name="pin" size={16} />}
                                {actionMenuPinned ? 'برداشتن سنجاق' : 'سنجاق'}
                            </button>

                            {actionMenuSaved ? null : actionMenuGroupNotifications ? (
                                <button
                                    className="popover__item"
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setActionMenuSubmenu('notifications');
                                    }}
                                >
                                    <TelegramIcon name="unmute" size={16} />
                                    اعلان‌ها
                                    <TelegramIcon name="next" size={16} style={{ marginInlineStart: 'auto', opacity: 0.5 }} />
                                </button>
                            ) : (
                                <button
                                    className="popover__item"
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setChatActionMenu(null);
                                        void setChatNotifyMode(actionMenuChat.id, actionMenuMode === 'all' ? 'muted' : 'all');
                                    }}
                                >
                                    {actionMenuMode === 'all' ? <TelegramIcon name="mute" size={16} /> : <TelegramIcon name="unmute" size={16} />}
                                    {actionMenuMode === 'all' ? 'بی‌صدا کردن' : 'باصدا کردن'}
                                </button>
                            )}

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
                                        <TelegramIcon name="logout" size={16} />
                                        خروج از گروه
                                    </button>

                                    {(Boolean(currentUser.adminLevel) || actionMenuChat?.otherUser?.createdBy === currentUser.chatId) && (
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
                                            <TelegramIcon name="delete" size={16} />
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
                                    <TelegramIcon name="delete" size={16} />
                                    حذف گفتگو
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            {}
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
});
