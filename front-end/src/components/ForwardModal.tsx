import { useState } from 'react';
import { X, Search, MessageCircle } from 'lucide-react';
import type { Chat } from '../types';
import { Avatar } from './Avatar';

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

    // Filter out saved messages and current chat
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
                        autoFocus
                    />
                </div>

                <div className="results">
                    {filteredChats.length === 0 ? (
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
                                    <Avatar name={user.name || user.username} size="md" online={user.online} />
                                    <div style={{ minWidth: 0, flex: 1, textAlign: 'right' }}>
                                        <div className="user-name">{user.name}</div>
                                        <div className="user-username">@{user.username}</div>
                                    </div>
                                    <MessageCircle size={18} style={{ color: 'var(--text-tertiary)' }} />
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
