import { useState } from 'react';
import { X, Search, MessageCircle, Bookmark } from 'lucide-react';
import type { Chat } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface ForwardModalProps {
    isOpen: boolean;
    chats: Chat[];
    currentUserId: string;
    onClose: () => void;
    onForward: (chatId: string) => void;
}

export function ForwardModal({ isOpen, chats, currentUserId, onClose, onForward }: ForwardModalProps) {
    const [searchQuery, setSearchQuery] = useState('');

    if (!isOpen) return null;

    // Build saved messages chat object
    const savedMessagesChat = {
        id: `saved_messages_${currentUserId}`,
        name: 'پیام‌های ذخیره شده',
        username: 'saved',
        online: false,
        verified: false,
    };

    // Filter out saved messages from regular chats (in case it exists)
    const availableChats = chats.filter(chat => {
        if (chat.id.startsWith('saved_messages_')) return false;
        if (!chat.otherUser) return false;
        return true;
    });

    const filteredChats = searchQuery
        ? availableChats.filter(chat =>
              chat.otherUser?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
              chat.otherUser?.username?.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : availableChats;

    // Show saved messages only if no search query, always at top
    const showSavedMessages = !searchQuery;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="forward-modal" onClick={(e) => e.stopPropagation()}>
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
                            onClick={() => {
                                onForward(savedMessagesChat.id);
                                onClose();
                            }}
                            type="button"
                        >
                            <Avatar name="" size="md" online={false} savedMessages />
                            <div className="user-item-info">
                                <div className="user-name" style={{ fontFamily: 'Vazir, sans-serif' }}>
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
                                    onClick={() => {
                                        onForward(chat.id);
                                        onClose();
                                    }}
                                    type="button"
                                >
                                    <Avatar name={user.name || user.username} size="md" online={user.online} src={user.avatar} />
                                    <div className="user-item-info">
                                        <div className="user-name" style={{ fontFamily: 'Vazir, sans-serif', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            {user.name}
                                            {user.verified && <VerifiedBadge size={14} />}
                                        </div>
                                        <div className="user-username" style={{ fontFamily: 'Vazir, sans-serif' }}>@{user.username}</div>
                                    </div>
                                    <MessageCircle size={18} style={{ color: 'var(--text-tertiary)', marginLeft: 'auto' }} />
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
