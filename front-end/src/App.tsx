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

    // Keep a ref to activeChatId and view so WebSocket callbacks always read the latest values
    // without needing to be re-created (avoids stale closure bug on unread badge).
    const activeChatIdRef = useRef<string | null>(null);
    const viewRef = useRef<View>('chatList');
    useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
    useEffect(() => { viewRef.current = view; }, [view]);

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
    }, [currentUser?.chatId, loadChats]);

    // ... (file unchanged until handleUserSelectedFromModal)

    const handleUserSelectedFromModal = useCallback((user: User) => {
        setNewChatModalOpen(false);

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

        setPendingUser(user);
        setActiveChatId(null);
        setShowAIChat(false);
        setView('chatRoom');
    }, [currentUser?.chatId, handleSelectChat]);

    const handleOpenDirectChat = useCallback((user: User) => {
        if (!currentUser) return;
        if (!user?.chatId || user.chatId === 'saved') return;

        const myId = currentUser.chatId;

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

        setPendingUser(user);
        setActiveChatId(null);
        setShowAIChat(false);
        setView('chatRoom');
    }, [currentUser, handleSelectChat]);

    // ... (rest of file unchanged; only ChatRoom render updated)
