import { Search, MessageSquarePlus, Settings } from 'lucide-react';
import { useState } from 'react';
import type { Chat, User } from '../types';
import { Avatar } from './Avatar';
import { cx } from '../utils/cx';

interface ChatListProps {
  chats: Chat[];
  contacts: User[];
  currentUser: User;
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onOpenProfile: () => void;
}

function formatTime(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
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
  contacts,
  currentUser,
  activeChatId,
  onSelectChat,
  onOpenProfile,
}: ChatListProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const getContact = (chat: Chat): User | undefined => {
    const contactId = chat.participantIds.find((id) => id !== currentUser.id);
    return contacts.find((c) => c.id === contactId);
  };

  const filteredChats = chats.filter((chat) => {
    const contact = getContact(chat);
    if (!contact) return false;
    if (!searchQuery) return true;
    return (
      contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.username.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

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
          <button className="icon-btn">
            <MessageSquarePlus size={20} />
          </button>
          <button className="icon-btn" onClick={onOpenProfile}>
            <Settings size={20} />
          </button>
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
        {filteredChats.length === 0 ? (
          <div className="chat-list__empty">
            <MessageSquarePlus size={48} strokeWidth={1} />
            <p>No conversations found</p>
          </div>
        ) : (
          filteredChats.map((chat) => {
            const contact = getContact(chat);
            if (!contact) return null;
            const isActive = activeChatId === chat.id;
            const isMine = chat.lastMessage?.senderId === currentUser.id;

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
