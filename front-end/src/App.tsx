import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import type { Message, View, User, Chat, ChatLastMessage, FileMetadata, AIChatSummary } from './types';
import { apiFetch } from './config/api';
import { useWebSocket } from './hooks/useWebSocket';
import { ChatList } from './components/ChatList';
import { ChatRoom } from './components/ChatRoom';
import { AIChatRoom } from './components/AIChatRoom';
import { Profile } from './components/Profile';
import { Devices } from './components/Devices';
import { EmptyState } from './components/EmptyState';
import { Login } from './components/Login';
import { Register } from './components/Register';
import { ForgotPassword } from './components/ForgotPassword';
import { NewChatModal } from './components/NewChatModal';
import { MiniMusicPlayer } from './components/MiniMusicPlayer';
import { MusicPlayerProvider } from './contexts/MusicPlayerContext';
import { cx } from './utils/cx';
import { NotificationCenter } from './components/NotificationCenter';
import { notify } from './utils/notificationBus';
import { decryptBioClientSide, decryptMessageClientSide, encryptBioClientSide, encryptChatTextClientSide } from './utils/e2ee';
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

const mergeMessages = (base: Message[], incoming: Message[], mode: 'replace' | 'prepend' | 'append'): Message[] => {
    const byId = new Map<string, Message>();
    if (mode === 'replace') {
        for (const m of incoming) byId.set(m.id, m);
        return Array.from(byId.values()).sort((a, b) => normalizeTimestamp(a.timestamp) - normalizeTimestamp(b.timestamp));
    }
    const combined = mode === 'prepend' ? [...incoming, ...base] : [...base, ...incoming];
    for (const m of combined) byId.set(m.id, m);
    return Array.from(byId.values()).sort((a, b) => normalizeTimestamp(a.timestamp) - normalizeTimestamp(b.timestamp));
};

export function App() {
    const MESSAGE_PAGE_SIZE = 50;
    const navigate = useNavigate();
    const location = useLocation();
    const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('token'));
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [view, setView] = useState<View>('chatList');
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [chats, setChats] = useState<Chat[]>([]);
    const [messages, setMessages] = useState<Record<string, Message[]>>({});
    const [messageRangeState, setMessageRangeState] = useState<Record<string, {
        hasOlder: boolean;
        hasNewer: boolean;
        loadingOlder: boolean;
        loadingNewer: boolean;
        oldestCursor?: { cursorTs: number; cursorId: string } | null;
        newestCursor?: { cursorTs: number; cursorId: string } | null;
    }>>({});
    const [newChatModalOpen, setNewChatModalOpen] = useState(false);
    const [wsConnected, setWsConnected] = useState(false);
    const [wsReconnectExhausted, setWsReconnectExhausted] = useState(false);
    const [typingUserIdsByChat, setTypingUserIdsByChat] = useState<Record<string, string[]>>({});
    const [blockedChatIds, setBlockedChatIds] = useState<string[]>([]);
    const typingTimeoutsRef = useRef<Record<string, number>>({});
    const userPresenceRef = useRef<Record<string, { online: boolean; updatedAt: number }>>({});
    const presenceOfflineGraceTimersRef = useRef<Record<string, number>>({});
    const realtimeRecoveryInFlightRef = useRef(false);

    const isUserBlocked = useCallback((user: Partial<User> | null | undefined): boolean => {
        if (!user) return false;
        const chatId = String(user.chatId || '').trim();
        return Boolean(chatId) && blockedChatIds.includes(chatId);
    }, [blockedChatIds]);

    const toggleBlockUser = useCallback(async (user: User) => {
        const chatId = String(user.chatId || '').trim();
        if (!chatId) return;
        const currentlyBlocked = blockedChatIds.includes(chatId);
        const endpoint = `/profile/me/blocks/${encodeURIComponent(chatId)}`;
        const res = await apiFetch(endpoint, { method: currentlyBlocked ? 'DELETE' : 'POST' });
        const next = Array.isArray(res?.blockedChatIds) ? res.blockedChatIds.map((id: any) => String(id || '').trim()).filter(Boolean) : [];
        setBlockedChatIds(next);
    }, [blockedChatIds]);

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
    const [aiChats, setAIChats] = useState<AIChatSummary[]>([]);
    const [activeAIChatId, setActiveAIChatId] = useState<string | null>(null);
    const [aiMessagesByChat, setAIMessagesByChat] = useState<Record<string, Message[]>>({});
    const [aiLoading, setAILoading] = useState(true);
    const [aiTyping, setAITyping] = useState(false);
    const [aiResponding, setAIResponding] = useState(false);
    const [aiReasoningPending, setAIReasoningPending] = useState(false);
    const [aiRespondingChatId, setAIRespondingChatId] = useState<string | null>(null);
    const [temporaryAIChat, setTemporaryAIChat] = useState(false);

    // Track if this is the initial load (show skeleton only once)
    const [isInitialChatsLoad, setIsInitialChatsLoad] = useState(true);
    const [messagesLoadedOnce, setMessagesLoadedOnce] = useState<Record<string, boolean>>({});
    const [messagesLoading, setMessagesLoading] = useState<Record<string, boolean>>({});

    const sendSoundRef = useRef<HTMLAudioElement | null>(null);
    const receiveSoundRef = useRef<HTMLAudioElement | null>(null);

    // When user is selected from search, we open the room but do NOT create the chat
    // until the first message is sent.
    const [pendingUser, setPendingUser] = useState<User | null>(null);
    const [pendingForwardDrafts, setPendingForwardDrafts] = useState<Record<string, { sourceChatId: string; messageId: string; previewText?: string; previewFile?: FileMetadata | null }>>({});
    const pendingForwardSendHintsRef = useRef<Record<string, number>>({});
    const aiStreamStartedRef = useRef<Record<string, boolean>>({});
    const aiPendingStreamMetaRef = useRef<Record<string, Message>>({});

    const chatsRef = useRef<Chat[]>([]);
    useEffect(() => {
        chatsRef.current = chats;
    }, [chats]);

    // Keep a ref to activeChatId and view so WebSocket callbacks always read the latest values
    // without needing to be re-created (avoids stale closure bug on unread badge).
    const activeChatIdRef = useRef<string | null>(null);
    const viewRef = useRef<View>('chatList');
    const lastSeenAckMessageIdRef = useRef<Record<string, string>>({});
    const chatLoadRequestRef = useRef(0);
    useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
    useEffect(() => { viewRef.current = view; }, [view]);

    useEffect(() => {
        sendSoundRef.current = new Audio('/sounds/send.mp3');
        receiveSoundRef.current = new Audio('/sounds/receive.mp3');
        sendSoundRef.current.preload = 'auto';
        receiveSoundRef.current.preload = 'auto';
        sendSoundRef.current.load();
        receiveSoundRef.current.load();

        return () => {
            sendSoundRef.current = null;
            receiveSoundRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        const loadBlockedUsers = async () => {
            try {
                const res = await apiFetch('/profile/me/blocks');
                if (cancelled) return;
                const next = Array.isArray(res?.blockedChatIds)
                    ? res.blockedChatIds.map((id: any) => String(id || '').trim()).filter(Boolean)
                    : [];
                setBlockedChatIds(next);
            } catch {
                if (cancelled) return;
                setBlockedChatIds([]);
            }
        };
        void loadBlockedUsers();
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated]);

    useEffect(() => {
        let primed = false;
        const primeAudio = () => {
            if (primed) return;
            primed = true;
            const audios = [sendSoundRef.current, receiveSoundRef.current].filter(Boolean) as HTMLAudioElement[];
            audios.forEach((audio) => {
                try {
                    audio.muted = true;
                    const p = audio.play();
                    if (p && typeof p.then === 'function') {
                        p.then(() => {
                            audio.pause();
                            audio.currentTime = 0;
                            audio.muted = false;
                        }).catch(() => {
                            audio.muted = false;
                        });
                    } else {
                        audio.pause();
                        audio.currentTime = 0;
                        audio.muted = false;
                    }
                } catch {
                    audio.muted = false;
                }
            });
            document.removeEventListener('pointerdown', primeAudio, true);
            document.removeEventListener('keydown', primeAudio, true);
        };
        document.addEventListener('pointerdown', primeAudio, true);
        document.addEventListener('keydown', primeAudio, true);
        return () => {
            document.removeEventListener('pointerdown', primeAudio, true);
            document.removeEventListener('keydown', primeAudio, true);
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

    // Load AI chat list
    useEffect(() => {
        if (!isAuthenticated) return;

        const loadAIChats = async () => {
            try {
                setAILoading(true);
                const chatRows = await apiFetch('/ai/chats');
                if (Array.isArray(chatRows) && chatRows.length > 0) {
                    setAIChats(chatRows);
                    setActiveAIChatId((prev) => prev || chatRows[0].id);
                } else {
                    setAIChats([]);
                    setActiveAIChatId(null);
                }
            } catch (error) {
                console.error('Failed to load AI chats:', error);
            } finally {
                setAILoading(false);
            }
        };

        loadAIChats();
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated || !activeAIChatId) return;
        if (Object.prototype.hasOwnProperty.call(aiMessagesByChat, activeAIChatId)) return;
        const loadAIMessages = async () => {
            try {
                setAILoading(true);
                const data = await apiFetch(`/ai/messages?chatId=${encodeURIComponent(activeAIChatId)}&limit=100`);
                const messagesWithChatId = (Array.isArray(data) ? data : []).map((msg: any) => ({
                    ...msg,
                    chatId: msg.aiChatId ?? activeAIChatId,
                    seen: true,
                }));
                setAIMessagesByChat((prev) => ({ ...prev, [activeAIChatId]: messagesWithChatId }));
                const pending = [...messagesWithChatId].reverse().find((m) => m.senderId === 'ai' && m.isStreaming);
                if (pending) {
                    setAITyping(true);
                    setAIResponding(true);
                    setAIRespondingChatId(activeAIChatId);
                    setAIReasoningPending(Boolean(pending.reasoningEnabled && !pending.text));
                    aiPendingStreamMetaRef.current[pending.id] = pending;
                    aiStreamStartedRef.current[pending.id] = Boolean(pending.text);
                }
            } catch (error) {
                console.error('Failed to load AI messages:', error);
            } finally {
                setAILoading(false);
            }
        };
        loadAIMessages();
    }, [isAuthenticated, activeAIChatId, aiMessagesByChat]);

    const loadChats = useCallback(async (showLoading = true) => {
        if (!isAuthenticated) return;

        if (showLoading && isInitialChatsLoad) {
            // skeleton shown via isInitialChatsLoad flag
        }

        try {
            const data = await apiFetch('/chats');

            const normalized: Chat[] = await Promise.all((data as any[]).map(async (c) => {
                const decryptedLastMessage = c?.lastMessage
                    ? await decryptMessageClientSide(c.lastMessage, authToken || '', String(c.id || ''))
                    : null;
                const decryptedOtherBio = c?.otherUser?.chatId
                    ? await decryptBioClientSide(String(c.otherUser.bio || ''), authToken || '', String(c.otherUser.chatId || ''))
                    : c?.otherUser?.bio;
                const otherChatId = String(c?.otherUser?.chatId || '').trim();
                const otherUsername = String(c?.otherUser?.username || '').trim();
                const presenceCandidateIds = [otherChatId, otherUsername].filter(Boolean);
                const presenceMatch = presenceCandidateIds
                    .map((id) => userPresenceRef.current[id])
                    .find(Boolean);
                const resolvedOnline = typeof presenceMatch?.online === 'boolean'
                    ? presenceMatch.online
                    : Boolean(c?.otherUser?.online);
                if (!c?.lastMessage) {
                    // No real message yet. Use the creation timestamp recorded when the
                    // user created this group in the current session, so it stays at the
                    // top. Once it falls out of newGroupTimestamps (i.e. the user didn't
                    // just create it) use 0 so it sorts below real conversations.
                    const pinnedTs = newGroupTimestamps.current[c.id] ?? 0;
                    return {
                        ...c,
                        otherUser: c?.otherUser ? { ...c.otherUser, bio: decryptedOtherBio || '', online: resolvedOnline } : c?.otherUser,
                        lastMessage: { id: '', text: '', senderId: '', timestamp: pinnedTs },
                    } as Chat;
                }
                return {
                    ...c,
                    otherUser: c?.otherUser ? { ...c.otherUser, bio: decryptedOtherBio || '', online: resolvedOnline } : c?.otherUser,
                    lastMessage: {
                        ...decryptedLastMessage,
                        timestamp: normalizeTimestamp(c.lastMessage.timestamp),
                    },
                } as Chat;
            }));

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
    }, [isAuthenticated, isInitialChatsLoad, authToken]);

    useEffect(() => {
        if (!isAuthenticated) return;
        void loadChats(false);
    }, [blockedChatIds, isAuthenticated, loadChats]);

    const handleLogout = useCallback(() => {
        const finalizeLogout = () => {
            localStorage.removeItem('token');
            setAuthToken(null);
            setIsAuthenticated(false);
            setCurrentUser(null);
            setView('chatList');
            setActiveChatId(null);
            setPendingUser(null);
            setChats([]);
            setMessages({});
            setMessageRangeState({});
            setNewChatModalOpen(false);
            setIsInitialChatsLoad(true);
            setMessagesLoadedOnce({});
            setShowAIChat(false);
            setAIChats([]);
            setActiveAIChatId(null);
            setAIMessagesByChat({});
            setTemporaryAIChat(false);
            setAIRespondingChatId(null);
            setPendingForwardDrafts({});
            newGroupTimestamps.current = {};
            setOpenChatUnread(null);
            Object.values(typingTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
            typingTimeoutsRef.current = {};
            Object.values(presenceOfflineGraceTimersRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
            presenceOfflineGraceTimersRef.current = {};
            userPresenceRef.current = {};
            setTypingUserIdsByChat({});
            navigate('/login', { replace: true });
        };

        apiFetch('/auth/logout', { method: 'POST' })
            .catch((err) => {
                console.warn('Logout session cleanup failed:', err);
            })
            .finally(finalizeLogout);
    }, [navigate]);

    const handleTypingStatus = useCallback((chatId: string, userId: string, isTyping: boolean) => {
        if (!chatId || !userId) return;
        if (currentUser?.chatId && userId === currentUser.chatId) return;

        const key = `${chatId}:${userId}`;
        const clearEntry = () => {
            const timeoutId = typingTimeoutsRef.current[key];
            if (timeoutId) {
                window.clearTimeout(timeoutId);
                delete typingTimeoutsRef.current[key];
            }
            setTypingUserIdsByChat((prev) => {
                const chatUsers = prev[chatId] || [];
                if (!chatUsers.includes(userId)) return prev;
                const nextUsers = chatUsers.filter((id) => id !== userId);
                if (nextUsers.length === chatUsers.length) return prev;
                if (nextUsers.length === 0) {
                    const next = { ...prev };
                    delete next[chatId];
                    return next;
                }
                return { ...prev, [chatId]: nextUsers };
            });
        };

        if (!isTyping) {
            clearEntry();
            return;
        }

        setTypingUserIdsByChat((prev) => {
            const chatUsers = prev[chatId] || [];
            if (chatUsers.includes(userId)) return prev;
            return { ...prev, [chatId]: [...chatUsers, userId] };
        });

        if (typingTimeoutsRef.current[key]) {
            window.clearTimeout(typingTimeoutsRef.current[key]);
        }
        typingTimeoutsRef.current[key] = window.setTimeout(() => {
            clearEntry();
        }, 1000);
    }, [currentUser?.chatId]);

    // WebSocket handlers wrapped in useCallback to prevent infinite reconnection loops
    const handleNewMessage = useCallback((chatId: string, newMsg: Message) => {
        let isDuplicateMessage = false;
        let replacedOptimisticMine = false;
        setMessages(prev => {
            const currentMessages = prev[chatId] || [];
            if (newMsg.clientId) {
                const optimisticIdx = currentMessages.findIndex((m) => m.id === newMsg.clientId && m.deliveryStatus === 'sending');
                if (optimisticIdx !== -1) {
                    replacedOptimisticMine = true;
                    const nextMessages = [...currentMessages];
                    nextMessages[optimisticIdx] = { ...newMsg, deliveryStatus: 'sent' };
                    return { ...prev, [chatId]: nextMessages };
                }
            }
            if (currentMessages.some(m => m.id === newMsg.id)) {
                isDuplicateMessage = true;
                return prev;
            }
            return {
                ...prev,
                [chatId]: [...currentMessages, newMsg]
            };
        });

        // Prevent double unread increments / duplicated chat-lastMessage updates
        // when the same message event is delivered more than once.
        if (isDuplicateMessage) return;

        if (replacedOptimisticMine) {
            playChatSound('send');
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate(12);
            }
        }

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
            const hasForwardSendHint = Boolean(newMsg.forwardedFrom) && (pendingForwardSendHintsRef.current[chatId] || 0) > 0;
            if (hasForwardSendHint) {
                pendingForwardSendHintsRef.current[chatId] = Math.max(0, (pendingForwardSendHintsRef.current[chatId] || 0) - 1);
            }
            const isIncoming = Boolean(myId) && newMsg.senderId !== myId && !hasForwardSendHint;
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
                        file: newMsg.file,
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
        const normalizedUserId = String(userId || '').trim();
        if (!normalizedUserId) return;
        const now = Date.now();
        const prevPresence = userPresenceRef.current[normalizedUserId];
        const prevOnline = prevPresence?.online;
        const setPresence = (nextOnline: boolean) => {
            userPresenceRef.current[normalizedUserId] = { online: nextOnline, updatedAt: Date.now() };
        };
        if (presenceOfflineGraceTimersRef.current[normalizedUserId]) {
            window.clearTimeout(presenceOfflineGraceTimersRef.current[normalizedUserId]);
            delete presenceOfflineGraceTimersRef.current[normalizedUserId];
        }
        // Prevent rapid online/offline flapping by delaying "offline" if user was
        // seen online recently. This keeps UI stable while transient reconnects happen.
        if (!online && prevOnline && (now - (prevPresence?.updatedAt || 0)) < 12000) {
            presenceOfflineGraceTimersRef.current[normalizedUserId] = window.setTimeout(() => {
                setPresence(false);
                setChats((prev) => prev.map((chat) => {
                    const ou = chat.otherUser || {};
                    const participantIds = Array.isArray(chat.participantIds) ? chat.participantIds.map((id: any) => String(id || '').trim()) : [];
                    const candidateIds = [
                        String(ou.chatId || '').trim(),
                        String(ou.username || '').trim(),
                        ...participantIds,
                    ].filter(Boolean);
                    if (!candidateIds.includes(normalizedUserId)) return chat;
                    return { ...chat, otherUser: { ...ou, online: false } };
                }));
                delete presenceOfflineGraceTimersRef.current[normalizedUserId];
            }, 3200);
            return;
        }

        setPresence(Boolean(online));
        setChats(prev => prev.map(chat => {
            const ou = chat.otherUser || {};
            const participantIds = Array.isArray(chat.participantIds) ? chat.participantIds.map((id: any) => String(id || '').trim()) : [];
            const candidateIds = [
                String(ou.chatId || '').trim(),
                String(ou.username || '').trim(),
                ...participantIds,
            ].filter(Boolean);
            if (candidateIds.includes(normalizedUserId)) {
                const blockedByMe = Boolean((chat.otherUser as any)?.blockedByMe);
                const blockedByOther = Boolean((chat.otherUser as any)?.blockedByOther);
                if (blockedByMe || blockedByOther) {
                    return { ...chat, otherUser: { ...chat.otherUser, online: false } };
                }
                return { ...chat, otherUser: { ...chat.otherUser, online: Boolean(online) } };
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

    const appendAIMessage = useCallback((aiChatId: string, message: Message) => {
        if (!aiChatId) return;
        setAIMessagesByChat((prev) => {
            const existing = prev[aiChatId] || [];
            if (existing.some((m) => m.id === message.id)) {
                return prev;
            }
            return { ...prev, [aiChatId]: [...existing, message] };
        });
        setAIChats((prev) => {
            const idx = prev.findIndex((c) => c.id === aiChatId);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], updatedAt: Date.now() };
            next.sort((a, b) => b.updatedAt - a.updatedAt);
            return next;
        });
    }, []);

    // AI WebSocket handlers
    const handleNewAIMessage = useCallback((message: any) => {
        const aiChatId = String(message.aiChatId || activeAIChatId || '');
        if (!aiChatId) return;
        const messageWithChatId: Message = {
            ...message,
            chatId: aiChatId,
            seen: true,
        };
        appendAIMessage(aiChatId, messageWithChatId);
        setAITyping(false);
        setAIResponding(false);
        setAIReasoningPending(false);
    }, [activeAIChatId, appendAIMessage]);

    const vibrate = useCallback((pattern: number | number[]) => {
        if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
        navigator.vibrate(pattern);
    }, []);

    const handleAIStreamStart = useCallback((message: any) => {
        const aiChatId = String(message.aiChatId || activeAIChatId || '');
        if (!aiChatId) return;
        const messageWithChatId: Message = {
            ...message,
            chatId: aiChatId,
            seen: true,
            isStreaming: true,
            streamCompleted: false,
            reasoningContent: String(message?.reasoningContent || ''),
            reasoningEnabled: Boolean(message?.reasoningEnabled),
        };
        aiStreamStartedRef.current[messageWithChatId.id] = false;
        aiPendingStreamMetaRef.current[messageWithChatId.id] = messageWithChatId;
        appendAIMessage(aiChatId, messageWithChatId);
        setAITyping(true);
        setAIResponding(true);
        setAIRespondingChatId(aiChatId);
        setAIReasoningPending(Boolean(message?.reasoningEnabled));
    }, [activeAIChatId, appendAIMessage]);

    const handleAIStreamChunk = useCallback((payload: { messageId: string; text: string; reasoningContent?: string; hasMainContent?: boolean }) => {
        const { messageId, text, reasoningContent = '', hasMainContent = false } = payload;
        if (!messageId) return;
        if (!aiStreamStartedRef.current[messageId] && hasMainContent) {
            aiStreamStartedRef.current[messageId] = true;
            setAITyping(false);
            setAIReasoningPending(false);
            vibrate([8, 40, 8, 55, 10]);
        }
        setAIMessagesByChat(prev => {
            const aiChatId = aiPendingStreamMetaRef.current[messageId]?.chatId || activeAIChatId || '';
            if (!aiChatId) return prev;
            const current = prev[aiChatId] || [];
            const idx = current.findIndex((m) => m.id === messageId);
            if (idx === -1) {
                const fallback = aiPendingStreamMetaRef.current[messageId] ?? {
                    id: messageId,
                    chatId: aiChatId,
                    senderId: 'ai',
                    text: '',
                    timestamp: Date.now(),
                    seen: true,
                    isStreaming: true,
                    streamCompleted: false,
                };
                return {
                    ...prev,
                    [aiChatId]: [...current, {
                        ...fallback,
                        text,
                        reasoningContent,
                        seen: true,
                        isStreaming: true,
                        streamCompleted: false,
                    }],
                };
            }
            const next = [...current];
            next[idx] = {
                ...next[idx],
                text,
                reasoningContent,
                seen: true,
                isStreaming: true,
                streamCompleted: false,
            };
            return { ...prev, [aiChatId]: next };
        });
    }, [activeAIChatId, vibrate]);

    const handleAIStreamDone = useCallback((payload: any) => {
        const message = payload?.message || payload;
        const aiChatId = String(message.aiChatId || activeAIChatId || '');
        if (!aiChatId) return;
        const messageWithChatId: Message = {
            ...message,
            chatId: aiChatId,
            seen: true,
            isStreaming: false,
            streamCompleted: true,
            reasoningContent: String(message?.reasoningContent || ''),
        };
        setAIMessagesByChat(prev => {
            const current = prev[aiChatId] || [];
            const idx = current.findIndex((m) => m.id === messageWithChatId.id);
            if (idx === -1) return { ...prev, [aiChatId]: [...current, messageWithChatId] };
            const next = [...current];
            next[idx] = { ...next[idx], ...messageWithChatId };
            return { ...prev, [aiChatId]: next };
        });
        setAITyping(false);
        setAIResponding(false);
        setAIReasoningPending(false);
        setAIRespondingChatId(null);
        delete aiStreamStartedRef.current[messageWithChatId.id];
        delete aiPendingStreamMetaRef.current[messageWithChatId.id];
        const nextTitle = typeof payload?.title === 'string' ? payload.title.trim() : '';
        if (nextTitle) {
            setAIChats((prev) => prev.map((chat) => (
                chat.id === aiChatId ? { ...chat, title: nextTitle } : chat
            )));
        }
        vibrate([18]);
    }, [vibrate, activeAIChatId]);

    const handleAIUserMessageSaved = useCallback((message: any, clientId?: string) => {
        const aiChatId = String(message.aiChatId || activeAIChatId || '');
        if (!aiChatId) return;
        const messageWithChatId: Message = {
            ...message,
            chatId: aiChatId,
            seen: true,
        };
        setAIMessagesByChat(prev => {
            const current = prev[aiChatId] || [];
            const idx = clientId ? current.findIndex((m) => m.id === clientId) : -1;
            const existingByServerId = current.findIndex((m) => m.id === messageWithChatId.id);
            if (idx === -1 && existingByServerId === -1) {
                return { ...prev, [aiChatId]: [...current, messageWithChatId] };
            }
            const next = [...current];
            const targetIndex = idx !== -1 ? idx : existingByServerId;
            next[targetIndex] = { ...next[targetIndex], ...messageWithChatId };
            return { ...prev, [aiChatId]: next };
        });
        setAIChats(prev => prev.map((c) => (
            c.id === aiChatId
                ? { ...c, updatedAt: Date.now() }
                : c
        )));
    }, [activeAIChatId]);

    const handleAIError = useCallback((message: string) => {
        alert(message);
        setAITyping(false);
        setAIResponding(false);
        setAIReasoningPending(false);
        setAIRespondingChatId(null);
    }, []);

    // WebSocket initialization
    const { sendMessage: sendViaWS, editMessage: editViaWS, deleteMessage: deleteViaWS, sendSeen, sendTyping, reconnectExhausted, reconnectNow, sendAIMessage, stopAIGeneration } = useWebSocket({
        token: authToken,
        onNewMessage: handleNewMessage,
        onMessageEdited: handleMessageEdited,
        onMessageDeleted: handleMessageDeleted,
        onUserStatusChange: handleUserStatusChange,
        onMessagesSeen: handleMessagesSeen,
        onReactionUpdated: handleReactionUpdated,
        onTypingStatus: handleTypingStatus,
        onConnectionChange: setWsConnected,
        onReconnectExhausted: handleWsReconnectExhausted,
        onAINewMessage: handleNewAIMessage,
        onAIError: handleAIError,
        onAIUserMessageSaved: handleAIUserMessageSaved,
        onAIStreamStart: handleAIStreamStart,
        onAIStreamChunk: handleAIStreamChunk,
        onAIStreamDone: handleAIStreamDone,
    });

    useEffect(() => {
        setWsReconnectExhausted(reconnectExhausted);
    }, [reconnectExhausted]);

    // Check auth on mount (without bouncing user to /login first)
    useEffect(() => {
        if (!authToken) {
            setIsAuthChecking(false);
            return;
        }
        apiFetch('/profile/me')
            .then(async (user) => {
                const decryptedBio = await decryptBioClientSide(String(user?.bio || ''), authToken || '', String(user?.chatId || ''));
                setCurrentUser({ ...user, bio: decryptedBio });
                setIsAuthenticated(true);
            })
            .catch(() => {
                localStorage.removeItem('token');
                setAuthToken(null);
                setIsAuthenticated(false);
                setCurrentUser(null);
            })
            .finally(() => {
                setIsAuthChecking(false);
            });
    }, [authToken]);

    const handleLoginSuccess = (user: User, token: string) => {
        localStorage.setItem('token', token);
        setAuthToken(token);
        setCurrentUser(user);
        setIsAuthenticated(true);
        navigate('/', { replace: true });
    };

    const handleRegisterSuccess = (user: User, token: string) => {
        localStorage.setItem('token', token);
        setAuthToken(token);
        setCurrentUser(user);
        setIsAuthenticated(true);
        navigate('/', { replace: true });
    };

    useEffect(() => {
        if (isAuthenticated) loadChats();
    }, [isAuthenticated, loadChats]);

    const fetchPagedMessages = useCallback(async (
        chatId: string,
        params?: { direction?: 'latest' | 'older' | 'newer'; cursorTs?: number; cursorId?: string; mode?: 'replace' | 'prepend' | 'append' }
    ) => {
        const direction = params?.direction || 'latest';
        const mode = params?.mode || 'replace';
        const qs = new URLSearchParams({
            include_meta: 'true',
            limit: String(MESSAGE_PAGE_SIZE),
            direction,
        });
        if (params?.cursorTs) qs.set('cursor_ts', String(params.cursorTs));
        if (params?.cursorId) qs.set('cursor_id', params.cursorId);

        const res = await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages?${qs.toString()}`);
        const rawChunk: Message[] = Array.isArray(res?.messages) ? res.messages : [];
        const chunk: Message[] = await Promise.all(
            rawChunk.map((message) => decryptMessageClientSide(message, authToken || '', chatId))
        );

        setMessages((prev) => {
            const merged = mergeMessages(prev[chatId] || [], chunk, mode);
            return { ...prev, [chatId]: merged };
        });

        setMessageRangeState((prev) => ({
            ...prev,
            [chatId]: {
                ...(prev[chatId] || { loadingOlder: false, loadingNewer: false }),
                hasOlder: Boolean(res?.hasOlder),
                hasNewer: Boolean(res?.hasNewer),
                oldestCursor: res?.oldestCursor || null,
                newestCursor: res?.newestCursor || null,
                loadingOlder: false,
                loadingNewer: false,
            },
        }));
        return chunk.length;
    }, []);

    useEffect(() => {
        if (!wsConnected || !isAuthenticated) return;
        setWsReconnectExhausted(false);
        loadChats(false);

        if (!activeChatId) return;
        fetchPagedMessages(activeChatId, { direction: 'latest', mode: 'replace' })
            .then(() => {
                if (currentUser && activeChatId !== `saved_messages_${currentUser.chatId}`) {
                    sendSeen(activeChatId);
                }
            })
            .catch((err) => console.error('Failed to sync messages after reconnect', err));
    }, [wsConnected, isAuthenticated, loadChats, activeChatId, currentUser, sendSeen, fetchPagedMessages]);

    useEffect(() => {
        if (!isAuthenticated) return;

        const syncFromServer = async () => {
            if (realtimeRecoveryInFlightRef.current) return;
            if (document.visibilityState !== 'visible') return;
            realtimeRecoveryInFlightRef.current = true;
            try {
                await loadChats(false);

                const targetChatId = activeChatIdRef.current;
                if (!targetChatId || viewRef.current !== 'chatRoom' || showAIChat) return;

                const state = messageRangeState[targetChatId];
                if (state?.newestCursor) {
                    await fetchPagedMessages(targetChatId, {
                        direction: 'newer',
                        cursorTs: state.newestCursor.cursorTs,
                        cursorId: state.newestCursor.cursorId,
                        mode: 'append',
                    });
                } else if (messagesLoadedOnce[targetChatId]) {
                    await fetchPagedMessages(targetChatId, { direction: 'latest', mode: 'replace' });
                }

                if (currentUser && targetChatId !== `saved_messages_${currentUser.chatId}`) {
                    sendSeen(targetChatId);
                }
            } catch (err) {
                console.warn('Realtime recovery sync failed', err);
            } finally {
                realtimeRecoveryInFlightRef.current = false;
            }
        };

        const intervalId = window.setInterval(() => {
            void syncFromServer();
        }, 4000);

        const handleVisibilityOrFocus = () => {
            void syncFromServer();
        };
        document.addEventListener('visibilitychange', handleVisibilityOrFocus);
        window.addEventListener('focus', handleVisibilityOrFocus);

        return () => {
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
            window.removeEventListener('focus', handleVisibilityOrFocus);
        };
    }, [
        isAuthenticated,
        loadChats,
        fetchPagedMessages,
        currentUser,
        sendSeen,
        messagesLoadedOnce,
        messageRangeState,
        showAIChat,
    ]);

    useEffect(() => {
        return () => {
            Object.values(presenceOfflineGraceTimersRef.current).forEach((id) => window.clearTimeout(id));
            presenceOfflineGraceTimersRef.current = {};
        };
    }, []);


    useEffect(() => {
        const originalAlert = window.alert.bind(window);

        window.alert = (message?: unknown) => {
            notify(String(message ?? ''));
        };

        return () => {
            window.alert = originalAlert;
        };
    }, []);

    // Allow child components (e.g., ContactInfo group edit) to request a chat-list refresh.
    useEffect(() => {
        if (!isAuthenticated) return;
        const handler = () => {
            loadChats(false);
        };
        window.addEventListener('novaroom:refresh_chats', handler as any);
        window.addEventListener('novaroom:block_status_changed', handler as any);
        return () => {
            window.removeEventListener('novaroom:refresh_chats', handler as any);
            window.removeEventListener('novaroom:block_status_changed', handler as any);
        };
    }, [isAuthenticated, loadChats]);

    const handleSelectChat = useCallback(async (chatId: string, options?: { navigateToRoute?: boolean }) => {
        const shouldNavigate = options?.navigateToRoute ?? true;
        const requestId = ++chatLoadRequestRef.current;
        setPendingUser(null);
        setShowAIChat(false);

        // Capture unreadCount BEFORE clearing so ChatRoom can use it.
        const openingUnread = chatsRef.current.find(c => c.id === chatId)?.unreadCount || 0;
        setOpenChatUnread({ chatId, count: openingUnread });

        setActiveChatId(chatId);
        setView('chatRoom');
        if (shouldNavigate) {
            const savedMessagesId = currentUser ? `saved_messages_${currentUser.chatId}` : '';
            if (savedMessagesId && chatId === savedMessagesId) {
                navigate('/save-message');
            } else {
                navigate(`/chat/${encodeURIComponent(chatId)}`);
            }
        }

        setChats(prev => prev.map(c => (c.id === chatId ? { ...c, unreadCount: 0 } : c)));

        const shouldShowSkeleton = !messagesLoadedOnce[chatId];
        if (shouldShowSkeleton) {
            setMessagesLoading(prev => ({ ...prev, [chatId]: true }));
        }

        try {
            let loadedCount = await fetchPagedMessages(chatId, { direction: 'latest', mode: 'replace' });
            if (loadedCount === 0 && chatLoadRequestRef.current === requestId) {
                // Retry once for occasional race/network hiccups when rapidly switching chats.
                await new Promise((resolve) => window.setTimeout(resolve, 180));
                loadedCount = await fetchPagedMessages(chatId, { direction: 'latest', mode: 'replace' });
            }
            if (chatLoadRequestRef.current !== requestId) return;
            setMessagesLoadedOnce(prev => ({ ...prev, [chatId]: true }));

            if (currentUser && chatId !== `saved_messages_${currentUser.chatId}`) {
                sendSeen(chatId);
            }
        } catch (err) {
            console.error(err);
        } finally {
            if (chatLoadRequestRef.current !== requestId) return;
            if (shouldShowSkeleton) {
                setMessagesLoading(prev => ({ ...prev, [chatId]: false }));
            }
        }

        loadChats(false);
    }, [loadChats, sendSeen, messagesLoadedOnce, currentUser, navigate, fetchPagedMessages]);

    const loadOlderMessages = useCallback(async (chatId: string) => {
        const state = messageRangeState[chatId];
        if (!state?.hasOlder || state.loadingOlder || !state.oldestCursor) return;
        setMessageRangeState((prev) => ({
            ...prev,
            [chatId]: { ...(prev[chatId] || state), loadingOlder: true },
        }));
        await fetchPagedMessages(chatId, {
            direction: 'older',
            cursorTs: state.oldestCursor.cursorTs,
            cursorId: state.oldestCursor.cursorId,
            mode: 'prepend',
        }).catch(() => {
            setMessageRangeState((prev) => ({
                ...prev,
                [chatId]: { ...(prev[chatId] || state), loadingOlder: false },
            }));
        });
    }, [messageRangeState, fetchPagedMessages]);

    const loadNewerMessages = useCallback(async (chatId: string) => {
        const state = messageRangeState[chatId];
        if (!state?.hasNewer || state.loadingNewer || !state.newestCursor) return;
        setMessageRangeState((prev) => ({
            ...prev,
            [chatId]: { ...(prev[chatId] || state), loadingNewer: true },
        }));
        await fetchPagedMessages(chatId, {
            direction: 'newer',
            cursorTs: state.newestCursor.cursorTs,
            cursorId: state.newestCursor.cursorId,
            mode: 'append',
        }).catch(() => {
            setMessageRangeState((prev) => ({
                ...prev,
                [chatId]: { ...(prev[chatId] || state), loadingNewer: false },
            }));
        });
    }, [messageRangeState, fetchPagedMessages]);

    const jumpToLatestMessages = useCallback(async (chatId: string) => {
        await fetchPagedMessages(chatId, { direction: 'latest', mode: 'replace' });
    }, [fetchPagedMessages]);


    useEffect(() => {
        if (!isAuthenticated) return;

        const pathname = location.pathname;
        if (pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/forgot-password')) return;

        if (pathname === '/' || pathname === '') {
            setView('chatList');
            setShowAIChat(false);
            setPendingUser(null);
            setActiveChatId(null);
            return;
        }

        if (pathname === '/profile') {
            setView('profile');
            return;
        }
        if (pathname === '/devices') {
            setView('devices');
            return;
        }

        if (pathname === '/ai') {
            setActiveChatId(null);
            setPendingUser(null);
            setShowAIChat(true);
            setView('chatRoom');
            return;
        }

        if (pathname === '/save-message') {
            if (!currentUser) return;
            const savedMessagesId = `saved_messages_${currentUser.chatId}`;
            if (activeChatId !== savedMessagesId || view !== 'chatRoom') {
                handleSelectChat(savedMessagesId, { navigateToRoute: false });
            }
            return;
        }

        if (pathname === '/chat/new') {
            if (!pendingUser) {
                navigate('/', { replace: true });
                return;
            }
            setShowAIChat(false);
            setActiveChatId(null);
            setView('chatRoom');
            return;
        }

        const chatMatch = pathname.match(/^\/chat\/(.+)$/);
        if (chatMatch?.[1]) {
            const decodedChatId = decodeURIComponent(chatMatch[1]);
            if (currentUser && decodedChatId === `saved_messages_${currentUser.chatId}`) {
                navigate('/save-message', { replace: true });
                return;
            }
            if (activeChatId !== decodedChatId || view !== 'chatRoom' || showAIChat) {
                handleSelectChat(decodedChatId, { navigateToRoute: false });
            }
            return;
        }

        navigate('/', { replace: true });
    }, [
        isAuthenticated,
        location.pathname,
        currentUser,
        activeChatId,
        view,
        showAIChat,
        pendingUser,
        handleSelectChat,
        navigate,
    ]);


    useEffect(() => {
        if (!isAuthenticated) return;
        if (location.pathname !== '/') return;

        const keepAtChatList = () => {
            navigate('/', { replace: true });
        };

        window.addEventListener('popstate', keepAtChatList);
        return () => window.removeEventListener('popstate', keepAtChatList);
    }, [isAuthenticated, location.pathname, navigate]);

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
        const makeClientId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const pushOptimisticMessage = (targetChatId: string, clientId: string) => {
            const now = Date.now();
            const sourceMessages = messages[targetChatId] || [];
            const replySrc = payload.replyToId ? sourceMessages.find((m) => m.id === payload.replyToId) : null;
            const optimistic: Message = {
                id: clientId,
                clientId,
                chatId: targetChatId,
                senderId: currentUser.chatId,
                text: text || '',
                timestamp: now,
                seen: false,
                deliveryStatus: 'sending',
                edited: false,
                reactions: [],
                file: payload.file,
                replyTo: replySrc ? { id: replySrc.id, senderId: replySrc.senderId, text: replySrc.text } : undefined,
            };
            setMessages((prev) => ({
                ...prev,
                [targetChatId]: [...(prev[targetChatId] || []), optimistic],
            }));
            setChats((prev) => prev.map((chat) => (
                chat.id === targetChatId
                    ? {
                        ...chat,
                        lastMessage: {
                            id: clientId,
                            text: text || '',
                            senderId: currentUser.chatId,
                            timestamp: now,
                            file: payload.file,
                        },
                    }
                    : chat
            )));
        };
        const removeOptimisticMessage = (targetChatId: string, clientId: string) => {
            setMessages((prev) => ({
                ...prev,
                [targetChatId]: (prev[targetChatId] || []).filter((m) => m.id !== clientId),
            }));
        };

        if (payload.editMessageId) {
            if (!activeChatId) return;
            const success = await editViaWS(activeChatId, payload.editMessageId, text);
            if (!success) console.warn('WebSocket not connected');
            return;
        }

        const savedMessagesId = `saved_messages_${currentUser.chatId}`;
        if (activeChatId === savedMessagesId) {
            const clientId = makeClientId();
            pushOptimisticMessage(savedMessagesId, clientId);
            const success = await sendViaWS(savedMessagesId, text, payload.replyToId, payload.file, clientId);
            if (!success) {
                console.warn('WebSocket not connected');
                removeOptimisticMessage(savedMessagesId, clientId);
            }
            loadChats(false);
            return;
        }

        const isBlockedDirectTarget = (candidate: Partial<User> | null | undefined) =>
            Boolean(candidate) && isUserBlocked(candidate);

        if (!activeChatId && pendingUser) {
            if (payload.editMessageId) return;
            if (isBlockedDirectTarget(pendingUser)) return;

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
                navigate(`/chat/${encodeURIComponent(createdChatId)}`, { replace: true });

                const clientId = makeClientId();
                pushOptimisticMessage(createdChatId, clientId);
                const success = await sendViaWS(createdChatId, text, payload.replyToId, payload.file, clientId);
                if (!success) {
                    console.warn('WebSocket not connected');
                    removeOptimisticMessage(createdChatId, clientId);
                }

                loadChats(false);
                return;
            } catch (err) {
                console.error(err);
                alert('Failed to create chat');
                return;
            }
        }

        if (!activeChatId) return;

        const activeChat = chats.find((c) => c.id === activeChatId);
        if (activeChat?.chatType !== 'group' && isBlockedDirectTarget(activeChat?.otherUser)) return;

        const clientId = makeClientId();
        pushOptimisticMessage(activeChatId, clientId);
        const success = await sendViaWS(activeChatId, text, payload.replyToId, payload.file, clientId);
        if (!success) {
            console.warn('WebSocket not connected');
            removeOptimisticMessage(activeChatId, clientId);
        }
    }, [activeChatId, currentUser, pendingUser, sendViaWS, editViaWS, loadChats, navigate, chats, isUserBlocked, messages]);

    const handleDeleteMessage = useCallback((messageId: string) => {
        if (!activeChatId) return;
        deleteViaWS(activeChatId, messageId);
    }, [activeChatId, deleteViaWS]);

    const handleForwardMessage = useCallback(async (sourceChatId: string, messageId: string, targetChatId: string) => {
        pendingForwardSendHintsRef.current[targetChatId] = (pendingForwardSendHintsRef.current[targetChatId] || 0) + 1;
        const sourceChatMessage = (messages[sourceChatId] || []).find((m) => m.id === messageId);
        const sourceAIMessageExact = (aiMessagesByChat[sourceChatId] || []).find((m) => m.id === messageId);
        const sourceAIMessageFallback = sourceAIMessageExact
            ? null
            : Object.values(aiMessagesByChat).flat().find((m) => m.id === messageId);
        const sourceMessage = sourceChatMessage || sourceAIMessageExact || sourceAIMessageFallback || null;
        const forwardClientId = `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        if (sourceMessage) {
            const optimisticForward: Message = {
                id: forwardClientId,
                clientId: forwardClientId,
                chatId: targetChatId,
                senderId: currentUser?.chatId || '',
                text: String(sourceMessage.text || ''),
                timestamp: now,
                seen: false,
                deliveryStatus: 'sending',
                file: sourceMessage.file,
                forwardedFrom: sourceMessage.forwardedFrom,
                reasoningContent: sourceMessage.reasoningContent,
                reasoningEnabled: sourceMessage.reasoningEnabled,
                reasoningDurationSec: sourceMessage.reasoningDurationSec,
            };
            setMessages((prev) => ({
                ...prev,
                [targetChatId]: [...(prev[targetChatId] || []), optimisticForward],
            }));
        }
        const encryptedText = sourceMessage
            ? await encryptChatTextClientSide(String(sourceMessage.text || ''), authToken || '', targetChatId)
            : undefined;
        const encryptedReasoning = sourceMessage?.reasoningContent
            ? await encryptChatTextClientSide(String(sourceMessage.reasoningContent || ''), authToken || '', targetChatId)
            : undefined;
        try {
            await apiFetch('/messages/forward', {
                method: 'POST',
                body: JSON.stringify({
                    sourceChatId,
                    messageId,
                    targetChatId,
                    encryptedText,
                    encryptedReasoningContent: encryptedReasoning,
                    clientId: forwardClientId,
                }),
            });
            playChatSound('send');
            // Do not force a full replace right away; eventual consistency can briefly
            // hide optimistic forwarded messages. We keep optimistic row visible until
            // websocket/new sync confirms server copy.
        } catch (e) {
            console.error('Failed to refresh forwarded target chat messages', e);
            setMessages((prev) => ({
                ...prev,
                [targetChatId]: (prev[targetChatId] || []).filter((m) => m.id !== forwardClientId),
            }));
        }
        loadChats(false);
    }, [playChatSound, loadChats, messages, aiMessagesByChat, authToken, currentUser?.chatId]);

    const handleSetPendingForwardDraft = useCallback((targetChatId: string, draft: { sourceChatId: string; messageId: string; previewText?: string; previewFile?: FileMetadata | null }) => {
        if (!targetChatId || !draft?.sourceChatId || !draft?.messageId) return;
        setPendingForwardDrafts((prev) => ({ ...prev, [targetChatId]: draft }));
    }, []);

    const handleClearPendingForwardDraft = useCallback((targetChatId: string) => {
        if (!targetChatId) return;
        setPendingForwardDrafts((prev) => {
            if (!prev[targetChatId]) return prev;
            const next = { ...prev };
            delete next[targetChatId];
            return next;
        });
    }, []);

    const handleDeleteAIMessage = useCallback(async (messageId: string) => {
        try {
            await apiFetch(`/ai/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
            if (!activeAIChatId) return;
            setAIMessagesByChat(prev => ({
                ...prev,
                [activeAIChatId]: (prev[activeAIChatId] || []).filter((m) => m.id !== messageId),
            }));
        } catch (error) {
            console.error('Failed to delete AI message:', error);
            alert('حذف پیام با خطا مواجه شد');
        }
    }, [activeAIChatId]);

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
        navigate('/chat/new');
    }, [currentUser?.chatId, handleSelectChat, navigate]);

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

    const handleOpenProfile = () => {
        setView('profile');
        navigate('/profile');
    };
    const handleOpenDevices = () => {
        setView('devices');
        navigate('/devices');
    };
    const cleanupTemporaryAIChat = useCallback(async (chatId: string) => {
        try {
            await apiFetch(`/ai/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
        } catch {
            // ignore cleanup errors for temporary chats
        }
        setAIChats((prev) => prev.filter((c) => c.id !== chatId));
        setAIMessagesByChat((prev) => {
            const next = { ...prev };
            delete next[chatId];
            return next;
        });
        setActiveAIChatId((prev) => (prev === chatId ? null : prev));
    }, []);
    const handleBack = () => {
        if (temporaryAIChat && activeAIChatId && !aiResponding) {
            void cleanupTemporaryAIChat(activeAIChatId);
        }
        setView('chatList');
        setPendingUser(null);
        setShowAIChat(false);
        setActiveChatId(null);
        setTemporaryAIChat(false);
        navigate('/', { replace: true });
    };

    const handleCloseChat = () => {
        setActiveChatId(null);
        setPendingUser(null);
        setShowAIChat(false);
        setView('chatRoom');
        navigate('/', { replace: true });
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
        setMessageRangeState(prev => {
            const { [chatId]: _, ...rest } = prev;
            return rest;
        });
        delete newGroupTimestamps.current[chatId];
        setActiveChatId(null);
        setPendingUser(null);
        setShowAIChat(false);
        setView('chatList');
        navigate('/', { replace: true });
        loadChats(false);
    };

    const handleOpenAIChat = () => {
        setActiveChatId(null);
        setPendingUser(null);
        setShowAIChat(true);
        setView('chatRoom');
        if (aiResponding && aiRespondingChatId) {
            setActiveAIChatId(aiRespondingChatId);
        } else {
            setActiveAIChatId(null);
            setTemporaryAIChat(false);
        }
        navigate('/ai');
    };

    const handleCreateAIChat = useCallback(() => {
        if (temporaryAIChat && activeAIChatId && !aiResponding) {
            void cleanupTemporaryAIChat(activeAIChatId);
        }
        setTemporaryAIChat(false);
        setActiveAIChatId(null);
    }, [temporaryAIChat, activeAIChatId, aiResponding, cleanupTemporaryAIChat]);

    const handleCreateTemporaryAIChat = useCallback(async () => {
        try {
            const created = await apiFetch('/ai/chats', { method: 'POST', body: JSON.stringify({ temporary: true }) });
            setAIMessagesByChat((prev) => ({ ...prev, [created.id]: [] }));
            setActiveAIChatId(created.id);
            setTemporaryAIChat(true);
        } catch (error) {
            console.error('Failed to create temporary AI chat', error);
            notify({ message: 'ساخت گفتوگوی موقت انجام نشد.', type: 'error' });
        }
    }, []);

    const handleSelectAIChat = useCallback((chatId: string) => {
        if (temporaryAIChat && activeAIChatId && chatId !== activeAIChatId && !aiResponding) {
            void cleanupTemporaryAIChat(activeAIChatId);
            setTemporaryAIChat(false);
        }
        setActiveAIChatId(chatId);
    }, [temporaryAIChat, activeAIChatId, aiResponding, cleanupTemporaryAIChat]);

    const handleDeleteAIChat = useCallback(async (chatId: string) => {
        try {
            await apiFetch(`/ai/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
            setAIChats((prev) => {
                return prev.filter((c) => c.id !== chatId);
            });
            setAIMessagesByChat((prev) => {
                const next = { ...prev };
                delete next[chatId];
                return next;
            });
            setActiveAIChatId((prev) => (prev === chatId ? null : prev));
            if (activeAIChatId === chatId) {
                setTemporaryAIChat(false);
            }
        } catch (error) {
            console.error('Failed to delete AI chat', error);
            alert('حذف گفتوگو با خطا مواجه شد');
        }
    }, [activeAIChatId]);

    const handleRenameAIChat = useCallback(async (chatId: string, nextTitle: string): Promise<boolean> => {
        const trimmed = nextTitle.trim();
        if (!trimmed) {
            notify({ message: 'عنوان گفتوگو نمی‌تواند خالی باشد.', type: 'info' });
            return false;
        }
        try {
            await apiFetch(`/ai/chats/${encodeURIComponent(chatId)}`, {
                method: 'PATCH',
                body: JSON.stringify({ title: trimmed }),
            });
            setAIChats((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, title: trimmed } : chat)));
            return true;
        } catch (error) {
            console.error('Failed to rename AI chat', error);
            notify({ message: 'تغییر نام گفتوگو انجام نشد.', type: 'error' });
            return false;
        }
    }, []);

    const handleOpenSavedMessages = useCallback(() => {
        if (!currentUser) return;
        const savedMessagesId = `saved_messages_${currentUser.chatId}`;
        navigate('/save-message');
        handleSelectChat(savedMessagesId, { navigateToRoute: false });
    }, [currentUser, handleSelectChat, navigate]);

    const handleSendAIMessage = useCallback(async (text: string, useReasoner = false): Promise<boolean> => {
        if (!currentUser) return false;

        if (aiResponding && aiRespondingChatId && activeAIChatId !== aiRespondingChatId) {
            const respondingTitle = aiChats.find((c) => c.id === aiRespondingChatId)?.title || 'گفتوگوی در حال پاسخ';
            notify({ message: `گفتوگوی «${respondingTitle}» هنوز تکمیل نشده است.`, type: 'info' });
            return false;
        }

        setAITyping(true);
        setAIResponding(true);
        setAIReasoningPending(Boolean(useReasoner));

        let targetChatId = activeAIChatId;
        if (!targetChatId) {
            try {
                const created = await apiFetch('/ai/chats', { method: 'POST' });
                setAIChats((prev) => [created, ...prev]);
                setAIMessagesByChat((prev) => ({ ...prev, [created.id]: [] }));
                setActiveAIChatId(created.id);
                targetChatId = created.id;
            } catch (error) {
                console.error('Failed to create AI chat', error);
                alert('ساخت گفتوگوی جدید با خطا مواجه شد');
                setAITyping(false);
                setAIResponding(false);
                setAIReasoningPending(false);
                return false;
            }
        }
        if (!targetChatId) return false;

        const finalChatId = targetChatId;

        const currentAIChatMessages = aiMessagesByChat[finalChatId] || [];
        const sentCount = currentAIChatMessages.filter((m) => m.senderId === currentUser.chatId).length;
        if (sentCount >= 30) {
            alert('حداکثر 30 پیام در هر گفتوگو مجاز است. لطفاً یک چت جدید باز کنید.');
            return false;
        }
        const clientId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const userMessage: Message = {
            id: clientId,
            chatId: finalChatId,
            senderId: currentUser.chatId,
            text,
            timestamp: Date.now(),
            seen: false,
        };

        setAIMessagesByChat((prev) => ({
            ...prev,
            [finalChatId]: [...(prev[finalChatId] || []), userMessage],
        }));
        setAIRespondingChatId(finalChatId);

        const success = sendAIMessage(text, finalChatId, clientId, useReasoner);
        if (!success) {
            console.warn('Failed to send message to AI');
            setAIMessagesByChat((prev) => ({
                ...prev,
                [finalChatId]: (prev[finalChatId] || []).filter((m) => m.id !== clientId),
            }));
            setAITyping(false);
            setAIResponding(false);
            setAIReasoningPending(false);
            setAIRespondingChatId(null);
            notify({ message: 'ارتباط با سرویس هوش مصنوعی برقرار نیست. لطفاً دوباره تلاش کنید.', type: 'error' });
            return false;
        }
        return true;
    }, [currentUser, activeAIChatId, aiMessagesByChat, sendAIMessage, aiResponding, aiRespondingChatId, aiChats]);

    const handleStopAIResponse = useCallback(() => {
        const success = stopAIGeneration();
        if (!success) return;
        setAITyping(false);
        setAIResponding(false);
        setAIReasoningPending(false);
        setAIRespondingChatId(null);
    }, [stopAIGeneration]);

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
                ...(typeof (chat.otherUser as any)?.blockedByMe !== 'undefined' ? { blockedByMe: Boolean((chat.otherUser as any)?.blockedByMe) } : {}),
                ...(typeof (chat.otherUser as any)?.blockedByOther !== 'undefined' ? { blockedByOther: Boolean((chat.otherUser as any)?.blockedByOther) } : {}),
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

    if (isAuthChecking) {
        return null;
    }

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
    const isOnAuthPage = authPages.some(p => location.pathname.startsWith(p));
    if (isOnAuthPage) {
        return <Navigate to="/" replace />;
    }

    const activeChat = chats.find(c => c.id === activeChatId) || null;
    const activeMessages = activeChatId ? messages[activeChatId] || [] : [];
    const activeMessagesLoading = activeChatId ? messagesLoading[activeChatId] || false : false;
    const activeRange = activeChatId ? messageRangeState[activeChatId] : undefined;
    const isSavedMessagesActive = currentUser && activeChatId === `saved_messages_${currentUser.chatId}`;
    const aiMessages = activeAIChatId ? aiMessagesByChat[activeAIChatId] || [] : [];
    const activeAIChat = aiChats.find((c) => c.id === activeAIChatId) || null;
    const isActiveAIResponding = Boolean(activeAIChatId && aiRespondingChatId && activeAIChatId === aiRespondingChatId);

    const initialUnreadCount = openChatUnread?.chatId && openChatUnread.chatId === (activeChatId || 'pending')
        ? openChatUnread.count
        : 0;

    const currentSearchParams = new URLSearchParams(location.search);
    const isInfoRouteActive = currentSearchParams.get('panel') === 'info' && view !== 'profile';

    return (
        <MusicPlayerProvider>
            <MiniMusicPlayer />
            <NotificationCenter />
            <div className="app">
                {view !== 'profile' && view !== 'devices' && (
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
                            onOpenDevices={handleOpenDevices}
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
                                const payload = { ...u } as any;
                                if (typeof payload.bio === 'string' && currentUser?.chatId) {
                                    payload.bio = await encryptBioClientSide(payload.bio, authToken || '', currentUser.chatId);
                                }
                                await apiFetch('/profile/me', { method: 'PATCH', body: JSON.stringify(payload) });
                                setCurrentUser(prev => (prev ? { ...prev, ...u } : null));
                            }}
                        />
                    </div>
                )}

                {view === 'devices' && (
                    <div className="app__main">
                        <Devices onBack={handleBack} />
                    </div>
                )}

                {view !== 'profile' && view !== 'devices' && (
                    <div className={cx('app__main', view === 'chatList' && 'app__main--hidden-mobile')}>
                        {view === 'chatRoom' && showAIChat ? (
                            <AIChatRoom
                                messages={aiMessages}
                                currentUserId={currentUser!.chatId}
                                onSendMessage={handleSendAIMessage}
                                onStopGenerating={handleStopAIResponse}
                                onDeleteMessage={handleDeleteAIMessage}
                                onBack={handleBack}
                                loading={aiLoading}
                                isTyping={isActiveAIResponding ? aiTyping : false}
                                isResponding={isActiveAIResponding ? aiResponding : false}
                                isReasoningPending={isActiveAIResponding ? aiReasoningPending : false}
                                chats={chats}
                                onSelectChat={handleSelectChat}
                                onSetPendingForwardDraft={handleSetPendingForwardDraft}
                                aiChats={aiChats}
                                activeAIChatId={activeAIChatId}
                                activeAIChatTitle={activeAIChat?.title}
                                onCreateAIChat={handleCreateAIChat}
                                onCreateTemporaryAIChat={handleCreateTemporaryAIChat}
                                onSelectAIChat={handleSelectAIChat}
                                onDeleteAIChat={handleDeleteAIChat}
                                onRenameAIChat={handleRenameAIChat}
                                respondingAIChatId={aiRespondingChatId}
                                temporaryMode={temporaryAIChat}
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
                                onOpenAIChat={handleOpenAIChat}
                                onOpenContactInfo={(targetChatId) => navigate(`/chat/${encodeURIComponent(targetChatId)}?panel=info`, { replace: true })}
                                forceContactInfoOpen={isInfoRouteActive}
                                onCloseForcedContactInfo={(currentChatId) => {
                                    const backChatId = currentChatId || activeChatId;
                                    if (backChatId && backChatId !== 'pending') {
                                        navigate(`/chat/${encodeURIComponent(backChatId)}`, { replace: true });
                                        return;
                                    }
                                    navigate('/', { replace: true });
                                }}
                                initialUnreadCount={initialUnreadCount}
                                onConsumeInitialUnread={consumeOpenChatUnread}
                                onForwardMessage={handleForwardMessage}
                                pendingForwardDraft={activeChatId ? (pendingForwardDrafts[activeChatId] || null) : null}
                                onSetPendingForwardDraft={handleSetPendingForwardDraft}
                                onClearPendingForwardDraft={handleClearPendingForwardDraft}
                                typingUserIds={typingUserIdsByChat[activeChatId || 'pending'] || []}
                                onTypingChange={(targetChatId, isTyping) => sendTyping(targetChatId, isTyping)}
                                isUserBlocked={isUserBlocked}
                                onToggleBlockUser={toggleBlockUser}
                                hasOlderMessages={Boolean(activeRange?.hasOlder)}
                                hasNewerMessages={Boolean(activeRange?.hasNewer)}
                                loadingOlderMessages={Boolean(activeRange?.loadingOlder)}
                                loadingNewerMessages={Boolean(activeRange?.loadingNewer)}
                                onLoadOlderMessages={loadOlderMessages}
                                onLoadNewerMessages={loadNewerMessages}
                                onJumpToLatestMessages={jumpToLatestMessages}
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
