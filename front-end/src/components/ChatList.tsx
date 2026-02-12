import { Search, MessageSquarePlus, Menu, User as UserIcon, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Chat, User } from '../types';
import { Avatar } from './Avatar';
import { cx } from '../utils/cx';
import { EmptyState } from './EmptyState';

interface ChatListProps {
    chats: Chat[];
    currentUser: User;
    activeChatId: string | null;
    onSelectChat: (chatId: string) => void;
    onOpenProfile: () => void;
    onNewChatClick: () => void;
    onLogout: () => void;
}

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

function toIranDate(ts: any): Date {
    // Force a Date instance whose clock time matches Tehran for formatting purposes.
    const t = normalizeTs(ts);
    const tzDateStr = new Date(t).toLocaleString('en-US', { timeZone: 'Asia/Tehran' });
    return new Date(tzDateStr);
}

function formatTime(timestamp: any): string {
    const now = toIranDate(Date.now());
    const date = toIranDate(timestamp);
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (days === 1) {
        return 'Yesterday';
    } else if (days < 7) {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ChatList({
    chats,
    currentUser,
    activeChatId,
    onSelectChat,
    onOpenProfile,
    onNewChatClick,
    onLogout,
}: ChatListProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

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
                chatId: chat.participantIds.find(id => id !== currentUser.chatId) || ''
            };
        }

        const contactId = chat.participantIds.find((id) => id !== currentUser.chatId) || 'Unknown';
        return {
            chatId: contactId,
            name: contactId,
            username: contactId.toLowerCase(),
            bio: '',
            avatar: '',
            online: false
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

    return (
        <div className="chat-list">
            {/* Header */}
            <div className="chat-list__header">
                <div className="chat-list__header-left">
                    <button onClick={onOpenProfile}>
                        <Avatar name={currentUser.name} size="sm" online={true} />
                    </button>
                    <h1 className="chat-list__title">Chats</h1>
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
                                    Profile
                                </button>
                                <button className="popover__item popover__item--danger" onClick={() => { setMenuOpen(false); onLogout(); }} type="button">
                                    <LogOut size={16} />
                                    Logout
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
                        placeholder="Search conversations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="chat-list__search-input"
                    />
                </div>
            </div>

            {/* Chat List */}
            <div className="chat-list__items">
                {chats.length === 0 ? (
                    // Desktop: right pane (EmptyState) is enough; show this inside list only on mobile.
                    // We also hide it when a chat is active to avoid visual duplication.
                    <div className="chat-list__empty-mobile-only" style={{ display: hasActiveChat ? 'none' : undefined }}>
                        <EmptyState />
                    </div>
                ) : filteredChats.length === 0 ? (
                    <div className="chat-list__empty">
                        <MessageSquarePlus size={48} strokeWidth={1} />
                        <p>No conversations found</p>
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
                                <Avatar name={contact.name} size="md" online={contact.online} />
                                <div className="chat-list__item-content">
                                    <div className="chat-list__item-row">
                                        <span className="chat-list__item-name">{contact.name}</span>
                                        {chat.lastMessage && (
                                            <span className="chat-list__item-time">
                                                {formatTime(chat.lastMessage.timestamp)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="chat-list__item-preview">
                                        <p className="chat-list__item-text">
                                            {isMine && <span className="chat-list__item-text-prefix">You: </span>}
                                            {chat.lastMessage?.text || 'No messages yet'}
                                        </p>
                                        {chat.unreadCount > 0 && (
                                            <span className="chat-list__unread-badge">{chat.unreadCount}</span>
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
