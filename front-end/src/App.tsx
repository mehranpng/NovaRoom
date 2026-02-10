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

export function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [view, setView] = useState<View>('chatList');
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [chats, setChats] = useState<Chat[]>([]);
    const [messages, setMessages] = useState<Record<string, Message[]>>({});
    const [newChatModalOpen, setNewChatModalOpen] = useState(false);

    // WebSocket
    const { sendMessage: sendViaWS } = useWebSocket({
        token: localStorage.getItem('token'),
        onNewMessage: (chatId, newMsg) => {
            setMessages(prev => ({
                ...prev,
                [chatId]: [...(prev[chatId] || []), newMsg]
            }));

            // Update last message in chat list
            setChats(prev =>
                prev.map(chat =>
                    chat.id === chatId
                        ? { ...chat, lastMessage: newMsg }
                        : chat
                )
            );
        }
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
        const data = await apiFetch('/chats');
        setChats(data);
    }, [isAuthenticated]);

    useEffect(() => {
        if (isAuthenticated) loadChats();
    }, [isAuthenticated, loadChats]);

    const handleSelectChat = useCallback(async (chatId: string) => {
        setActiveChatId(chatId);
        setView('chatRoom');

        try {
            const msgs = await apiFetch(`/chats/${chatId}/messages?limit=100`);
            setMessages(prev => ({ ...prev, [chatId]: msgs }));
        } catch (err) {
            console.error(err);
        }

        loadChats();
    }, [loadChats]);

    const handleSendMessage = useCallback(async (text: string) => {
        if (!activeChatId || !currentUser) return;

        const success = sendViaWS(activeChatId, text);
        if (!success) {
            console.warn("WebSocket not connected");
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
        if (!chat || !currentUser) return { chatId: '', name: 'Unknown', username: '', bio: '', avatar: '', online: false };

        if (chat.otherUser) {
            return {
                chatId: chat.otherUser.username,
                name: chat.otherUser.name,
                username: chat.otherUser.username,
                avatar: chat.otherUser.avatar,
                bio: chat.otherUser.bio || '',
                online: chat.otherUser.online,
            };
        }
        const otherId = chat.participantIds.find(id => id !== currentUser.chatId) || '';
        return { chatId: otherId, name: otherId, username: otherId.toLowerCase(), bio: '', avatar: '', online: false };
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
                    <Profile user={currentUser} onBack={handleBack} onUpdateProfile={async (u) => {
                        await apiFetch('/profile/me', { method: 'PATCH', body: JSON.stringify(u) });
                        setCurrentUser(prev => prev ? { ...prev, ...u } : null);
                    }} />
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
