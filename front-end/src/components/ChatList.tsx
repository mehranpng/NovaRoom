import { Search, MessageSquarePlus, Menu, User as UserIcon, LogOut, Bookmark, Moon, Sun, MoreVertical, Pin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
    onSelectChat: (chatId: string) => void;
    onOpenProfile: () => void;
    onNewChatClick: () => void;
    onLogout: () => void;
    onOpenAIChat: () => void;
    onOpenSavedMessages: () => void;
    loading?: boolean;
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token');
    const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}${path}`, {
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

export function ChatList({
    chats,
    currentUser,
    activeChatId,
    onSelectChat,
    onOpenProfile,
    onNewChatClick,
    onLogout,
    onOpenAIChat,
    onOpenSavedMessages,
    loading = false,
}: ChatListProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const { isDarkMode, toggleDarkMode } = useDarkMode();

    const isMobile = useIsMobile(768);

    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const [chatActionOpenId, setChatActionOpenId] = useState<string | null>(null);
    const chatActionRef = useRef<HTMLDivElement | null>(null);

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
            if (!chatActionRef.current) return;
            if (chatActionRef.current.contains(e.target as Node)) return;
            setChatActionOpenId(null);
        };
        if (chatActionOpenId) {
            document.addEventListener('mousedown', onDocClick);
        }
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [chatActionOpenId]);

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

    const togglePin = async (chatId: string) => {
        const currentlyPinned = isPinned(chatId);

        if (!currentlyPinned && pinnedIds.length >= 20) {
            alert('حداکثر ۲۰ گفتگو را می‌توانید پین کنید');
            return;
        }

        // optimistic update
        const next = currentlyPinned ? pinnedIds.filter((id) => id !== chatId) : [chatId, ...pinnedIds];
        setPinnedIds(next);
        persistPinned(next);

        try {
            if (currentlyPinned) {
                const r = await apiFetch<{ pinnedChatIds: string[] }>(`/profile/me/pins/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
                setPinnedIds((r?.pinnedChatIds || []).slice(0, 20));
                persistPinned((r?.pinnedChatIds || []).slice(0, 20));
            } else {
                const r = await apiFetch<{ pinnedChatIds: string[] }>(`/profile/me/pins/${encodeURIComponent(chatId)}`, { method: 'POST' });
                setPinnedIds((r?.pinnedChatIds || []).slice(0, 20));
                persistPinned((r?.pinnedChatIds || []).slice(0, 20));
            }
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
            alert(e?.message || 'خطا در تغییر وضعیت پین');
        } finally {
            setChatActionOpenId(null);
        }
    };

    // Sort all chats by last message timestamp, but keep pinned at top.
    // Within pinned: order by latest lastMessage as well.
    const sortedChats = [...chats].sort((a, b) => {
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

    return (
        <div className="chat-list">
            {/* Header */}
            <div className="chat-list__header">
                <div className="chat-list__header-left">
                    <button onClick={onOpenProfile}>
                        <Avatar name={currentUser.name} size="sm" online={true} src={currentUser.avatar} />
                    </button>
                    <h1 className="chat-list__title">NovaRoom</h1>
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
            <div className="chat-list__items">
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
                ) : chats.length === 0 ? (
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
                                <Avatar name={contact.name} size="md" online={contact.online} src={contact.avatar} />

                                <div className="chat-list__item-content">
                                    <div className="chat-list__item-row">
                                        <span
                                            className="chat-list__item-name"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                        >
                                            {contact.name}
                                            {contact.verified ? <VerifiedBadge size={14} /> : null}
                                            {pinned ? <Pin size={14} className="chat-list__pin-icon" /> : null}
                                        </span>

                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                            {chat.lastMessage && (
                                                <span className="chat-list__item-time">
                                                    {formatTime(chat.lastMessage.timestamp)}
                                                </span>
                                            )}

                                            <div className="chat-list__chat-actions" ref={chatActionRef}>
                                                <button
                                                    className="icon-btn icon-btn--xs"
                                                    type="button"
                                                    aria-label="Chat actions"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setChatActionOpenId((prev) => (prev === chat.id ? null : chat.id));
                                                    }}
                                                >
                                                    <MoreVertical size={16} />
                                                </button>

                                                {chatActionOpenId === chat.id && (
                                                    <div
                                                        className="popover popover--mini popover--right"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                        }}
                                                    >
                                                        <button
                                                            className="popover__item"
                                                            type="button"
                                                            onClick={() => togglePin(chat.id)}
                                                        >
                                                            <Pin size={16} />
                                                            {pinned ? 'آن‌پین' : 'پین'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
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
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
}
