import { useState, useCallback } from 'react';
import { Message, View, User } from '@/types';
import {
  currentUser as initialUser,
  contacts,
  mockChats,
  mockMessages,
} from '@/data/mockData';
import { ChatList } from '@/components/ChatList';
import { ChatRoom } from '@/components/ChatRoom';
import { Profile } from '@/components/Profile';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/utils/cn';

export function App() {
  const [view, setView] = useState<View>('chatList');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>(mockMessages);
  const [chats, setChats] = useState(mockChats);
  const [user, setUser] = useState<User>(initialUser);

  const handleSelectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setView('chatRoom');
    // Mark as read
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c))
    );
  }, []);

  const handleSendMessage = useCallback(
    (text: string) => {
      if (!activeChatId) return;

      const newMessage: Message = {
        id: `msg-${Date.now()}`,
        chatId: activeChatId,
        senderId: user.id,
        text,
        timestamp: Date.now(),
        seen: false,
      };

      setMessages((prev) => ({
        ...prev,
        [activeChatId]: [...(prev[activeChatId] || []), newMessage],
      }));

      setChats((prev) =>
        prev.map((c) =>
          c.id === activeChatId ? { ...c, lastMessage: newMessage } : c
        )
      );

      // Simulate a reply after 1-2 seconds
      const chat = chats.find((c) => c.id === activeChatId);
      if (chat) {
        const contactId = chat.participantIds.find((id) => id !== user.id);
        if (contactId) {
          const delay = 1000 + Math.random() * 2000;
          const replies = [
            'Got it! 👍',
            'Interesting, tell me more!',
            'Sure thing!',
            'That makes sense.',
            'Haha, nice one! 😄',
            'Let me think about that...',
            "I'll get back to you on that.",
            'Sounds great!',
            'Thanks for letting me know.',
            'Absolutely!',
          ];
          setTimeout(() => {
            const reply: Message = {
              id: `msg-${Date.now()}-reply`,
              chatId: activeChatId,
              senderId: contactId,
              text: replies[Math.floor(Math.random() * replies.length)],
              timestamp: Date.now(),
              seen: false,
            };
            setMessages((prev) => ({
              ...prev,
              [activeChatId]: [...(prev[activeChatId] || []), reply],
            }));
            setChats((prev) =>
              prev.map((c) =>
                c.id === activeChatId ? { ...c, lastMessage: reply } : c
              )
            );
          }, delay);
        }
      }
    },
    [activeChatId, chats, user.id]
  );

  const handleBack = useCallback(() => {
    setView('chatList');
  }, []);

  const handleOpenProfile = useCallback(() => {
    setView('profile');
  }, []);

  const handleUpdateProfile = useCallback(
    (updates: Partial<Pick<User, 'name' | 'username' | 'bio'>>) => {
      setUser((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  const activeChat = activeChatId ? chats.find((c) => c.id === activeChatId) : null;
  const activeContact = activeChat
    ? contacts.find((c) =>
        activeChat.participantIds.includes(c.id) && c.id !== user.id
      )
    : null;
  const activeMessages = activeChatId ? messages[activeChatId] || [] : [];

  return (
    <div className="flex h-dvh w-full bg-white">
      {/* Sidebar / Chat List */}
      <div
        className={cn(
          'h-full w-full shrink-0 border-r border-gray-100 lg:w-[380px]',
          // On mobile, only show when view is chatList
          view !== 'chatList' && 'hidden lg:block',
          // When profile is open on desktop, hide list
          view === 'profile' && 'lg:hidden'
        )}
      >
        <ChatList
          chats={chats}
          contacts={contacts}
          currentUser={user}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onOpenProfile={handleOpenProfile}
        />
      </div>

      {/* Profile View */}
      {view === 'profile' && (
        <div className="h-full w-full">
          <Profile
            user={user}
            onBack={handleBack}
            onUpdateProfile={handleUpdateProfile}
          />
        </div>
      )}

      {/* Chat Room / Empty State */}
      {view !== 'profile' && (
        <div
          className={cn(
            'h-full flex-1',
            // On mobile, only show chat room when a chat is selected
            view !== 'chatRoom' && 'hidden lg:block'
          )}
        >
          {activeChat && activeContact ? (
            <ChatRoom
              chatId={activeChat.id}
              contact={activeContact}
              messages={activeMessages}
              currentUserId={user.id}
              onSendMessage={handleSendMessage}
              onBack={handleBack}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      )}
    </div>
  );
}
