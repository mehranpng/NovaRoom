import { useMemo, useState } from 'react';
import { X, Search, MessageCircle, Bookmark } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Chat } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface ForwardModalProps {
    isOpen: boolean;
    chats: Chat[];
    currentUserId: string;
    currentUserVerified?: boolean;
    onClose: () => void;
    onForward?: (chatId: string) => void;
    onSelectTargetChat?: (chatId: string) => void;
    onSelectChat?: (chatId: string) => void;
}

export function ForwardModal({ isOpen, chats, currentUserId, currentUserVerified = false, onClose, onForward, onSelectTargetChat, onSelectChat }: ForwardModalProps) {
    const [searchQuery, setSearchQuery] = useState('');

    const handlePickChat = (chatId: string) => {
        if (onSelectTargetChat) {
            onSelectTargetChat(chatId);
            onClose();
            return;
        }
        onForward?.(chatId);
        if (onSelectChat) onSelectChat(chatId);
        onClose();
    };

    // Build saved messages chat object
    const savedMessagesChat = {
        id: `saved_messages_${currentUserId}`,
        name: 'پیام‌های ذخیره شده',
        username: 'saved',
        online: false,
        verified: false,
    };

    const sortedChats = useMemo(() => {
        return [...chats].sort((a, b) => {
            const aTime = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
            const bTime = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
            return bTime - aTime;
        });
    }, [chats]);

    // Keep same order behavior as ChatList and hide stale chats with no lastMessage.
    const availableChats = sortedChats.filter((chat) => {
        if (chat.id.startsWith('saved_messages_')) return false;
        if (chat.id === 'official-channel' && !currentUserVerified) return false;
        if (!chat.otherUser) return false;
        if (!chat.lastMessage) return false;
        return true;
    });

    const normalizedQuery = searchQuery.toLowerCase();
    const filteredChats = searchQuery
        ? availableChats.filter((chat) =>
            chat.otherUser?.name?.toLowerCase().includes(normalizedQuery) ||
            chat.otherUser?.username?.toLowerCase().includes(normalizedQuery)
        )
        : availableChats;

    // Show saved messages only if no search query, always at top
    const showSavedMessages = !searchQuery;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="modal-overlay"
                    onClick={onClose}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                >
                    <motion.div
                        className="forward-modal"
                        onClick={(e) => e.stopPropagation()}
                        initial={{ y: 26, opacity: 0, scale: 0.98 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 16, opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                        <div className="modal-header">
                            <h2>فوروارد پیام</h2>
                            <button className="icon-btn" onClick={onClose} type="button" aria-label="Close">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="search-box">
                            <Search size={18} />
                            <input
                                type="text"
                                placeholder="جستجو در گفتگو‌ها..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <div className="results">
                            {showSavedMessages && (
                                <button
                                    key={savedMessagesChat.id}
                                    className="user-item"
                                    onClick={() => handlePickChat(savedMessagesChat.id)}
                                    type="button"
                                >
                                    <Avatar name="" size="md" online={false} savedMessages />
                                    <div className="user-item-info">
                                        <div className="user-name" style={{ fontFamily: "'Vazir', sans-serif" }}>
                                            {savedMessagesChat.name}
                                        </div>
                                    </div>
                                    <Bookmark size={18} style={{ color: 'var(--text-tertiary)', marginLeft: 'auto' }} />
                                </button>
                            )}

                            {filteredChats.length === 0 && !showSavedMessages ? (
                                <div className="no-results">
                                    {searchQuery ? 'گفتگویی یافت نشد' : 'گفتگوی فعالی وجود ندارد'}
                                </div>
                            ) : (
                                filteredChats.map((chat) => {
                                    const user = chat.otherUser;
                                    if (!user) return null;

                                    return (
                                        <button
                                            key={chat.id}
                                            className="user-item"
                                            onClick={() => handlePickChat(chat.id)}
                                            type="button"
                                        >
                                            <Avatar
                                                name={user.name || user.username}
                                                size="md"
                                                online={user.online}
                                                src={chat.id === 'official-channel' ? '/avatars/ch.png' : user.avatar}
                                            />
                                            <div className="user-item-info">
                                                <div className="user-name" style={{ fontFamily: "'Vazir', sans-serif", display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    {user.name}
                                                    {user.verified && <VerifiedBadge size={14} />}
                                                </div>
                                                <div className="user-username" style={{ fontFamily: "'Vazir', sans-serif" }}>@{user.username}</div>
                                            </div>
                                            <MessageCircle size={18} style={{ color: 'var(--text-tertiary)', marginLeft: 'auto' }} />
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
