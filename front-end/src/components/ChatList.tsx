import { Search, MessageSquarePlus, Menu, User as UserIcon, LogOut, Bookmark, Pin, PinOff, Users, UsersRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Chat, User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { cx } from '../utils/cx';
import { EmptyState } from './EmptyState';
import { ChatListSkeleton } from './ChatListSkeleton';
import { DarkModeToggle } from './DarkModeToggle';
import { useDarkMode } from '../hooks/useDarkMode';

interface ChatListProps {
    chats: Chat[];
    currentUser: User;
    activeChatId: string | null;
    onSelectChat: (chatId: string) => void;
    onOpenProfile: () => void;
    onNewChatClick: () => void;
    onNewGroupClick: () => void;
    onLogout: () => void;
    onOpenAIChat: () => void;
    onOpenSavedMessages: () => void;
    savedMessages: UserMessage[];
    pinnedChatIds: string[];
    onTogglePinChat: (chatId: string) => void;
    loading?: boolean;
}

type UserMessage = {
    id: string;
    text: string;
    timestamp: number;
};

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
    const today = tehranMidnightEpoch(Date.now());
    const thatDay = tehranMidnightEpoch(timestamp);
    const diffDays = Math.round((today - thatDay) / 86400000);

    const d = new Date(normalizeTs(timestamp));

    if (diffDays === 0) {
        return tehranTimeFmt.format(d);
    }
    if (diffDays === 1) {
        return 'دیروز';
    }
    if (diffDays < 7) {
        return tehranWeekdayFmt.format(d);
    }
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

export function ChatList({
    chats,
    currentUser,
    activeChatId,
    onSelectChat,
    onOpenProfile,
    onNewChatClick,
    onNewGroupClick,
    onLogout,
    onOpenAIChat,
    onOpenSavedMessages,
    savedMessages,
    pinnedChatIds,
    onTogglePinChat,
    loading = false,
}: ChatListProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const { isDarkMode, toggleDarkMode } = useDarkMode();

    const isMobile = useIsMobile(768);

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

    const getContact = (chat: Chat): User => {
        if (chat.otherUser) {
            return {
                ...chat.otherUser,
                chatId: chat.otherUser?.isGroup ? chat.id : (chat.participantIds.find(id => id !== currentUser.chatId) || ''),
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

    const filteredChats = chats.filter((chat) => {
        const contact = getContact(chat);
        if (!searchQuery) return true;
        return (
            contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            contact.username.toLowerCase().includes(searchQuery.toLowerCase())
        );
    });

    const hasActiveChat = Boolean(activeChatId);

    // Check if we should show AI chat in search results
    const showAIChat = !searchQuery || 'novaroom ai'.includes(searchQuery.toLowerCase()) || 'دستیار'.includes(searchQuery);

    return (
        <div className="chat-list">
            {/* Header */}
            <div className="chat-list__header">
                <div className="chat-list__header-left">
                    <button onClick={onOpenProfile}>
                        <Avatar name={currentUser.name} size="sm" online={true} avatar={currentUser.avatar} />
                    </button>
                    <h1 className="chat-list__title">NovaRoom</h1>
                </div>
                <div className="chat-list__header-actions">
                    <DarkModeToggle isDarkMode={isDarkMode} onToggle={toggleDarkMode} />
                    
                    <button className="icon-btn" onClick={onNewGroupClick} title="ساخت گروه" type="button">
                        <UsersRound size={20} />
                    </button>

                    <button className="icon-btn" onClick={onNewChatClick} title="چت جدید" type="button">
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
                {/* AI Chat - Always pinned at top - show even during loading */}
                {showAIChat && (
                    <button
                        onClick={onOpenAIChat}
                        className="chat-list__item chat-list__item--ai"
                    >
                        <img
                            src="/avatars/ch.png"
                            alt="Nova Assistant"
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
                                    Nova Assistant
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

                <button
                    onClick={onOpenSavedMessages}
                    className="chat-list__item chat-list__item--ai"
                >
                    <span
                        style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: '#2F80ED',
                            color: '#fff',
                            flexShrink: 0,
                        }}
                    >
                        <Bookmark size={20} />
                    </span>
                    <div className="chat-list__item-content">
                        <div className="chat-list__item-row">
                            <span className="chat-list__item-name">پیام‌های ذخیره‌شده</span>
                            {savedMessages.length > 0 && <span className="chat-list__item-time">{savedMessages.length}</span>}
                        </div>
                        <div className="chat-list__item-preview">
                            <p className="chat-list__item-text">
                                {(savedMessages[savedMessages.length - 1]?.text) || 'پیامی ذخیره نشده است'}
                            </p>
                        </div>
                    </div>
                </button>

                {/* Regular chats */}
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
                        const contact = getContact(chat);
                        const isActive = activeChatId === chat.id;
                        const isMine = chat.lastMessage?.senderId === currentUser.chatId;

                        return (
                            <button
                                key={chat.id}
                                onClick={() => onSelectChat(chat.id)}
                                className={cx('chat-list__item', isActive && 'chat-list__item--active')}
                            >
                                <Avatar name={contact.name} size="md" online={contact.online} avatar={contact.avatar} />
                                <div className="chat-list__item-content">
                                    <div className="chat-list__item-row">
                                        <span
                                            className="chat-list__item-name"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                        >
                                            {contact.name}
                                            {chat.participantIds.length > 2 ? <Users size={14} /> : null}
                                            {contact.verified ? <VerifiedBadge size={14} /> : null}
                                            {pinnedChatIds.includes(chat.id) ? <Pin size={12} /> : null}
                                        </span>
                                        {chat.lastMessage && (
                                            <span className="chat-list__item-time">
                                                {formatTime(chat.lastMessage.timestamp)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="chat-list__item-preview">
                                        <p className="chat-list__item-text">
                                            {isMine && <span className="chat-list__item-text-prefix">شما: </span>}
                                            {chat.lastMessage?.text || 'هنوز پیامی ارسال نشده'}
                                        </p>
                                        {chat.otherUser?.isGroup && Array.isArray(chat.otherUser?.members) && (
                                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                                {chat.otherUser.members.filter((m: any) => m.online).length} آنلاین • {chat.otherUser.members.filter((m: any) => !m.online).length} آفلاین
                                            </span>
                                        )}
                                        {chat.unreadCount > 0 && (
                                            <span className="chat-list__unread-badge">{chat.unreadCount}</span>
                                        )}
                                        <button
                                            type="button"
                                            className="icon-btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onTogglePinChat(chat.id);
                                            }}
                                            aria-label="Pin chat"
                                            style={{ width: 24, height: 24 }}
                                        >
                                            {pinnedChatIds.includes(chat.id) ? <PinOff size={14} /> : <Pin size={14} />}
                                        </button>
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
