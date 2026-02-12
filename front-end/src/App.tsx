import { useState, useEffect, useCallback, useRef } from 'react';
import type { Message, View, User, Chat, ChatLastMessage } from './types';
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

            // Keep active chat unread badge cleared even if server data is briefly stale.
            const merged = normalized.map((c) => {
                if (view === 'chatRoom' && activeChatId && c.id === activeChatId) {
                    return { ...c, unreadCount: 0 };
                }
                return c;
            });

            setChats(merged);
        } catch (error) {
            console.error('Failed to load chats', error);
        }
    }, [isAuthenticated, activeChatId, view]);

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
    }, []);

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
            loadChats();
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

    // WebSocket initialization
    const { sendMessage: sendViaWS, editMessage: editViaWS, deleteMessage: deleteViaWS, sendSeen } = useWebSocket({
        token: localStorage.getItem('token'),
        onNewMessage: handleNewMessage,
        onMessageEdited: handleMessageEdited,
        onMessageDeleted: handleMessageDeleted,
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

    useEffect(() => {
        if (isAuthenticated) loadChats();
    }, [isAuthenticated, loadChats]);

    const handleSelectChat = useCallback(async (chatId: string) => {
        setPendingUser(null);
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

    const handleSendMessage = useCallback(async (payload: { text: string; replyToId?: string; editMessageId?: string }) => {
        if (!currentUser) return;
        const text = payload.text;

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
                loadChats();
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

    const handleUserSelectedFromModal = (user: User) => {
        setPendingUser(user);
        setActiveChatId(null);
        setView('chatRoom');
        setNewChatModalOpen(false);
    };

    const handleOpenProfile = () => setView('profile');
    const handleBack = () => {
        setView('chatList');
        setPendingUser(null);
    };

    const handleCloseChat = () => {
        setActiveChatId(null);
        setPendingUser(null);
        setView('chatRoom');
    };

    const handleChatDeleted = (chatId: string) => {
        setChats(prev => prev.filter(c => c.id !== chatId));
        setMessages(prev => {
            const { [chatId]: _, ...rest } = prev;
            return rest;
        });
        setActiveChatId(null);
        setPendingUser(null);
        setView('chatList');
        loadChats();
    };

    // Temporary contact resolver
    const getActiveContact = (): User => {
        if (pendingUser) return pendingUser;

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
                <div className={cx('app__sidebar', view === 'chatRoom' && 'app__sidebar--hidden-mobile')}>
                    <ChatList
                        chats={chats}
                        currentUser={currentUser!}
                        activeChatId={activeChatId}
                        onSelectChat={handleSelectChat}
                        onOpenProfile={handleOpenProfile}
                        onNewChatClick={() => setNewChatModalOpen(true)}
                        onLogout={handleLogout}
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
                    {view === 'chatRoom' && (activeChat || pendingUser) ? (
                        <ChatRoom
                            chatId={activeChat?.id || 'pending'}
                            contact={getActiveContact()}
                            messages={activeChat ? activeMessages : []}
                            currentUserId={currentUser!.chatId}
                            onSendMessage={handleSendMessage}
                            onDeleteMessage={handleDeleteMessage}
                            onBack={handleBack}
                            onCloseChat={handleCloseChat}
                            onChatDeleted={handleChatDeleted}
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
