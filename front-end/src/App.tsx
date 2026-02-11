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

        // Update last message in chat list
        setChats(prev =>
            prev.map(chat =>
                chat.id === chatId
                    ? { ...chat, lastMessage: newMsg }
                    : chat
            )
        );
    }, []);

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
            setChats(data);
        } catch (error) {
            console.error("Failed to load chats", error);
        }
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
                bio: chat.otherUser.bio || '',\n                online: chat.otherUser.online,\n            };\n        }\n        const otherId = chat.participantIds.find(id => id !== currentUser.chatId) || '';\n        return { chatId: otherId, name: otherId, username: otherId.toLowerCase(), bio: '', avatar: '', online: false };\n    };\n\n\n    if (!isAuthenticated) {\n        return <Login onLoginSuccess={handleLoginSuccess} />;\n    }\n\n    const activeChat = chats.find(c => c.id === activeChatId) || null;\n    const activeMessages = activeChatId ? messages[activeChatId] || [] : [];\n\n    return (\n        <div className=\"app\">\n            {view !== 'profile' && (\n                <div className=\"app__sidebar\">\n                    <ChatList\n                        chats={chats}\n                        currentUser={currentUser!}\n                        activeChatId={activeChatId}\n                        onSelectChat={handleSelectChat}\n                        onOpenProfile={handleOpenProfile}\n                        onNewChatClick={() => setNewChatModalOpen(true)}\n                    />\n                </div>\n            )}\n\n            {view === 'profile' && currentUser && (\n                <div className=\"app__main\">\n                    <Profile user={currentUser} onBack={handleBack} onUpdateProfile={async (u) => {\n                        await apiFetch('/profile/me', { method: 'PATCH', body: JSON.stringify(u) });\n                        setCurrentUser(prev => prev ? { ...prev, ...u } : null);\n                    }} />\n                </div>\n            )}\n\n            {view !== 'profile' && (\n                <div className={cx('app__main')}>\n                    {activeChat ? (\n                        <ChatRoom\n                            chatId={activeChat.id}\n                            contact={getActiveContact()}\n                            messages={activeMessages}\n                            currentUserId={currentUser!.chatId}\n                            onSendMessage={handleSendMessage}\n                            onBack={handleBack}\n                        />\n                    ) : (\n                        <EmptyState />\n                    )}\n                </div>\n            )}\n\n            <NewChatModal\n                isOpen={newChatModalOpen}\n                onClose={() => setNewChatModalOpen(false)}\n                onChatCreated={handleNewChatCreated}\n                currentUserChatId={currentUser!.chatId}\n            />\n        </div>\n    );\n}\n