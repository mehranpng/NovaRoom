import { useState, useEffect, useCallback } from 'react';
import type { Message, View, User, Chat } from './types';
import { apiFetch } from './config/api';
import { useWebSocket } from './hooks/useWebSocket';
import { ChatList } from './components/ChatList';
import { ChatRoom } from './components/ChatRoom';
import { Profile } from './components/Profile';
import { EmptyState } from './components/EmptyState';
import { Login } from './components/Login';
import { NewChatModal } from './components/NewChatModal';
import { cx } from './utils/cx';
import './App.css';

const normalizeTimestamp = (ts: unknown): number => {
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
    if (typeof ts === 'string') {
        const parsed = Date.parse(ts);
        return Number.isFinite(parsed) ? parsed : Date.now();
    }
    if (ts instanceof Date) return ts.getTime();
    return Date.now();
};

export function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [view, setView] = useState<View>('chatList');
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [chats, setChats] = useState<Chat[]>([]);
    const [messages, setMessages] = useState<Record<string, Message[]>>({});
    const [newChatModalOpen, setNewChatModalOpen] = useState(false);

    // WebSocket handlers wrapped in useCallback to prevent infinite reconnection loops
    const handleNewMessage = useCallback((chatId: string, newMsg: Message) => {
        setMessages(prev => {
            const currentMessages = prev[chatId] || [];
            // Prevent duplicate messages
            if (currentMessages.some(m => m.id === newMsg.id)) {
                return prev;
            }
            return {
                ...prev,
                [chatId]: [...currentMessages, newMsg]
            };
        });

        // Update last message + unread counter in chat list
        setChats(prev => {
            const myId = currentUser?.chatId;
            const isIncoming = Boolean(myId) && newMsg.senderId !== myId;
            const shouldIncrementUnread = isIncoming && (view !== 'chatRoom' || activeChatId !== chatId);

            let found = false;
            const updated = prev.map(chat => {
                if (chat.id !== chatId) return chat;
                found = true;
                return {
                    ...chat,
                    lastMessage: {
                        text: newMsg.text,
                        senderId: newMsg.senderId,
                        timestamp: newMsg.timestamp,
                    },
                    unreadCount: shouldIncrementUnread ? (chat.unreadCount || 0) + 1 : chat.unreadCount,
                };
            });

            return found ? updated : prev;
        });
    }, [currentUser?.chatId, view, activeChatId]);

    const handleUserStatusChange = useCallback((userId: string, online: boolean) => {
        setChats(prev => prev.map(chat => {
            if (chat.otherUser && (chat.otherUser.username === userId || chat.participantIds.includes(userId))) {
                return { ...chat, otherUser: { ...chat.otherUser, online } };
            }
            return chat;
        }));
    }, []);

    const handleMessagesSeen = useCallback((chatId: string) => {
        setMessages(prev => {
            if (!prev[chatId]) return prev;
            return {
                ...prev,
                [chatId]: prev[chatId].map(m => ({ ...m, seen: true }))
            };
        });
    }, []);

    // WebSocket initialization
    const { sendMessage: sendViaWS, sendSeen } = useWebSocket({
        token: localStorage.getItem('token'),
        onNewMessage: handleNewMessage,
        onUserStatusChange: handleUserStatusChange,
        onMessagesSeen: handleMessagesSeen
    });

    // Check auth
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            apiFetch('/profile/me')
                .then(user => {
                    setCurrentUser(user);
                    setIsAuthenticated(true);
                })
                .catch(() => localStorage.removeItem('token'));
        }
    }, []);

    const handleLoginSuccess = (user: User, token: string) => {
        setCurrentUser(user);
        setIsAuthenticated(true);
        localStorage.setItem('token', token);
    };

    const loadChats = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const data = await apiFetch('/chats');
            const normalized: Chat[] = (data as any[]).map((c) => {
                if (!c?.lastMessage) return c as Chat;
                return {
                    ...c,
                    lastMessage: {
                        ...c.lastMessage,
                        timestamp: normalizeTimestamp(c.lastMessage.timestamp),
                    }
                } as Chat;
            });
            setChats(normalized);
        } catch (error) {
            console.error('Failed to load chats', error);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (isAuthenticated) loadChats();
    }, [isAuthenticated, loadChats]);

    const handleSelectChat = useCallback(async (chatId: string) => {
        setActiveChatId(chatId);
        setView('chatRoom');

        // Optimistic: remove unread badge immediately
        setChats(prev => prev.map(c => (c.id === chatId ? { ...c, unreadCount: 0 } : c)));

        try {
            const msgs = await apiFetch(`/chats/${chatId}/messages?limit=100`);
            setMessages(prev => ({ ...prev, [chatId]: msgs }));
            sendSeen(chatId);
        } catch (err) {
            console.error(err);
        }

        loadChats();
    }, [loadChats, sendSeen]);

    const handleSendMessage = useCallback(async (text: string) => {
        if (!activeChatId || !currentUser) return;

        const success = sendViaWS(activeChatId, text);
        if (!success) {
            console.warn('WebSocket not connected');
        }
    }, [activeChatId, currentUser, sendViaWS]);

    const handleNewChatCreated = (chatId: string) => {
        setActiveChatId(chatId);
        setView('chatRoom');
        setNewChatModalOpen(false);
        loadChats();
    };

    const handleOpenProfile = () => setView('profile');
    const handleBack = () => setView('chatList');

    // Temporary contact resolver
    const getActiveContact = (): User => {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat || !currentUser) {
            return { chatId: '', name: 'Unknown', username: '', bio: '', avatar: '', online: false };
        }

        if (chat.otherUser) {
            return {
                chatId: chat.otherUser.chatId ?? chat.otherUser.username ?? '',
                name: chat.otherUser.name ?? 'Unknown',
                username: chat.otherUser.username ?? '',
                avatar: chat.otherUser.avatar ?? '',
                bio: chat.otherUser.bio ?? '',
                online: Boolean(chat.otherUser.online),
            };
        }

        const otherId = chat.participantIds.find(id => id !== currentUser.chatId) || '';
        return {
            chatId: otherId,
            name: otherId || 'Unknown',
            username: otherId ? otherId.toLowerCase() : '',
            bio: '',
            avatar: '',
            online: false,
        };
    };

    if (!isAuthenticated) {
        return <Login onLoginSuccess={handleLoginSuccess} />;
    }

    const activeChat = chats.find(c => c.id === activeChatId) || null;
    const activeMessages = activeChatId ? messages[activeChatId] || [] : [];

    return (
        <div className="app">
            {view !== 'profile' && (
                <div className="app__sidebar">
                    <ChatList
                        chats={chats}
                        currentUser={currentUser!}
                        activeChatId={activeChatId}
                        onSelectChat={handleSelectChat}
                        onOpenProfile={handleOpenProfile}
                        onNewChatClick={() => setNewChatModalOpen(true)}
                    />
                </div>
            )}

            {view === 'profile' && currentUser && (
                <div className="app__main">
                    <Profile
                        user={currentUser}
                        onBack={handleBack}
                        onUpdateProfile={async (u) => {
                            await apiFetch('/profile/me', { method: 'PATCH', body: JSON.stringify(u) });
                            setCurrentUser(prev => (prev ? { ...prev, ...u } : null));
                        }}
                    />
                </div>
            )}

            {view !== 'profile' && (
                <div className={cx('app__main')}>
                    {activeChat ? (
                        <ChatRoom
                            chatId={activeChat.id}
                            contact={getActiveContact()}
                            messages={activeMessages}
                            currentUserId={currentUser!.chatId}
                            onSendMessage={handleSendMessage}
                            onBack={handleBack}
                        />
                    ) : (
                        <EmptyState />
                    )}
                </div>
            )}

            <NewChatModal
                isOpen={newChatModalOpen}
                onClose={() => setNewChatModalOpen(false)}
                onChatCreated={handleNewChatCreated}
                currentUserChatId={currentUser!.chatId}
            />
        </div>
    );
}
