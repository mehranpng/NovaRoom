import { Search, MessageSquarePlus, Settings } from 'lucide-react';
import { useState } from 'react';
import { Chat, User } from '@/types';
import { Avatar } from './Avatar';
import { cn } from '@/utils/cn';

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
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onOpenProfile} className="transition-transform hover:scale-105">
            <Avatar name={currentUser.name} size="sm" online={true} />
          </button>
          <h1 className="text-xl font-bold text-gray-900">Chats</h1>
        </div>
        <div className="flex items-center gap-1">
          <button className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700">
            <MessageSquarePlus size={20} />
          </button>
          <button
            onClick={onOpenProfile}
            className="rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl bg-gray-100 py-2.5 pl-9 pr-4 text-sm text-gray-900 placeholder-gray-500 outline-none transition-colors focus:bg-gray-50 focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto">
        {filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <MessageSquarePlus size={48} strokeWidth={1} />
            <p className="mt-3 text-sm">No conversations found</p>
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
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-gray-50',
                  isActive && 'bg-blue-50 hover:bg-blue-50'
                )}
              >
                <Avatar name={contact.name} size="md" online={contact.online} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'truncate text-[15px] font-semibold text-gray-900',
                        isActive && 'text-blue-600'
                      )}
                    >
                      {contact.name}
                    </span>
                    {chat.lastMessage && (
                      <span className="ml-2 shrink-0 text-xs text-gray-400">
                        {formatTime(chat.lastMessage.timestamp)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm text-gray-500">
                      {isMine && <span className="text-gray-400">You: </span>}
                      {chat.lastMessage?.text || 'No messages yet'}
                    </p>
                    {chat.unreadCount > 0 && (
                      <span className="ml-2 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-bold text-white">
                        {chat.unreadCount}
                      </span>
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
