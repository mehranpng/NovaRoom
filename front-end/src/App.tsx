import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import type { Message, View, User, Chat, ChatLastMessage } from './types';
import { apiFetch } from './config/api';
import { useWebSocket } from './hooks/useWebSocket';
import { useAIWebSocket } from './hooks/useAIWebSocket';
import { ChatList } from './components/ChatList';
import { ChatRoom } from './components/ChatRoom';
import { AIChatRoom } from './components/AIChatRoom';
import { Profile } from './components/Profile';
import { EmptyState } from './components/EmptyState';
import { Login } from './components/Login';
import { Register } from './components/Register';
import { ForgotPassword } from './components/ForgotPassword';
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
    const navigate = useNavigate();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [view, setView] = useState<View>('chatList');
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [chats, setChats] = useState<Chat[]>([]);
    const [messages, setMessages] = useState<Record<string, Message[]>>({});
    const [newChatModalOpen, setNewChatModalOpen] = useState(false);

    // AI Chat state
    const [showAIChat, setShowAIChat] = useState(false);
    const [aiMessages, setAIMessages] = useState<Message[]>([]);
    const [aiLoading, setAILoading] = useState(true);
    const [aiTyping, setAITyping] = useState(false);

    // Track if this is the initial load (show skeleton only once)
    const [isInitialChatsLoad, setIsInitialChatsLoad] = useState(true);
    const [messagesLoadedOnce, setMessagesLoadedOnce] = useState<Record<string, boolean>>({});
    const [messagesLoading, setMessagesLoading] = useState<Record<string, boolean>>({});

    // When user is selected from search, we open the room but do NOT create the chat
    // until the first message is sent.
    const [pendingUser, setPendingUser] = useState<User | null>(null);

    const chatsRef = useRef<Chat[]>([]);
    useEffect(() => {
        chatsRef.current = chats;
    }, [chats]);

    // Mobile keyboard/viewport fix: keep app sized to VisualViewport when available.
    useEffect(() => {
        const apply = () => {
            const vv = window.visualViewport;
            const height = Math.round(vv?.height ?? window.innerHeight);
            const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;

            document.documentElement.style.setProperty('--app-height', `${height}px`);
            document.documentElement.style.setProperty('--keyboard-offset', `${kb}px`);
        };

        apply();

        window.addEventListener('resize', apply);
        window.visualViewport?.addEventListener('resize', apply);
        window.visualViewport?.addEventListener('scroll', apply);

        return () => {
            window.removeEventListener('resize', apply);
            window.visualViewport?.removeEventListener('resize', apply);
            window.visualViewport?.removeEventListener('scroll', apply);
        };
    }, []);

    // Load AI chat history
    useEffect(() => {
        if (!isAuthenticated) return;

        const loadAIMessages = async () => {
            try {
                setAILoading(true);
                const data = await apiFetch('/ai/messages?limit=100');
                const messagesWithChatId = data.map((msg: any) => ({
                    ...msg,
                    chatId: 'ai_chat',
                    seen: true,
                }));
                setAIMessages(messagesWithChatId);
            } catch (error) {
                console.error('Failed to load AI messages:', error);
            } finally {
                setAILoading(false);
            }
        };

        loadAIMessages();
    }, [isAuthenticated]);

    const loadChats = useCallback(async (showLoading = true) => {
        if (!isAuthenticated) return;

        // Only show skeleton on initial load
        if (showLoading && isInitialChatsLoad) {
            // Will be set to false after first load
        }

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

            // Keep active chat unread badge cleared even if server data is briefly stale.
            const merged = normalized.map((c) => {
                if (view === 'chatRoom' && activeChatId && c.id === activeChatId) {
                    return { ...c, unreadCount: 0 };
                }
                return c;
            });

            setChats(merged);
            setIsInitialChatsLoad(false);
        } catch (error) {
            console.error('Failed to load chats', error);
            setIsInitialChatsLoad(false);
        }
    }, [isAuthenticated, activeChatId, view, isInitialChatsLoad]);

    const handleLogout = useCallback(() => {
        localStorage.removeItem('token');
        setIsAuthenticated(false);
        setCurrentUser(null);
        setView('chatList');
        setActiveChatId(null);
        setPendingUser(null);
        setChats([]);
        setMessages({});
        setNewChatModalOpen(false);
        setIsInitialChatsLoad(true);
        setMessagesLoadedOnce({});
        setShowAIChat(false);
        setAIMessages([]);
        navigate('/login', { replace: true });
    }, [navigate]);

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

        // If this message belongs to a chat that doesn't exist in our list yet
        // (first message of a brand-new conversation), fetch chats so it appears
        // in the sidebar without a refresh.
        const hasChat = chatsRef.current.some(c => c.id === chatId);
        if (!hasChat) {
            loadChats(false);
        }

        // Update last message + unread counter in chat list
        setChats(prev => {
            const myId = currentUser?.chatId;
            const isIncoming = Boolean(myId) && newMsg.senderId !== myId;
            const shouldIncrementUnread = isIncoming && (view !== 'chatRoom' || activeChatId !== chatId);

            return prev.map(chat => {
                if (chat.id !== chatId) return chat;
                return {
                    ...chat,
                    lastMessage: {
                        id: newMsg.id,
                        text: newMsg.text,
                        senderId: newMsg.senderId,
                        timestamp: newMsg.timestamp,
                    },
                    unreadCount: shouldIncrementUnread ? (chat.unreadCount || 0) + 1 : chat.unreadCount,
                };
            });
        });
    }, [currentUser?.chatId, view, activeChatId, loadChats]);

    const handleMessageEdited = useCallback((chatId: string, updated: Message) => {
        setMessages(prev => {
            const arr = prev[chatId];
            if (!arr) return prev;
            return {
                ...prev,
                [chatId]: arr.map(m => (m.id === updated.id ? { ...m, ...updated } : m))
            };
        });

        setChats(prev => prev.map(c => {
            if (c.id !== chatId) return c;
            if (!c.lastMessage || (c.lastMessage as ChatLastMessage).id !== updated.id) return c;
            return {
                ...c,
                lastMessage: {
                    ...(c.lastMessage as ChatLastMessage),
                    text: updated.text,
                }
            };
        }));
    }, []);

    const handleMessageDeleted = useCallback((chatId: string, messageId: string, lastMessage?: any) => {
        setMessages(prev => {
            const arr = prev[chatId];
            if (!arr) return prev;
            return {
                ...prev,
                [chatId]: arr.filter(m => m.id !== messageId)
            };
        });

        if (lastMessage) {
            setChats(prev => prev.map(c => {
                if (c.id !== chatId) return c;
                return {
                    ...c,
                    lastMessage: {
                        ...lastMessage,
                        timestamp: normalizeTimestamp(lastMessage.timestamp),
                    }
                };
            }));
        } else {
            setChats(prev => prev.map(c => {
                if (c.id !== chatId) return c;
                return { ...c, lastMessage: null };
            }));
        }
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

        // If messages are seen, clear unread badge immediately.
        setChats(prev => prev.map(c => (c.id === chatId ? { ...c, unreadCount: 0 } : c)));
    }, []);

    const handleReactionUpdated = useCallback((chatId: string, messageId: string, reactions: any[]) => {
        setMessages(prev => {
            const arr = prev[chatId];
            if (!arr) return prev;
            return {
                ...prev,
                [chatId]: arr.map(m => (m.id === messageId ? { ...m, reactions } : m))
            };
        });
    }, []);


    // AI WebSocket handlers
    const handleNewAIMessage = useCallback((message: any) => {
        const messageWithChatId: Message = {
            ...message,
            chatId: 'ai_chat',
            seen: true,
        };
        setAIMessages(prev => [...prev, messageWithChatId]);
        setAITyping(false);
    }, []);

    // WebSocket initialization
    const { sendMessage: sendViaWS, editMessage: editViaWS, deleteMessage: deleteViaWS, sendSeen } = useWebSocket({
        token: localStorage.getItem('token'),
        onNewMessage: handleNewMessage,
        onMessageEdited: handleMessageEdited,
        onMessageDeleted: handleMessageDeleted,
        onUserStatusChange: handleUserStatusChange,
        onMessagesSeen: handleMessagesSeen,
        onReactionUpdated: handleReactionUpdated  // ← ADD THIS LINE
    });


    // AI WebSocket initialization
    const { sendMessage: sendAIMessage } = useAIWebSocket({
        token: localStorage.getItem('token'),
        onNewMessage: handleNewAIMessage,
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
        navigate('/', { replace: true });
    };

    const handleRegisterSuccess = (user: User, token: string) => {
        setCurrentUser(user);
        setIsAuthenticated(true);
        localStorage.setItem('token', token);
        navigate('/', { replace: true });
    };

    useEffect(() => {
        if (isAuthenticated) loadChats();
    }, [isAuthenticated, loadChats]);

    const handleSelectChat = useCallback(async (chatId: string) => {
        setPendingUser(null);
        setShowAIChat(false);
        setActiveChatId(chatId);
        setView('chatRoom');

        // Optimistic: remove unread badge immediately
        setChats(prev => prev.map(c => (c.id === chatId ? { ...c, unreadCount: 0 } : c)));

        // Only show skeleton if this chat has never been loaded before
        const shouldShowSkeleton = !messagesLoadedOnce[chatId];
        if (shouldShowSkeleton) {
            setMessagesLoading(prev => ({ ...prev, [chatId]: true }));
        }

        try {
            const msgs = await apiFetch(`/chats/${chatId}/messages?limit=100`);
            // API already returns messages in correct order (oldest first, newest last)
            setMessages(prev => ({ ...prev, [chatId]: msgs }));
            setMessagesLoadedOnce(prev => ({ ...prev, [chatId]: true }));

            // Don't send seen for saved messages
            if (currentUser && chatId !== `saved_messages_${currentUser.chatId}`) {
                sendSeen(chatId);
            }
        } catch (err) {
            console.error(err);
        } finally {
            if (shouldShowSkeleton) {
                setMessagesLoading(prev => ({ ...prev, [chatId]: false }));
            }
        }

        loadChats(false);
    }, [loadChats, sendSeen, messagesLoadedOnce, currentUser]);

    const handleSendMessage = useCallback(async (payload: { text: string; replyToId?: string; editMessageId?: string }) => {
        if (!currentUser) return;
        const text = payload.text;

        // Check if this is saved messages chat
        const savedMessagesId = `saved_messages_${currentUser.chatId}`;
        if (activeChatId === savedMessagesId) {
            // Send message to saved messages
            const success = sendViaWS(savedMessagesId, text, payload.replyToId);
            if (!success) {
                console.warn('WebSocket not connected');
            }
            // Reload chats to update the saved messages in the list
            loadChats(false);
            return;
        }

        // If we are in a "pending" chat (selected from search), create the chat now
        // (only on first message) then send.
        if (!activeChatId && pendingUser) {
            if (payload.editMessageId) return;

            try {
                const res = await apiFetch('/chats', {
                    method: 'POST',
                    body: JSON.stringify({ targetChatId: pendingUser.chatId }),
                });

                const createdChatId = res.chatId as string;

                setChats(prev => {
                    if (prev.some(c => c.id === createdChatId)) return prev;
                    const newChat: Chat = {
                        id: createdChatId,
                        participantIds: [currentUser.chatId, pendingUser.chatId],
                        otherUser: pendingUser,
                        unreadCount: 0,
                    };
                    return [newChat, ...prev];
                });

                setActiveChatId(createdChatId);
                setPendingUser(null);
                setView('chatRoom');

                const success = sendViaWS(createdChatId, text, payload.replyToId);
                if (!success) {
                    console.warn('WebSocket not connected');
                }

                // Sync chat list (server has the authoritative otherUser/lastMessage/unreadCount)
                loadChats(false);
                return;
            } catch (err) {
                console.error(err);
                alert('Failed to create chat');
                return;
            }
        }

        if (!activeChatId) return;

        if (payload.editMessageId) {
            const success = editViaWS(activeChatId, payload.editMessageId, text);
            if (!success) console.warn('WebSocket not connected');
            return;
        }

        const success = sendViaWS(activeChatId, text, payload.replyToId);
        if (!success) {
            console.warn('WebSocket not connected');
        }
    }, [activeChatId, currentUser, pendingUser, sendViaWS, editViaWS, loadChats]);

    const handleDeleteMessage = useCallback((messageId: string) => {
        if (!activeChatId) return;
        deleteViaWS(activeChatId, messageId);
    }, [activeChatId, deleteViaWS]);

    const handleUserSelectedFromModal = useCallback((user: User) => {
        setNewChatModalOpen(false);

        // If the chat already exists, open it immediately so previous messages show.
        const myId = currentUser?.chatId;
        if (myId) {
            const existing = chatsRef.current.find((c) => {
                const hasParticipants = Array.isArray(c.participantIds) && c.participantIds.includes(myId) && c.participantIds.includes(user.chatId);
                if (hasParticipants) return true;

                const ou: any = (c as any).otherUser;
                if (!ou) return false;

                const ouChatId = ou.chatId ?? ou.username ?? '';
                if (ouChatId && user.chatId && ouChatId === user.chatId) return true;

                if (ou.username && user.username) {
                    return String(ou.username).toLowerCase() === String(user.username).toLowerCase();
                }

                return false;
            });

            if (existing?.id) {
                handleSelectChat(existing.id);
                return;
            }
        }

        // Otherwise stay in "pending" mode (chat is created on first message).
        setPendingUser(user);
        setActiveChatId(null);
        setShowAIChat(false);
        setView('chatRoom');
    }, [currentUser?.chatId, handleSelectChat]);

    const handleOpenProfile = () => setView('profile');
    const handleBack = () => {
        setView('chatList');
        setPendingUser(null);
        setShowAIChat(false);
        // Clear active chat when going back so messages don't get marked as seen
        setActiveChatId(null);
    };

    const handleCloseChat = () => {
        setActiveChatId(null);
        setPendingUser(null);
        setShowAIChat(false);
        setView('chatRoom');
    };

    const handleChatDeleted = (chatId: string) => {
        setChats(prev => prev.filter(c => c.id !== chatId));
        setMessages(prev => {
            const { [chatId]: _, ...rest } = prev;
            return rest;
        });
        setMessagesLoadedOnce(prev => {
            const { [chatId]: _, ...rest } = prev;
            return rest;
        });
        setActiveChatId(null);
        setPendingUser(null);
        setShowAIChat(false);
        setView('chatList');
        loadChats(false);
    };

    const handleOpenAIChat = () => {
        setActiveChatId(null);
        setPendingUser(null);
        setShowAIChat(true);
        setView('chatRoom');
    };

    const handleOpenSavedMessages = useCallback(() => {
        if (!currentUser) return;
        const savedMessagesId = `saved_messages_${currentUser.chatId}`;
        handleSelectChat(savedMessagesId);
    }, [currentUser, handleSelectChat]);

    const handleSendAIMessage = useCallback((text: string) => {
        if (!currentUser) return;

        // Add user message to UI immediately
        const userMessage: Message = {
            id: `temp-${Date.now()}`,
            chatId: 'ai_chat',
            senderId: currentUser.chatId,
            text,
            timestamp: Date.now(),
            seen: false,
        };

        setAIMessages(prev => [...prev, userMessage]);
        setAITyping(true);

        // Send to AI
        const success = sendAIMessage(text);
        if (!success) {
            console.warn('Failed to send message to AI');
            setAITyping(false);
        }
    }, [currentUser, sendAIMessage]);

    // Temporary contact resolver - updated to handle saved messages even when not in chat list
    const getActiveContact = (): User => {
        if (pendingUser) return pendingUser;

        // Check if this is saved messages FIRST, before looking in chats
        if (currentUser && activeChatId === `saved_messages_${currentUser.chatId}`) {
            return {
                chatId: 'saved',
                name: 'پیام‌های ذخیره شده',
                username: 'saved',
                bio: '',
                avatar: '',
                online: false,
                verified: false,
            };
        }

        const chat = chats.find(c => c.id === activeChatId);
        if (!chat || !currentUser) {
            return { chatId: '', name: 'Unknown', username: '', bio: '', avatar: '', online: false, verified: false };
        }

        if (chat.otherUser) {
            return {
                chatId: chat.otherUser.chatId ?? chat.otherUser.username ?? '',
                name: chat.otherUser.name ?? 'Unknown',
                username: chat.otherUser.username ?? '',
                avatar: chat.otherUser.avatar ?? '',
                bio: chat.otherUser.bio ?? '',
                online: Boolean(chat.otherUser.online),
                verified: Boolean((chat.otherUser as any)?.verified),
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
            verified: false,
        };
    };

    if (!isAuthenticated) {
        return (
            <Routes>
                <Route path="/login" element={
                    <Login
                        onLoginSuccess={handleLoginSuccess}
                        onRegisterClick={() => navigate('/register/email')}
                        onForgotPasswordClick={() => navigate('/forgot-password/request')}
                    />
                } />

                <Route path="/register/*" element={
                    <Register
                        onRegisterSuccess={handleRegisterSuccess}
                        onBackToLogin={() => navigate('/login')}
                    />
                } />

                <Route path="/forgot-password/*" element={
                    <ForgotPassword
                        onBackToLogin={() => navigate('/login')}
                        onResetSuccess={() => navigate('/login')}
                    />
                } />

                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        );
    }

    const activeChat = chats.find(c => c.id === activeChatId) || null;
    const activeMessages = activeChatId ? messages[activeChatId] || [] : [];
    const activeMessagesLoading = activeChatId ? messagesLoading[activeChatId] || false : false;

    // Check if we have saved messages open (even if not in chat list)
    const isSavedMessagesActive = currentUser && activeChatId === `saved_messages_${currentUser.chatId}`;

    return (
        <div className="app">
            {view !== 'profile' && (
                <div className={cx('app__sidebar', view === 'chatRoom' && 'app__sidebar--hidden-mobile')}>
                    <ChatList
                        chats={chats}
                        currentUser={currentUser!}
                        activeChatId={activeChatId}
                        onSelectChat={handleSelectChat}
                        onOpenProfile={handleOpenProfile}
                        onNewChatClick={() => setNewChatModalOpen(true)}
                        onLogout={handleLogout}
                        onOpenAIChat={handleOpenAIChat}
                        onOpenSavedMessages={handleOpenSavedMessages}
                        loading={isInitialChatsLoad}
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
                <div className={cx('app__main', view === 'chatList' && 'app__main--hidden-mobile')}>
                    {view === 'chatRoom' && showAIChat ? (
                        <AIChatRoom
                            messages={aiMessages}
                            currentUserId={currentUser!.chatId}
                            onSendMessage={handleSendAIMessage}
                            onBack={handleBack}
                            loading={aiLoading}
                            isTyping={aiTyping}
                        />
                    ) : view === 'chatRoom' && (activeChat || pendingUser || isSavedMessagesActive) ? (
                        <ChatRoom
                            chatId={activeChatId || 'pending'}
                            contact={getActiveContact()}
                            messages={activeMessages}
                            currentUserId={currentUser!.chatId}
                            onSendMessage={handleSendMessage}
                            onDeleteMessage={handleDeleteMessage}
                            onBack={handleBack}
                            onCloseChat={handleCloseChat}
                            onChatDeleted={handleChatDeleted}
                            loading={activeMessagesLoading}
                        />
                    ) : (
                        <EmptyState />
                    )}
                </div>
            )}

            <NewChatModal
                isOpen={newChatModalOpen}
                onClose={() => setNewChatModalOpen(false)}
                onUserSelected={handleUserSelectedFromModal}
            />
        </div>
    );
}
