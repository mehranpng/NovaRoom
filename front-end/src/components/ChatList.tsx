import { Search, MessageSquarePlus, Menu, User as UserIcon, LogOut, Bookmark, Moon, Sun, Megaphone } from 'lucide-react';
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
    onOpenOfficialChannel?: () => void;
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
    onOpenOfficialChannel,
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

    // Sort all chats (including saved messages) by last message timestamp
    const sortedChats = [...chats].sort((a, b) => {
        const aTime = a.lastMessage ? normalizeTs(a.lastMessage.timestamp) : 0;
        const bTime = b.lastMessage ? normalizeTs(b.lastMessage.timestamp) : 0;
        return bTime - aTime; // Descending order (newest first)
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
    const showAIChat = !searchQuery || 'novaroom ai'.includes(searchQuery.toLowerCase()) || 'دستیار'.includes(searchQuery);

    // Check if we should show Official Channel in search results
    const showOfficialChannel = !searchQuery || 'کانال رسمی'.includes(searchQuery) || 'official'.includes(searchQuery.toLowerCase()) || 'channel'.includes(searchQuery.toLowerCase());

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

                {/* Official Channel - Pinned below AI */}
                {showOfficialChannel && onOpenOfficialChannel && (
                    <button
                        onClick={onOpenOfficialChannel}
                        className="chat-list__item chat-list__item--channel"
                    >
                        <div
                            style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <Megaphone size={24} color="white" />
                        </div>
                        <div className="chat-list__item-content">
                            <div className="chat-list__item-row">
                                <span
                                    className="chat-list__item-name"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                >
                                    کانال رسمی نوا روم
                                    <VerifiedBadge size={14} />
                                </span>
                            </div>
                            <div className="chat-list__item-preview">
                                <p className="chat-list__item-text">
                                    اخبار و اطلاعیه‌ها
                                </p>
                            </div>
                        </div>
                    </button>
                )}

                {/* All chats (including saved messages) - sorted by timestamp */}
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
                        
                        if (isSaved) {
                            // Render Saved Messages
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
                        
                        // Render Regular Chat
                        const isMine = chat.lastMessage?.senderId === currentUser.chatId;
                        const contact = getContact(chat);
                        const unreadCount = typeof chat.unreadCount === 'number' && chat.unreadCount > 0 ? chat.unreadCount : 0;

                        return (
                            <button
                                key={chat.id}
                                onClick={() => onSelectChat(chat.id)}
                                className={cx('chat-list__item', isActive && 'chat-list__item--active')}
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
