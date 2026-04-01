import { Search, MessageSquarePlus, Menu, User as UserIcon, LogOut, Bookmark, Moon, Sun, MoreVertical, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Chat, User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { cx } from '../utils/cx';
import { EmptyState } from './EmptyState';
import { ChatListSkeleton } from './ChatListSkeleton';
import { useDarkMode } from '../hooks/useDarkMode';

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
    onReconnectNow: () => void;
    loading?: boolean;
}

type IconProps = {
    size?: number;
    className?: string;
    style?: CSSProperties;
    title?: string;
};

const PIN_ROTATE_DEG = 45;

const STREAMLINE_SHARP_PIN_D = 'm23 9 -8 -8 -3 5 -9.00005 4 4.7929 4.7929 -6.5 6.5 1.41421 1.4142 6.5 -6.5L14 21l4 -9 5 -3Z';

function PinFilledSharpIcon({ size = 16, className, style, title }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={className}
            style={{ transform: `rotate(${PIN_ROTATE_DEG}deg)`, ...style }}
            aria-hidden={title ? undefined : true}
            role={title ? 'img' : 'presentation'}
        >
            {title ? <title>{title}</title> : null}
            <path
                d={STREAMLINE_SHARP_PIN_D}
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
            />
        </svg>
    );
}

function PinOutlineSharpIcon({ size = 16, className, style, title }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={className}
            style={{ transform: `rotate(${PIN_ROTATE_DEG}deg)`, ...style }}
            aria-hidden={title ? undefined : true}
            role={title ? 'img' : 'presentation'}
        >
            {title ? <title>{title}</title> : null}
            <path
                d={STREAMLINE_SHARP_PIN_D}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="miter"
                strokeLinecap="square"
            />
        </svg>
    );
}

function UnpinFilledSharpIcon({ size = 16, className, style, title }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={className}
            style={{ transform: `rotate(${PIN_ROTATE_DEG}deg)`, ...style }}
            aria-hidden={title ? undefined : true}
            role={title ? 'img' : 'presentation'}
        >
            {title ? <title>{title}</title> : null}
            <path
                d={STREAMLINE_SHARP_PIN_D}
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
            />
            <path
                d="M5 19 19 5"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
            />
        </svg>
    );
}

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

const TEHRAN_TZ = 'Asia/Tehran';

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

const tehranTimeFmt = new Intl.DateTimeFormat('en-GB', {
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

const tehranWeekdayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TEHRAN_TZ,
    weekday: 'short',
});

const tehranMonthDayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TEHRAN_TZ,
    month: 'short',
    day: 'numeric',
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
    // Within a week
    if (diffDays > 1 && diffDays < 7) {
        return tehranWeekdayFmt.format(d);
    }
    // Older
    return tehranMonthDayFmt.format(d);
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
    const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://png.runflare.run'}${path}`, {
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

type ConfirmAction = null | { kind: 'delete_chat' | 'delete_group' | 'leave_group'; chatId: string };

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
    onReconnectNow,
    loading = false,
}: ChatListProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const { isDarkMode, toggleDarkMode } = useDarkMode();

    const isMobile = useIsMobile(768);

    // Keep a local copy so we can remove deleted/left chats immediately.
    const [localChats, setLocalChats] = useState<Chat[]>(chats);
    useEffect(() => { setLocalChats(chats); }, [chats]);

    const isVerifiedUser = resolveVerified((currentUser as any)?.verified);

    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const pinnedIdsRef = useRef<string[]>([]);

    const [chatActionMenu, setChatActionMenu] = useState<null | { chatId: string; top: number; left: number }>(null);
    const chatItemsRef = useRef<HTMLDivElement | null>(null);
    const chatActionMenuRef = useRef<HTMLDivElement | null>(null);
    const chatActionBtnRef = useRef<HTMLElement | null>(null);

    const [pinBusy, setPinBusy] = useState<Record<string, boolean>>({});
    const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});

    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
    const confirmOverlayRef = useRef<HTMLDivElement | null>(null);

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

    const runConfirmAction = async () => {
        if (!confirmAction) return;
        const { kind, chatId } = confirmAction;
        if (actionBusy[chatId]) return;

        setActionBusy((m) => ({ ...m, [chatId]: true }));
        try {
            if (kind === 'leave_group') {
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
            else alert('حذف گفتگو با خطا مواجه شد');
        } finally {
            setActionBusy((m) => ({ ...m, [chatId]: false }));
        }
    };

    const openActionMenu = (chatId: string, btnEl: HTMLElement) => {
        const container = chatItemsRef.current;
        if (!container) return;

        const c = container.getBoundingClientRect();
        const r = btnEl.getBoundingClientRect();

        const menuWidth = 190;
        // Height estimate: pin + (delete OR leave+delete)
        const menuHeight = 156;
        const padding = 8;

        // IMPORTANT: popover is absolutely positioned inside the scrollable chat list,
        // so we must include scrollTop/scrollLeft in coordinate calculations.
        const scrollTop = container.scrollTop;
        const scrollLeft = container.scrollLeft;

        const btnTop = (r.top - c.top) + scrollTop;
        const btnBottom = (r.bottom - c.top) + scrollTop;

        // Position under button by default (decision based on visible space).
        const spaceBelow = c.bottom - r.bottom;
        let top = spaceBelow < menuHeight + 12
            ? btnTop - menuHeight - 8
            : btnBottom + 6;

        // Keep menu within the visible part of the list.
        const minTop = scrollTop + padding;
        const maxTop = scrollTop + container.clientHeight - menuHeight - padding;
        top = Math.max(minTop, Math.min(top, maxTop));

        // Align menu to the button's right edge.
        let left = ((r.right - c.left) + scrollLeft) - menuWidth;
        const minLeft = scrollLeft + padding;
        const maxLeft = scrollLeft + container.clientWidth - menuWidth - padding;
        left = Math.max(minLeft, Math.min(left, maxLeft));

        setChatActionMenu((prev) => (prev?.chatId === chatId ? null : { chatId, top, left }));
    };

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

    return (
        <div className="chat-list" style={{ position: 'relative' }}>
            {/* Header */}
            <div className="chat-list__header">
                <div className="chat-list__header-left">
                    <button onClick={onOpenProfile}>
                        <Avatar name={currentUser.name} size="sm" online={true} src={currentUser.avatar} />
                    </button>
                    <div className="chat-list__title-wrap">
                        <h1 className="chat-list__title">{wsConnected ? 'NovaRoom' : 'Connecting...'}</h1>
                        {!wsConnected && wsReconnectExhausted && (
                            <button
                                type="button"
                                className="chat-list__reconnect-btn"
                                onClick={() => {
                                    onReconnectNow();
                                    window.location.reload();
                                }}
                            >
                                Refresh
                            </button>
                        )}
                    </div>
                </div>
                <div className="chat-list__header-actions">
                    <button className="icon-btn" onClick={onNewChatClick}>
                        <MessageSquarePlus size={20} />
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
                                <button
                                    className="popover__item"
                                    onClick={() => { setMenuOpen(false); toggleDarkMode(); }}
                                    type="button"
                                >
                                    {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
                                    {isDarkMode ? 'حالت روشن' : 'حالت تاریک'}
                                </button>
                                <button className="popover__item popover__item--danger" onClick={() => { setMenuOpen(false); onLogout(); }} type="button">
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
            <div className="chat-list__items" ref={chatItemsRef} style={{ position: 'relative' }}>
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
                                    NovaRoom AI
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

                        if (isSaved) {
                            return (
                                <button
                                    key={chat.id}
                                    onClick={() => onSelectChat(chat.id)}
                                    className={cx('chat-list__item', isActive && 'chat-list__item--active')}
                                >
                                    <Avatar name="" size="md" savedMessages={true} />
                                    <div className="chat-list__item-content">
                                        <div className="chat-list__item-row">
                                            <span className="chat-list__item-name">
                                                پیام‌های ذخیره شده
                                            </span>
                                            {chat.lastMessage && (
                                                <span className="chat-list__item-time">
                                                    {formatTime(chat.lastMessage.timestamp)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="chat-list__item-preview">
                                            <p className="chat-list__item-text">
                                                {chat.lastMessage?.text || 'پیام‌های ذخیره شده شما'}
                                            </p>
                                            {chat.unreadCount > 0 && (
                                                <span className="chat-list__unread-badge">{chat.unreadCount}</span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            );
                        }

                        const isMine = chat.lastMessage?.senderId === currentUser.chatId;
                        const contact = getContact(chat);
                        const unreadCount = typeof chat.unreadCount === 'number' && chat.unreadCount > 0 ? chat.unreadCount : 0;

                        return (
                            <button
                                key={chat.id}
                                onClick={() => onSelectChat(chat.id)}
                                className={cx(
                                    'chat-list__item',
                                    isActive && 'chat-list__item--active',
                                    pinned && 'chat-list__item--pinned'
                                )}
                            >
                                <Avatar
                                    name={contact.name}
                                    size="md"
                                    online={group ? undefined : contact.online}
                                    src={contact.avatar}
                                />

                                <div className="chat-list__item-content">
                                    <div className="chat-list__item-row">
                                        <span
                                            className="chat-list__item-name"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                        >
                                            {group ? (
                                                <FilledGroupIcon
                                                    size={14}
                                                    title="گروه"
                                                    style={{ opacity: 0.9 }}
                                                />
                                            ) : null}
                                            {contact.name}
                                            {contact.verified ? <VerifiedBadge size={14} /> : null}
                                            {pinned ? (
                                                <PinFilledSharpIcon
                                                    size={14}
                                                    className="chat-list__pin-icon"
                                                    title="سنجاق شده"
                                                    style={{ opacity: 0.95 }}
                                                />
                                            ) : null}
                                        </span>

                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                            {chat.lastMessage && (
                                                <span className="chat-list__item-time">
                                                    {formatTime(chat.lastMessage.timestamp)}
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
                                                    openActionMenu(chat.id, e.currentTarget);
                                                }}
                                            >
                                                <MoreVertical size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="chat-list__item-preview">
                                        <p className="chat-list__item-text">
                                            {isMine && <span className="chat-list__item-text-prefix">شما: </span>}
                                            {chat.lastMessage?.text || 'هنوز پیامی ارسال نشده'}
                                        </p>
                                        {unreadCount > 0 && (
                                            <span className="chat-list__unread-badge">{unreadCount}</span>
                                        )}
                                    </div>
                                </div>

                                {chatActionMenu?.chatId === chat.id && (
                                    <div
                                        ref={chatActionMenuRef}
                                        className="popover popover--mini"
                                        style={{ top: chatActionMenu.top, left: chatActionMenu.left, right: 'auto', position: 'absolute', zIndex: 60 }}
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
                                                // close immediately (before async request)
                                                setChatActionMenu(null);
                                                togglePin(chat.id);
                                            }}
                                            disabled={Boolean(pinBusy[chat.id])}
                                            style={pinBusy[chat.id] ? { opacity: 0.6, cursor: 'default' } : undefined}
                                        >
                                            {pinned ? <UnpinFilledSharpIcon size={16} /> : <PinOutlineSharpIcon size={16} />}
                                            {pinned ? 'برداشتن سنجاق' : 'سنجاق'}
                                        </button>

                                        {group ? (
                                            <>
                                                <button
                                                    className="popover__item popover__item--danger"
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setChatActionMenu(null);
                                                        requestLeaveGroup(chat.id);
                                                    }}
                                                    disabled={Boolean(actionBusy[chat.id])}
                                                    style={actionBusy[chat.id] ? { opacity: 0.6, cursor: 'default' } : undefined}
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
                                                            requestDeleteChat(chat.id, true);
                                                        }}
                                                        disabled={Boolean(actionBusy[chat.id])}
                                                        style={actionBusy[chat.id] ? { opacity: 0.6, cursor: 'default' } : undefined}
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
                                                    requestDeleteChat(chat.id, false);
                                                }}
                                                disabled={Boolean(actionBusy[chat.id])}
                                                style={actionBusy[chat.id] ? { opacity: 0.6, cursor: 'default' } : undefined}
                                            >
                                                <Trash2 size={16} />
                                                حذف گفتگو
                                            </button>
                                        )}
                                    </div>
                                )}
                            </button>
                        );
                    })
                )}
            </div>

            {/* Custom confirm modal (same classes as ChatRoom) */}
            {confirmAction && confirmMeta && (
                <div className="chat-room-modal-overlay" ref={confirmOverlayRef} style={{ zIndex: 120 }}>
                    <div
                        className="chat-room-confirm-modal"
                        onMouseDown={(e) => e.stopPropagation()}
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
                    </div>
                </div>
            )}
        </div>
    );
}
