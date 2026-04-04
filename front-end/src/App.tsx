import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import type { Message, View, User, Chat, ChatLastMessage, FileMetadata } from './types';
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
import { MiniMusicPlayer } from './components/MiniMusicPlayer';
import { MusicPlayerProvider } from './contexts/MusicPlayerContext';
import { cx } from './utils/cx';
import { preloadIosEmojiAssets } from './components/IosEmoji';
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
    const [wsConnected, setWsConnected] = useState(false);
    const [wsReconnectExhausted, setWsReconnectExhausted] = useState(false);

    // When opening a chat from the list, capture its unreadCount BEFORE clearing it,
    // so ChatRoom can scroll to the first unread message and render an unread separator.
    // IMPORTANT: this should be consumed (cleared) after first use, otherwise reopening the chat
    // will keep triggering the unread-jump logic.
    const [openChatUnread, setOpenChatUnread] = useState<{ chatId: string; count: number } | null>(null);

    const consumeOpenChatUnread = useCallback((id: string) => {
        setOpenChatUnread((prev) => {
            if (!prev) return prev;
            if (prev.chatId !== id) return prev;
            return null;
        });
    }, []);

    // AI Chat state
    const [showAIChat, setShowAIChat] = useState(false);
    const [aiMessages, setAIMessages] = useState<Message[]>([]);
    const [aiLoading, setAILoading] = useState(true);
    const [aiTyping, setAITyping] = useState(false);

    // Track if this is the initial load (show skeleton only once)
    const [isInitialChatsLoad, setIsInitialChatsLoad] = useState(true);
    const [messagesLoadedOnce, setMessagesLoadedOnce] = useState<Record<string, boolean>>({});
    const [messagesLoading, setMessagesLoading] = useState<Record<string, boolean>>({});

    const sendSoundRef = useRef<HTMLAudioElement | null>(null);
    const receiveSoundRef = useRef<HTMLAudioElement | null>(null);

    // When user is selected from search, we open the room but do NOT create the chat
    // until the first message is sent.
    const [pendingUser, setPendingUser] = useState<User | null>(null);

    const chatsRef = useRef<Chat[]>([]);
    useEffect(() => {
        chatsRef.current = chats;
    }, [chats]);

    // Keep a ref to activeChatId and view so WebSocket callbacks always read the latest values
    // without needing to be re-created (avoids stale closure bug on unread badge).
    const activeChatIdRef = useRef<string | null>(null);
    const viewRef = useRef<View>('chatList');
    const lastSeenAckMessageIdRef = useRef<Record<string, string>>({});
    useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
    useEffect(() => { viewRef.current = view; }, [view]);

    useEffect(() => {
        const emojiPattern = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
        const found = new Set<string>();

        const pushFromText = (value: string | undefined | null) => {
            if (!value) return;
            const matches = value.match(emojiPattern);
            if (!matches) return;
            matches.forEach((emoji) => found.add(emoji));
        };

        chats.forEach((chat) => {
            pushFromText(chat?.otherUser?.name);
            pushFromText(chat?.otherUser?.bio);
            pushFromText(chat?.lastMessage?.text);
        });

        Object.values(messages).forEach((rows) => {
            rows.slice(-200).forEach((message) => {
                pushFromText(message.text);
                pushFromText(message.replyTo?.text);
                pushFromText(message.reactions?.map((r: any) => r.emoji).join(' '));
            });
        });

        if (found.size > 0) {
            void preloadIosEmojiAssets(Array.from(found));
        }
    }, [chats, messages]);

    useEffect(() => {
        sendSoundRef.current = new Audio('/sounds/send.mp3');
        receiveSoundRef.current = new Audio('/sounds/receive.mp3');

        return () => {
            sendSoundRef.current = null;
            receiveSoundRef.current = null;
        };
    }, []);

    const playChatSound = useCallback((kind: 'send' | 'receive') => {
        if (viewRef.current !== 'chatRoom' || !activeChatIdRef.current) return;

        const audio = kind === 'send' ? sendSoundRef.current : receiveSoundRef.current;
        if (!audio) return;

        audio.currentTime = 0;
        audio.play().catch(() => {
            // Ignore blocked autoplay errors.
        });
    }, []);

    // Track which group chats were freshly created this session so we can
    // keep them pinned at the top until they receive their first real message.
    // Key = chatId, Value = the epoch ms when the user created it.
    const newGroupTimestamps = useRef<Record<string, number>>({});

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

        if (showLoading && isInitialChatsLoad) {
            // skeleton shown via isInitialChatsLoad flag
        }

        try {
            const data = await apiFetch('/chats');

            const normalized: Chat[] = (data as any[]).map((c) => {
                if (!c?.lastMessage) {
                    // No real message yet. Use the creation timestamp recorded when the
                    // user created this group in the current session, so it stays at the
                    // top. Once it falls out of newGroupTimestamps (i.e. the user didn't
                    // just create it) use 0 so it sorts below real conversations.
                    const pinnedTs = newGroupTimestamps.current[c.id] ?? 0;
                    return {
                        ...c,
                        lastMessage: { id: '', text: '', senderId: '', timestamp: pinnedTs },
                    } as Chat;
                }
                return {
                    ...c,
                    lastMessage: {
                        ...c.lastMessage,
                        timestamp: normalizeTimestamp(c.lastMessage.timestamp),
                    },
                } as Chat;
            });

            // Keep active chat unread badge cleared even if server data is briefly stale.
            const currentActiveChatId = activeChatIdRef.current;
            const currentView = viewRef.current;
            const merged = normalized.map((c) => {
                if (currentView === 'chatRoom' && currentActiveChatId && c.id === currentActiveChatId) {
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
    }, [isAuthenticated, isInitialChatsLoad]);

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
        newGroupTimestamps.current = {};
        setOpenChatUnread(null);
        navigate('/login', { replace: true });
    }, [navigate]);

    // WebSocket handlers wrapped in useCallback to prevent infinite reconnection loops
    const handleNewMessage = useCallback((chatId: string, newMsg: Message) => {
        setMessages(prev => {
            const currentMessages = prev[chatId] || [];
            if (currentMessages.some(m => m.id === newMsg.id)) {
                return prev;
            }
            return {
                ...prev,
                [chatId]: [...currentMessages, newMsg]
            };
        });

        const hasChat = chatsRef.current.some(c => c.id === chatId);
        if (!hasChat) {
            loadChats(false);
        }

        // Once a real message arrives for a group that was just created,
        // remove it from the pinned-timestamp registry so future sorts are
        // driven by the actual lastMessage timestamp.
        if (newGroupTimestamps.current[chatId]) {
            delete newGroupTimestamps.current[chatId];
        }

        setChats(prev => {
            const myId = currentUser?.chatId;
            const isIncoming = Boolean(myId) && newMsg.senderId !== myId;
            const isActiveChat = activeChatIdRef.current === chatId && viewRef.current === 'chatRoom';
            const shouldIncrementUnread = isIncoming && !isActiveChat;

            if (isIncoming && isActiveChat) {
                playChatSound('receive');
            }

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
    }, [currentUser?.chatId, loadChats, playChatSound]);

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

    const handleWsReconnectExhausted = useCallback(() => {
        setWsReconnectExhausted(true);
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
    const { sendMessage: sendViaWS, editMessage: editViaWS, deleteMessage: deleteViaWS, sendSeen, reconnectExhausted, reconnectNow } = useWebSocket({
        token: localStorage.getItem('token'),
        onNewMessage: handleNewMessage,
        onMessageEdited: handleMessageEdited,
        onMessageDeleted: handleMessageDeleted,
        onUserStatusChange: handleUserStatusChange,
        onMessagesSeen: handleMessagesSeen,
        onReactionUpdated: handleReactionUpdated,
        onConnectionChange: setWsConnected,
        onReconnectExhausted: handleWsReconnectExhausted,
    });

    useEffect(() => {
        setWsReconnectExhausted(reconnectExhausted);
    }, [reconnectExhausted]);

    useEffect(() => {
        if (!wsConnected || !isAuthenticated) return;
        setWsReconnectExhausted(false);
        loadChats(false);

        if (!activeChatId) return;
        apiFetch(`/chats/${activeChatId}/messages?limit=100`)
            .then((msgs) => {
                setMessages(prev => ({ ...prev, [activeChatId]: msgs }));
                if (currentUser && activeChatId !== `saved_messages_${currentUser.chatId}`) {
                    sendSeen(activeChatId);
                }
            })
            .catch((err) => console.error('Failed to sync messages after reconnect', err));
    }, [wsConnected, isAuthenticated, loadChats, activeChatId, currentUser, sendSeen]);

    // AI WebSocket initialization
    const { sendMessage: sendAIMessage } = useAIWebSocket({
        token: localStorage.getItem('token'),
        onNewMessage: handleNewAIMessage,
    });

    // Check auth on mount
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
        localStorage.setItem('token', token);
        setCurrentUser(user);
        setIsAuthenticated(true);
        navigate('/', { replace: true });
    };

    const handleRegisterSuccess = (user: User, token: string) => {
        localStorage.setItem('token', token);
        setCurrentUser(user);
        setIsAuthenticated(true);
        navigate('/', { replace: true });
    };

    useEffect(() => {
        if (isAuthenticated) loadChats();
    }, [isAuthenticated, loadChats]);

    // Allow child components (e.g., ContactInfo group edit) to request a chat-list refresh.
    useEffect(() => {
        if (!isAuthenticated) return;
        const handler = () => {
            loadChats(false);
        };
        window.addEventListener('novaroom:refresh_chats', handler as any);
        return () => window.removeEventListener('novaroom:refresh_chats', handler as any);
    }, [isAuthenticated, loadChats]);

    const handleSelectChat = useCallback(async (chatId: string) => {
        setPendingUser(null);
        setShowAIChat(false);

        // Capture unreadCount BEFORE clearing so ChatRoom can use it.
        const openingUnread = chatsRef.current.find(c => c.id === chatId)?.unreadCount || 0;
        setOpenChatUnread({ chatId, count: openingUnread });

        setActiveChatId(chatId);
        setView('chatRoom');

        setChats(prev => prev.map(c => (c.id === chatId ? { ...c, unreadCount: 0 } : c)));

        const shouldShowSkeleton = !messagesLoadedOnce[chatId];
        if (shouldShowSkeleton) {
            setMessagesLoading(prev => ({ ...prev, [chatId]: true }));
        }

        try {
            const msgs = await apiFetch(`/chats/${chatId}/messages?limit=100`);
            setMessages(prev => ({ ...prev, [chatId]: msgs }));
            setMessagesLoadedOnce(prev => ({ ...prev, [chatId]: true }));

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

    useEffect(() => {
        if (!activeChatId || !currentUser) return;
        if (view !== 'chatRoom') return;
        if (activeChatId === `saved_messages_${currentUser.chatId}`) return;

        const activeMsgs = messages[activeChatId] || [];
        if (!activeMsgs.length) return;

        const lastMsg = activeMsgs[activeMsgs.length - 1];
        if (!lastMsg || lastMsg.senderId === currentUser.chatId) return;

        const ackKey = `${activeChatId}:${lastMsg.id}`;
        if (lastSeenAckMessageIdRef.current[activeChatId] === ackKey) return;

        lastSeenAckMessageIdRef.current[activeChatId] = ackKey;
        sendSeen(activeChatId);
    }, [messages, activeChatId, currentUser, view, sendSeen]);

    const handleSendMessage = useCallback(async (payload: { text: string; replyToId?: string; editMessageId?: string; file?: FileMetadata }) => {
        if (!currentUser) return;
        const text = payload.text;

        const savedMessagesId = `saved_messages_${currentUser.chatId}`;
        if (activeChatId === savedMessagesId) {
            const success = sendViaWS(savedMessagesId, text, payload.replyToId, payload.file);
            if (!success) console.warn('WebSocket not connected');
            if (success) playChatSound('send');
            loadChats(false);
            return;
        }

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

                const success = sendViaWS(createdChatId, text, payload.replyToId, payload.file);
                if (!success) console.warn('WebSocket not connected');
                if (success) playChatSound('send');

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

        const success = sendViaWS(activeChatId, text, payload.replyToId, payload.file);
        if (!success) console.warn('WebSocket not connected');
        if (success) playChatSound('send');
    }, [activeChatId, currentUser, pendingUser, sendViaWS, editViaWS, loadChats, playChatSound]);

    const handleDeleteMessage = useCallback((messageId: string) => {
        if (!activeChatId) return;
        deleteViaWS(activeChatId, messageId);
    }, [activeChatId, deleteViaWS]);

    const handleDeleteAIMessage = useCallback(async (messageId: string) => {
        try {
            await apiFetch(`/ai/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
            setAIMessages(prev => prev.filter(m => m.id !== messageId));
        } catch (error) {
            console.error('Failed to delete AI message:', error);
            alert('حذف پیام با خطا مواجه شد');
        }
    }, []);

    const handleUserSelectedFromModal = useCallback((user: User) => {
        setNewChatModalOpen(false);

        const myId = currentUser?.chatId;
        if (myId) {
            const existing = chatsRef.current.find((c) => {
                // اگر گروه بود، به عنوان چت خصوصی حساب نشه
                if ((c as any)?.chatType === 'group') return false;

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

        setPendingUser(user);
        setActiveChatId(null);
        setShowAIChat(false);
        setView('chatRoom');
    }, [currentUser?.chatId, handleSelectChat]);

    const handleCreateGroup = useCallback(async (groupName: string) => {
        try {
            const res = await apiFetch('/groups', {
                method: 'POST',
                body: JSON.stringify({ name: groupName }),
            });

            if (res?.chatId) {
                // Record the creation time for this group so loadChats can
                // keep it pinned at the top until a real message arrives.
                const createdAt = Date.now();
                newGroupTimestamps.current[res.chatId] = createdAt;

                const newGroupChat: Chat = {
                    id: res.chatId,
                    participantIds: [currentUser?.chatId ?? ''],
                    chatType: 'group',
                    otherUser: {
                        chatId: res.chatId,
                        name: groupName,
                        username: '',
                        bio: '',
                        avatar: '',
                        online: false,
                        verified: false,
                    },
                    lastMessage: {
                        id: '',
                        text: 'گروه ساخته شد',
                        senderId: currentUser?.chatId ?? '',
                        timestamp: createdAt,
                    },
                    unreadCount: 0,
                };
                // Prepend and remove any stale duplicate with the same id
                setChats(prev => [newGroupChat, ...prev.filter(c => c.id !== res.chatId)]);
            }

            // Sync from server — loadChats will use newGroupTimestamps to keep
            // the group pinned even though the server returns no lastMessage.
            await loadChats(false);
            return res;
        } catch (error) {
            console.error(error);
            alert('ساخت گروه با خطا مواجه شد');
        }
    }, [loadChats, currentUser?.chatId]);

    const handleJoinGroup = useCallback(async (inviteCode: string) => {
        try {
            const res = await apiFetch('/groups/join', {
                method: 'POST',
                body: JSON.stringify({ inviteCode }),
            });

            await loadChats(false);
            setNewChatModalOpen(false);

            if (res?.chatId) {
                handleSelectChat(res.chatId);
            }
        } catch (error) {
            console.error(error);
            throw error;
        }
    }, [loadChats, handleSelectChat]);

    useEffect(() => {
        if (!isAuthenticated) return;

        const url = new URL(window.location.href);
        const inviteParam = url.searchParams.get('groupInvite');
        const pathMatch = url.pathname.match(/\/group\/([a-zA-Z0-9]+)/);
        const code = (inviteParam || pathMatch?.[1] || '').trim();

        if (!code) return;

        handleJoinGroup(code);
        url.searchParams.delete('groupInvite');
        window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    }, [isAuthenticated, handleJoinGroup]);

    const handleOpenProfile = () => setView('profile');
    const handleBack = () => {
        setView('chatList');
        setPendingUser(null);
        setShowAIChat(false);
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
        delete newGroupTimestamps.current[chatId];
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

        const success = sendAIMessage(text);
        if (!success) {
            console.warn('Failed to send message to AI');
            setAITyping(false);
        }
    }, [currentUser, sendAIMessage]);

    const getActiveContact = (): User => {
        if (pendingUser) return pendingUser;

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
                registrationDate: (chat.otherUser as any)?.registrationDate,
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

    // --- Unauthenticated routes ---
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

    // --- Authenticated: redirect away from auth pages ---
    const authPages = ['/login', '/register', '/forgot-password'];
    const isOnAuthPage = authPages.some(p => window.location.pathname.startsWith(p));
    if (isOnAuthPage) {
        return <Navigate to="/" replace />;
    }

    const activeChat = chats.find(c => c.id === activeChatId) || null;
    const activeMessages = activeChatId ? messages[activeChatId] || [] : [];
    const activeMessagesLoading = activeChatId ? messagesLoading[activeChatId] || false : false;
    const isSavedMessagesActive = currentUser && activeChatId === `saved_messages_${currentUser.chatId}`;

    const initialUnreadCount = openChatUnread?.chatId && openChatUnread.chatId === (activeChatId || 'pending')
        ? openChatUnread.count
        : 0;

    return (
        <MusicPlayerProvider>
            <MiniMusicPlayer />
            <div className="app">
                {view !== 'profile' && (
                    <div className={cx('app__sidebar', view === 'chatRoom' && 'app__sidebar--hidden-mobile')}>
                        <ChatList
                            chats={chats}
                            currentUser={currentUser!}
                            activeChatId={activeChatId}
                            wsConnected={wsConnected}
                            wsReconnectExhausted={wsReconnectExhausted}
                            onSelectChat={handleSelectChat}
                            onOpenProfile={handleOpenProfile}
                            onNewChatClick={() => setNewChatModalOpen(true)}
                            onLogout={handleLogout}
                            onOpenAIChat={handleOpenAIChat}
                            onOpenSavedMessages={handleOpenSavedMessages}
                            onReconnectNow={reconnectNow}
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
                                onDeleteMessage={handleDeleteAIMessage}
                                onBack={handleBack}
                                loading={aiLoading}
                                isTyping={aiTyping}
                                chats={chats}
                                onSelectChat={handleSelectChat}
                            />
                        ) : view === 'chatRoom' && (activeChat || pendingUser || isSavedMessagesActive) ? (
                            <ChatRoom
                                chatId={activeChatId || 'pending'}
                                contact={getActiveContact()}
                                messages={activeMessages}
                                currentUserId={currentUser!.chatId}
                                currentUser={currentUser}
                                onSendMessage={handleSendMessage}
                                onDeleteMessage={handleDeleteMessage}
                                onBack={handleBack}
                                onCloseChat={handleCloseChat}
                                onChatDeleted={handleChatDeleted}
                                loading={activeMessagesLoading}
                                chats={chats}
                                onSelectChat={handleSelectChat}
                                onOpenDirectChat={(user) => handleUserSelectedFromModal(user)}
                                onOpenProfile={handleOpenProfile}
                                initialUnreadCount={initialUnreadCount}
                                onConsumeInitialUnread={consumeOpenChatUnread}
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
                    onCreateGroup={handleCreateGroup}
                    onJoinGroup={handleJoinGroup}
                    currentUser={currentUser}
                />
            </div>
        </MusicPlayerProvider>
    );
}
