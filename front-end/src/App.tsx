import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import type { Message, View, User, Chat, ChatLastMessage, FileMetadata, AIChatSummary, AIModelKey, PendingForwardDraft, AIUsageStatus, AIMemoryItem, AIAttachmentMeta, AISearchSource, PendingAttachment } from './types';
import { apiFetch, getAuthToken } from './config/api';
import { cancelUpload, enqueueUpload, registerUpload, releaseUpload, uploadChatFile, localBlobUrls, registerLocalBlobUrl } from './utils/chatFileUploader';
import { clearUploadProgress, setUploadProgress } from './utils/uploadProgressStore';
import { useWebSocket } from './hooks/useWebSocket';
import { ChatList } from './components/ChatList';
import { ChatRoom } from './components/ChatRoom';
import { AIChatRoom } from './components/AIChatRoom';
import { Profile } from './components/Profile';
import { Settings } from './components/Settings';
import { EmptyState } from './components/EmptyState';
import { Login } from './components/Login';
import { Register } from './components/Register';
import { ResetPasswordLink } from './components/ResetPasswordLink';
import { NewChatModal } from './components/NewChatModal';
import { MiniMusicPlayer } from './components/MiniMusicPlayer';
import { MusicPlayerProvider } from './contexts/MusicPlayerContext';
import { cx } from './utils/cx';
import { NotificationCenter } from './components/NotificationCenter';
import { notify } from './utils/notificationBus';
import { decryptBioClientSide, decryptMessageClientSide, encryptChatTextClientSide } from './utils/e2ee';
import { clearCachedTextValues, clearChatSnapshots, getChatSnapshot, saveChatSnapshot } from './utils/mediaCache';
import { clearChessCache } from './utils/chessCache';
import { useDarkMode, syncThemeColor } from './hooks/useDarkMode';
import { BottomNavbar } from './components/BottomNavbar';
import { ChessScreen } from './components/chess/ChessScreen';
import { ChessJoinPage } from './components/chess/ChessJoinPage';
import './App.css';


const EMPTY_IDS: string[] = [];

const normalizeTimestamp = (ts: unknown): number => {
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
    if (typeof ts === 'string') {
        const parsed = Date.parse(ts);
        return Number.isFinite(parsed) ? parsed : Date.now();
    }
    if (ts instanceof Date) return ts.getTime();
    return Date.now();
};

const areReactionsEqual = (a?: Message['reactions'], b?: Message['reactions']): boolean => {
    if (a === b) return true;
    const listA = Array.isArray(a) ? a : [];
    const listB = Array.isArray(b) ? b : [];
    if (listA.length !== listB.length) return false;
    for (let i = 0; i < listA.length; i += 1) {
        const rA = listA[i] as any;
        const rB = listB[i] as any;
        if (rA?.emoji !== rB?.emoji || rA?.count !== rB?.count || rA?.userId !== rB?.userId) return false;
        const uA = Array.isArray(rA?.userIds) ? rA.userIds : [];
        const uB = Array.isArray(rB?.userIds) ? rB.userIds : [];
        if (uA.length !== uB.length) return false;
        for (let j = 0; j < uA.length; j += 1) {
            if (uA[j] !== uB[j]) return false;
        }
    }
    return true;
};

const isSameMessageRecord = (prev: Message, next: Message): boolean => {
    if (prev === next) return true;
    return (
        prev.id === next.id &&
        prev.text === next.text &&
        prev.senderId === next.senderId &&
        normalizeTimestamp(prev.timestamp) === normalizeTimestamp(next.timestamp) &&
        Boolean(prev.seen) === Boolean(next.seen) &&
        Number((prev as any).seenCount || 0) === Number((next as any).seenCount || 0) &&
        Boolean(prev.edited) === Boolean(next.edited) &&
        (prev as any).editedAt === (next as any).editedAt &&
        prev.deliveryStatus === next.deliveryStatus &&
        prev.file?.fileId === next.file?.fileId &&
        prev.file?.localUrl === next.file?.localUrl &&
        prev.file?.fileName === next.file?.fileName &&
        prev.file?.previewUrl === next.file?.previewUrl &&
        prev.file?.coverArtUrl === next.file?.coverArtUrl &&
        prev.replyTo?.id === next.replyTo?.id &&
        prev.replyTo?.text === next.replyTo?.text &&
        prev.forwardedFrom?.originalSenderId === next.forwardedFrom?.originalSenderId &&
        areReactionsEqual(prev.reactions, next.reactions)
    );
};

const mergeMessages = (base: Message[], incoming: Message[], mode: 'replace' | 'prepend' | 'append'): Message[] => {
    const byId = new Map<string, Message>();
    const baseById = new Map(base.map((m) => [m.id, m]));
    const incomingClientIds = new Set(incoming.map((m) => String((m as any).clientId || '')).filter(Boolean));
    const setMerged = (m: Message) => {
        const prev = baseById.get(m.id);
        byId.set(m.id, prev && isSameMessageRecord(prev, m) ? prev : m);
    };

    if (mode === 'replace') {
        for (const m of incoming) {
            setMerged(m);
        }
        for (const pending of base) {
            const isPendingSend = pending.deliveryStatus === 'sending';
            const pendingClientId = String((pending as any).clientId || '');
            const alreadyInIncoming = byId.has(pending.id) || (pendingClientId && incomingClientIds.has(pendingClientId));
            const hasSameContentServerMessage = incoming.some((serverMsg) => {
                if (String(serverMsg.senderId || '') !== String(pending.senderId || '')) return false;
                if (Math.abs(normalizeTimestamp(serverMsg.timestamp) - normalizeTimestamp(pending.timestamp)) > 120_000) return false;
                const sameText = String(serverMsg.text || '') === String(pending.text || '');
                const sameFileId = String(serverMsg.file?.fileId || '') === String(pending.file?.fileId || '');
                const hasNoFile = !serverMsg.file && !pending.file;
                return sameText && (hasNoFile || sameFileId);
            });
            if (isPendingSend && !alreadyInIncoming && !hasSameContentServerMessage) {
                byId.set(pending.id, pending);
            }
        }
    } else {
        const combined = mode === 'prepend' ? [...incoming, ...base] : [...base, ...incoming];
        for (const m of combined) {
            const mClientId = String((m as any).clientId || '');
            const isPending = m.deliveryStatus === 'sending';
            
            if (isPending && mClientId && incomingClientIds.has(mClientId)) {
                
                continue;
            }
            
            
            if (byId.has(m.id)) {
                const existing = byId.get(m.id)!;
                if (existing.deliveryStatus === 'sending' && m.deliveryStatus !== 'sending') {
                    setMerged(m);
                }
            } else {
                setMerged(m);
            }
        }
    }

    const sorted = Array.from(byId.values()).sort((a, b) => {
        const tsDiff = normalizeTimestamp(a.timestamp) - normalizeTimestamp(b.timestamp);
        if (tsDiff !== 0) return tsDiff;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });
    if (sorted.length === base.length && sorted.every((item, idx) => item === base[idx])) {
        return base;
    }
    return sorted;
};

export function App() {
    useDarkMode();
    const MESSAGE_PAGE_SIZE = 50;
    const DESKTOP_BREAKPOINT = 1024;
    const DESKTOP_SIDEBAR_MIN = 320;
    const DESKTOP_MAIN_MIN = 520;
    const DESKTOP_SIDEBAR_KEY = 'desktopLayout:chatListWidth';
    const navigate = useNavigate();
    const location = useLocation();
    const isChessGameRoute = location.pathname.startsWith('/chess/game/');
    const chessJoinToken = location.pathname.match(/^\/chess\/join\/([A-Za-z0-9]+)$/)?.[1] ?? null;
    const adminPanelSection = location.pathname.startsWith('/settings/admin/panel/')
        ? location.pathname.slice('/settings/admin/panel/'.length).split('/')[0] || 'users'
        : 'users';
    const [chessContactOpen, setChessContactOpen] = useState(false);
    const [authToken, setAuthToken] = useState<string | null>(() => getAuthToken());
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(Boolean(authToken));
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [view, setView] = useState<View>('chatList');
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [chats, setChats] = useState<Chat[]>([]);
    const [messages, setMessages] = useState<Record<string, Message[]>>({});
    const messagesRef = useRef<Record<string, Message[]>>({});
    const recentChatIdsRef = useRef<string[]>([]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        if (!isAuthenticated || !activeChatId) return;
        const list = messages[activeChatId];
        if (!list || list.length === 0) return;
        const timer = window.setTimeout(() => {
            void saveChatSnapshot(activeChatId, list.filter((m) => m.deliveryStatus !== 'sending'));
        }, 800);
        return () => window.clearTimeout(timer);
    }, [messages, activeChatId, isAuthenticated]);

    const [messageRangeState, setMessageRangeState] = useState<Record<string, {
        hasOlder: boolean;
        hasNewer: boolean;
        loadingOlder: boolean;
        loadingNewer: boolean;
        oldestCursor?: { cursorTs: number; cursorId: string } | null;
        newestCursor?: { cursorTs: number; cursorId: string } | null;
    }>>({});
    const messageRangeStateRef = useRef(messageRangeState);
    useEffect(() => {
        messageRangeStateRef.current = messageRangeState;
    }, [messageRangeState]);
    const [wsConnected, setWsConnected] = useState(false);
    const [wsReconnectExhausted, setWsReconnectExhausted] = useState(false);
    const [typingUserIdsByChat, setTypingUserIdsByChat] = useState<Record<string, string[]>>({});
    const [uploadingUserIdsByChat, setUploadingUserIdsByChat] = useState<Record<string, string[]>>({});
    const [blockedChatIds, setBlockedChatIds] = useState<string[]>([]);
    const typingTimeoutsRef = useRef<Record<string, number>>({});
    const userPresenceRef = useRef<Record<string, { online: boolean; updatedAt: number; lastSeen?: number | null }>>({});
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

    
    
    
    
    const [openChatUnread, setOpenChatUnread] = useState<{ chatId: string; count: number } | null>(null);
    const [desktopSidebarWidth, setDesktopSidebarWidth] = useState<number | null>(() => {
        try {
            const raw = localStorage.getItem(DESKTOP_SIDEBAR_KEY);
            if (!raw) return null;
            const value = Number(raw);
            return Number.isFinite(value) ? value : null;
        } catch {
            return null;
        }
    });
    const [isResizingDesktopLayout, setIsResizingDesktopLayout] = useState(false);
    const [loginEvents, setLoginEvents] = useState<any[]>([]);
    const [unseenLoginCount, setUnseenLoginCount] = useState(0);

    const consumeOpenChatUnread = useCallback((id: string) => {
        setOpenChatUnread((prev) => {
            if (!prev) return prev;
            if (prev.chatId !== id) return prev;
            return null;
        });
    }, [authToken, currentUser?.chatId]);

    
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
    const [selectedAIModel, setSelectedAIModel] = useState<AIModelKey>('nova-flash');
    const [aiUsageStatus, setAIUsageStatus] = useState<AIUsageStatus>({
        dateKey: '',
        resetTimezone: 'Asia/Tehran',
        tokens: { usedPercent: 0, remainingPercent: 100, exhausted: false },
        files: { used: 0, remaining: 5, limit: 5 },
        search: { used: 0, remaining: 5, limit: 5 },
    });
    const [aiMemories, setAIMemories] = useState<AIMemoryItem[]>([]);

    
    const [isInitialChatsLoad, setIsInitialChatsLoad] = useState(true);
    const [messagesLoadedOnce, setMessagesLoadedOnce] = useState<Record<string, boolean>>({});
    const messagesLoadedOnceRef = useRef<Record<string, boolean>>({});
    useEffect(() => {
        messagesLoadedOnceRef.current = messagesLoadedOnce;
    }, [messagesLoadedOnce]);
    const [messagesLoading, setMessagesLoading] = useState<Record<string, boolean>>({});

    const sendSoundRef = useRef<HTMLAudioElement | null>(null);
    const receiveSoundRef = useRef<HTMLAudioElement | null>(null);

    
    
    const [pendingUser, setPendingUser] = useState<User | null>(null);
    const [pendingForwardDrafts, setPendingForwardDrafts] = useState<Record<string, PendingForwardDraft>>({});
    const aiStreamStartedRef = useRef<Record<string, boolean>>({});
    const aiPendingStreamMetaRef = useRef<Record<string, Message>>({});
    const dragHoverChatTimerRef = useRef<number | null>(null);
    const dragHoverPendingChatIdRef = useRef<string | null>(null);

    const chatsRef = useRef<Chat[]>([]);
    useEffect(() => {
        chatsRef.current = chats;
    }, [chats]);

    
    
    const activeChatIdRef = useRef<string | null>(null);
    const viewRef = useRef<View>('chatList');
    const lastSeenAckMessageIdRef = useRef<Record<string, string>>({});
    const playedSendSoundIdsRef = useRef<Set<string>>(new Set());
    const lastReceiveSoundMessageRef = useRef<Record<string, string>>({});
    const interactiveOnlineTimersRef = useRef<Record<string, number>>({});
    const [interactiveOnlineUsers, setInteractiveOnlineUsers] = useState<Record<string, number>>({});

    const touchInteractiveUser = useCallback((userId?: string) => {
        const id = String(userId || '').trim();
        if (!id || id === String(currentUser?.chatId || '').trim()) return;
        if (interactiveOnlineTimersRef.current[id]) {
            window.clearTimeout(interactiveOnlineTimersRef.current[id]);
        }
        const expiresAt = Date.now() + 6000;
        setInteractiveOnlineUsers((prev) => ({ ...prev, [id]: expiresAt }));
        interactiveOnlineTimersRef.current[id] = window.setTimeout(() => {
            setInteractiveOnlineUsers((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            delete interactiveOnlineTimersRef.current[id];
        }, 6000);
    }, [currentUser?.chatId]);

    const chatLoadRequestRef = useRef(0);
    const aiSendInFlightRef = useRef(false);
    useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
    useEffect(() => { viewRef.current = view; }, [view]);

    useEffect(() => {
        syncThemeColor(view === 'chatRoom' || showAIChat ? '--bg-secondary' : '--bg-primary');
    }, [view, showAIChat]);

    useEffect(() => {
        if (!isAuthenticated || isAuthChecking) return;

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
    }, [isAuthenticated, isAuthChecking]);

    useEffect(() => {
        if (desktopSidebarWidth == null) return;
        try {
            localStorage.setItem(DESKTOP_SIDEBAR_KEY, String(Math.round(desktopSidebarWidth)));
        } catch {
            
        }
    }, [desktopSidebarWidth]);

    useEffect(() => {
        if (!isResizingDesktopLayout) return;
        const onMove = (event: MouseEvent) => {
            if (window.innerWidth < DESKTOP_BREAKPOINT) return;
            const totalWidth = window.innerWidth;
            const maxSidebar = Math.max(DESKTOP_SIDEBAR_MIN, totalWidth - DESKTOP_MAIN_MIN);
            const next = Math.min(maxSidebar, Math.max(DESKTOP_SIDEBAR_MIN, event.clientX));
            setDesktopSidebarWidth(next);
        };
        const onUp = () => setIsResizingDesktopLayout(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [isResizingDesktopLayout]);

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

        try {
            audio.pause();
            audio.currentTime = 0;
            const playPromise = audio.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {
                    try {
                        const fallback = audio.cloneNode(true) as HTMLAudioElement;
                        fallback.volume = audio.volume;
                        void fallback.play().catch(() => {  });
                    } catch {
                        
                    }
                });
            }
        } catch {
            
        }
    }, []);

    
    
    
    const newGroupTimestamps = useRef<Record<string, number>>({});

    
    useEffect(() => {
        const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
        let lastWidth = window.innerWidth;
        let fullHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);

        const apply = () => {
            const vv = window.visualViewport;
            const height = Math.round(vv?.height ?? window.innerHeight);
            const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;

            if (!isCoarsePointer || window.innerWidth !== lastWidth) {
                lastWidth = window.innerWidth;
                fullHeight = height;
            } else if (height > fullHeight) {
                fullHeight = height;
            }

            document.documentElement.style.setProperty('--app-height', `${height}px`);
            document.documentElement.style.setProperty('--app-height-full', `${fullHeight}px`);
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
        if (!isAuthenticated) return;
        const loadAIUsage = async () => {
            try {
                const [status, memories] = await Promise.all([
                    apiFetch('/ai/usage-status'),
                    apiFetch('/ai/memories'),
                ]);
                if (status?.tokens && status?.files && status?.search) {
                    setAIUsageStatus(status);
                }
                if (Array.isArray(memories)) {
                    setAIMemories(memories);
                }
            } catch (error) {
                console.error('Failed to load AI usage status:', error);
            }
        };
        loadAIUsage();
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
            
        }

        try {
            const data = await apiFetch('/chats');

            const normalized: Chat[] = await Promise.all((data as any[]).map(async (c) => {
                const [decryptedLastMessage, decryptedPinnedMessage, decryptedOtherBio] = await Promise.all([
                    c?.lastMessage
                        ? decryptMessageClientSide(c.lastMessage, authToken || '', String(c.id || ''))
                        : Promise.resolve(null),
                    c?.pinnedMessage
                        ? decryptMessageClientSide(c.pinnedMessage, authToken || '', String(c.id || ''))
                        : Promise.resolve(null),
                    c?.otherUser?.chatId
                        ? decryptBioClientSide(String(c.otherUser.bio || ''), authToken || '', String(c.otherUser.chatId || ''))
                        : Promise.resolve(c?.otherUser?.bio),
                ]);
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
                    const pinnedTs = newGroupTimestamps.current[c.id] ?? 0;
                    return {
                        ...c,
                        otherUser: c?.otherUser ? { ...c.otherUser, bio: decryptedOtherBio || '', online: resolvedOnline } : c?.otherUser,
                        lastMessage: { id: '', text: '', senderId: '', timestamp: pinnedTs },
                        pinnedMessage: decryptedPinnedMessage,
                    } as Chat;
                }
                return {
                    ...c,
                    otherUser: c?.otherUser ? { ...c.otherUser, bio: decryptedOtherBio || '', online: resolvedOnline } : c?.otherUser,
                    lastMessage: {
                        ...decryptedLastMessage,
                        timestamp: normalizeTimestamp(c.lastMessage.timestamp),
                    },
                    pinnedMessage: decryptedPinnedMessage,
                } as Chat;
            }));

            
            const currentActiveChatId = activeChatIdRef.current;
            const currentView = viewRef.current;
            const merged = normalized.map((c) => {
                if (currentView === 'chatRoom' && currentActiveChatId && c.id === currentActiveChatId) {
                    return { ...c, unreadCount: 0 };
                }
                return c;
            });

            setChats((prev) => {
                if (prev.length !== merged.length) return merged;
                const prevById = new Map(prev.map((item) => [item.id, item]));
                let changed = false;
                const next = merged.map((chat, idx) => {
                    const prevChat = prevById.get(chat.id);
                    if (!prevChat) {
                        changed = true;
                        return chat;
                    }
                    const sameUnread = Number(prevChat.unreadCount || 0) === Number(chat.unreadCount || 0);
                    const sameLastMsg =
                        prevChat.lastMessage?.id === chat.lastMessage?.id &&
                        prevChat.lastMessage?.text === chat.lastMessage?.text &&
                        prevChat.lastMessage?.timestamp === chat.lastMessage?.timestamp &&
                        prevChat.lastMessage?.senderId === chat.lastMessage?.senderId;
                    const sameOtherUser =
                        prevChat.otherUser?.chatId === chat.otherUser?.chatId &&
                        prevChat.otherUser?.name === chat.otherUser?.name &&
                        prevChat.otherUser?.username === chat.otherUser?.username &&
                        prevChat.otherUser?.avatar === chat.otherUser?.avatar &&
                        prevChat.otherUser?.bio === chat.otherUser?.bio &&
                        prevChat.otherUser?.online === chat.otherUser?.online &&
                        (prevChat.otherUser as any)?.verified === (chat.otherUser as any)?.verified &&
                        (prevChat.otherUser as any)?.blockedByMe === (chat.otherUser as any)?.blockedByMe &&
                        (prevChat.otherUser as any)?.blockedByOther === (chat.otherUser as any)?.blockedByOther;
                    const sameGroupCounts =
                        (prevChat as any)?.totalMembers === (chat as any)?.totalMembers &&
                        (prevChat as any)?.onlineMembers === (chat as any)?.onlineMembers;
                    const resolved = sameUnread && sameLastMsg && sameOtherUser && sameGroupCounts ? prevChat : chat;
                    if (resolved !== prev[idx]) {
                        changed = true;
                    }
                    return resolved;
                });
                return changed ? next : prev;
            });
            setIsInitialChatsLoad(false);
        } catch (error) {
            console.error('Failed to load chats', error);
            setIsInitialChatsLoad(false);
        }
    }, [isAuthenticated, authToken]);

    const handleLogout = useCallback(() => {
        const finalizeLogout = () => {
            localStorage.removeItem('token');
            document.cookie = 'auth_token=; path=/; max-age=0; samesite=lax';
            setAuthToken(null);
            setIsAuthenticated(false);
            setCurrentUser(null);
            setView('chatList');
            setActiveChatId(null);
            setPendingUser(null);
            setChats([]);
            setMessages({});
            setMessageRangeState({});
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
            setUploadingUserIdsByChat({});
            void clearChatSnapshots();
            void clearCachedTextValues();
            clearChessCache();
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

        touchInteractiveUser(userId);

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

    const handleUploadStatus = useCallback((chatId: string, userId: string, isUploading: boolean) => {
        if (!chatId || !userId) return;
        if (currentUser?.chatId && userId === currentUser.chatId) return;

        if (isUploading) {
            touchInteractiveUser(userId);
        }

        setUploadingUserIdsByChat((prev) => {
            const chatUsers = prev[chatId] || [];
            if (isUploading) {
                if (chatUsers.includes(userId)) return prev;
                return { ...prev, [chatId]: [...chatUsers, userId] };
            }
            if (!chatUsers.includes(userId)) return prev;
            const nextUsers = chatUsers.filter((id) => id !== userId);
            if (nextUsers.length === 0) {
                const next = { ...prev };
                delete next[chatId];
                return next;
            }
            return { ...prev, [chatId]: nextUsers };
        });
    }, [currentUser?.chatId]);

    
    const handleNewMessage = useCallback((chatId: string, newMsg: Message) => {
        if (newMsg?.senderId) {
            touchInteractiveUser(newMsg.senderId);
        }

        const currentMessages = messagesRef.current[chatId] || [];
        
        let isDuplicateMessage = false;
        let replacedOptimisticMine = false;

        if (newMsg.clientId) {
            const optimisticIdx = currentMessages.findIndex((m) => m.id === newMsg.clientId && m.deliveryStatus === 'sending');
            if (optimisticIdx !== -1) {
                replacedOptimisticMine = true;
            }
        }
        
        if (!replacedOptimisticMine) {
            if (currentMessages.some(m => m.id === newMsg.id)) {
                isDuplicateMessage = true;
            } else {
                const optimisticMineIdx = currentMessages.findIndex((m) => {
                    if (m.senderId !== newMsg.senderId) return false;
                    if (m.deliveryStatus !== 'sending') return false;
                    if (Math.abs(normalizeTimestamp(newMsg.timestamp) - normalizeTimestamp(m.timestamp)) > 120_000) return false;
                    const sameText = String(m.text || '') === String(newMsg.text || '');
                    const prevFileId = String(m.file?.fileId || '');
                    const nextFileId = String(newMsg.file?.fileId || '');
                    const sameFileType = String(m.file?.mimeType || '') === String(newMsg.file?.mimeType || '');
                    const sameFile = (prevFileId && nextFileId && prevFileId === nextFileId) || (!prevFileId && !nextFileId && sameFileType);
                    return sameText && sameFile;
                });
                if (optimisticMineIdx !== -1) {
                    replacedOptimisticMine = true;
                }
            }
        }

        setMessages(prev => {
            const list = prev[chatId] || [];
            
            
            if (newMsg.clientId) {
                const idx = list.findIndex((m) => m.id === newMsg.clientId && m.deliveryStatus === 'sending');
                if (idx !== -1) {
                    const next = [...list];
                    next[idx] = { ...newMsg, deliveryStatus: 'sent' };
                    return { ...prev, [chatId]: next };
                }
            }
            
            if (list.some(m => m.id === newMsg.id)) return prev;

            const contentIdx = list.findIndex((m) => {
                if (m.senderId !== newMsg.senderId) return false;
                if (m.deliveryStatus !== 'sending') return false;
                if (Math.abs(normalizeTimestamp(newMsg.timestamp) - normalizeTimestamp(m.timestamp)) > 120_000) return false;
                return String(m.text || '') === String(newMsg.text || '');
            });

            if (contentIdx !== -1) {
                const next = [...list];
                next[contentIdx] = { ...newMsg, deliveryStatus: 'sent' };
                return { ...prev, [chatId]: next };
            }

            return {
                ...prev,
                [chatId]: [...list, newMsg]
            };
        });

        if (isDuplicateMessage) return;

        if (replacedOptimisticMine) {
            const sendSoundKey = String(newMsg.clientId || newMsg.id || '');
            if (sendSoundKey && !playedSendSoundIdsRef.current.has(sendSoundKey)) {
                playedSendSoundIdsRef.current.add(sendSoundKey);
                
                if (playedSendSoundIdsRef.current.size > 500) {
                    const iterator = playedSendSoundIdsRef.current.values();
                    const oldestKey = iterator.next().value;
                    if (oldestKey) {
                        playedSendSoundIdsRef.current.delete(oldestKey);
                    }
                }
                playChatSound('send');
            }
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate(12);
            }
        }

        const hasChat = chatsRef.current.some(c => c.id === chatId);
        if (!hasChat) {
            loadChats(false);
        }

        if (newGroupTimestamps.current[chatId]) {
            delete newGroupTimestamps.current[chatId];
        }

        setChats(prev => {
            const myId = currentUser?.chatId;
            const isIncoming = Boolean(myId) && newMsg.senderId !== myId;
            const isActiveChat = activeChatIdRef.current === chatId && viewRef.current === 'chatRoom';
            const shouldIncrementUnread = isIncoming && !isActiveChat;

            if (isIncoming && isActiveChat) {
                const lastPlayedForChat = lastReceiveSoundMessageRef.current[chatId];
                if (lastPlayedForChat !== newMsg.id) {
                    lastReceiveSoundMessageRef.current[chatId] = newMsg.id;
                    playChatSound('receive');
                }
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

    const handleMessageDeleted = useCallback((chatId: string, messageId: string, lastMessage?: any, messageIds?: string[]) => {
        const idsSet = new Set(messageIds && messageIds.length > 0 ? messageIds : [messageId]);
        setMessages(prev => {
            const arr = prev[chatId];
            if (!arr) return prev;
            return {
                ...prev,
                [chatId]: arr.filter(m => !idsSet.has(m.id))
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

    const handleMessagePinned = useCallback(async (chatId: string, pinnedMessage: any) => {
        const decPinned = await decryptMessageClientSide(pinnedMessage, authToken || '', chatId);
        setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, pinnedMessage: decPinned } : c)));
    }, [authToken]);

    const handleMessageUnpinned = useCallback((chatId: string) => {
        setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, pinnedMessage: null } : c)));
    }, []);

    const handlePinMessage = useCallback(async (chatId: string, messageId: string) => {
        try {
            const res = await apiFetch(`/chats/${encodeURIComponent(chatId)}/pin/${encodeURIComponent(messageId)}`, {
                method: 'POST',
            });
            if (res?.pinnedMessage) {
                const decPinned = await decryptMessageClientSide(res.pinnedMessage, authToken || '', chatId);
                setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, pinnedMessage: decPinned } : c)));
            }
        } catch (e) {
            console.error('Failed to pin message:', e);
        }
    }, [authToken]);

    const handleUnpinMessage = useCallback(async (chatId: string) => {
        try {
            await apiFetch(`/chats/${encodeURIComponent(chatId)}/pin`, {
                method: 'DELETE',
            });
            setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, pinnedMessage: null } : c)));
        } catch (e) {
            console.error('Failed to unpin message:', e);
        }
    }, []);

    const [targetScrollMessage, setTargetScrollMessage] = useState<{ chatId: string; messageId: string; timestamp: number } | null>(null);
    const [jumpLoading, setJumpLoading] = useState<{ chatId: string; messageId: string } | null>(null);
    const jumpAbortRef = useRef<AbortController | null>(null);
    const jumpRequestIdRef = useRef(0);
    const jumpRangeChatIdsRef = useRef<Set<string>>(new Set());

    const handleJumpToMessageSettled = useCallback(() => {
        setJumpLoading(null);
        setTargetScrollMessage(null);
    }, []);

    const handleCancelJumpToMessage = useCallback(() => {
        jumpRequestIdRef.current += 1;
        jumpAbortRef.current?.abort();
        jumpAbortRef.current = null;
        setJumpLoading(null);
        setTargetScrollMessage(null);
    }, []);

    const previousActiveChatIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (previousActiveChatIdRef.current === activeChatId) return;
        previousActiveChatIdRef.current = activeChatId;
        jumpRequestIdRef.current += 1;
        jumpAbortRef.current?.abort();
        jumpAbortRef.current = null;
        setJumpLoading(null);
    }, [activeChatId]);

    const handleJumpToMessage = useCallback(async (chatId: string, messageId: string) => {
        if (!chatId || !messageId) return;

        const currentMessages = messages[chatId] || [];
        const isAlreadyLoaded = currentMessages.some((m) => m.id === messageId);

        if (isAlreadyLoaded) {
            setTargetScrollMessage({ chatId, messageId, timestamp: Date.now() });
            return;
        }

        jumpAbortRef.current?.abort();
        const controller = new AbortController();
        jumpAbortRef.current = controller;
        const requestId = jumpRequestIdRef.current + 1;
        jumpRequestIdRef.current = requestId;
        setJumpLoading({ chatId, messageId });
        let settled = false;

        try {
            const qs = new URLSearchParams({
                around_id: messageId,
                limit: String(MESSAGE_PAGE_SIZE),
                include_meta: 'true',
            });
            const res = await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages?${qs.toString()}`, { signal: controller.signal });
            const rawChunk: Message[] = Array.isArray(res?.messages) ? res.messages : [];
            const chunk: Message[] = await Promise.all(
                rawChunk.map((message) => decryptMessageClientSide(message, authToken || '', chatId))
            );

            if (requestId !== jumpRequestIdRef.current) return;

            if (chunk.length > 0) {
                setMessages((prev) => ({
                    ...prev,
                    [chatId]: chunk,
                }));

                setMessageRangeState((prev) => ({
                    ...prev,
                    [chatId]: {
                        hasOlder: Boolean(res?.hasOlder),
                        hasNewer: Boolean(res?.hasNewer),
                        oldestCursor: res?.oldestCursor || null,
                        newestCursor: res?.newestCursor || null,
                        loadingOlder: false,
                        loadingNewer: false,
                    },
                }));

                setTargetScrollMessage({ chatId, messageId, timestamp: Date.now() });
                jumpRangeChatIdsRef.current.add(chatId);
                settled = true;
                if (!chunk.some((message) => message.id === messageId)) {
                    setJumpLoading(null);
                }
            }
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                console.error('Failed to jump to message around_id:', err);
            }
        } finally {
            jumpAbortRef.current = null;
            if (!settled && requestId === jumpRequestIdRef.current) {
                setJumpLoading(null);
            }
        }
    }, [messages, authToken]);

    const handleUserStatusChange = useCallback((userId: string, online: boolean, lastSeen?: number | null) => {
        const normalizedUserId = String(userId || '').trim();
        if (!normalizedUserId) return;
        const now = Date.now();
        const prevPresence = userPresenceRef.current[normalizedUserId];
        const prevOnline = prevPresence?.online;
        const setPresence = (nextOnline: boolean) => {
            userPresenceRef.current[normalizedUserId] = {
                online: nextOnline,
                updatedAt: Date.now(),
                lastSeen: typeof lastSeen === 'number' ? lastSeen : prevPresence?.lastSeen,
            };
        };
        if (presenceOfflineGraceTimersRef.current[normalizedUserId]) {
            window.clearTimeout(presenceOfflineGraceTimersRef.current[normalizedUserId]);
            delete presenceOfflineGraceTimersRef.current[normalizedUserId];
        }
        
        
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
                    return {
                        ...chat,
                        otherUser: {
                            ...ou,
                            online: false,
                            lastSeen: typeof lastSeen === 'number' ? lastSeen : (ou.lastSeen || Date.now()),
                        },
                    };
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
                return {
                    ...chat,
                    otherUser: {
                        ...chat.otherUser,
                        online: Boolean(online),
                        lastSeen: typeof lastSeen === 'number' ? lastSeen : chat.otherUser?.lastSeen,
                    },
                };
            }
            return chat;
        }));
    }, []);

    const handleMessagesSeen = useCallback((chatId: string, byUserId?: string) => {
        if (byUserId) {
            touchInteractiveUser(byUserId);
        }
        if (chatId === 'official-channel' && byUserId) {
            setMessages(prev => {
                const list = prev[chatId];
                if (!list) return prev;
                let changed = false;
                const next = list.map((m: any) => {
                    const existing = Array.isArray(m.seenBy) ? m.seenBy : [];
                    if (String(m.senderId || '') === byUserId || existing.includes(byUserId)) return m;
                    changed = true;
                    const nextSeenBy = [...existing, byUserId];
                    return { ...m, seenBy: nextSeenBy, seenCount: Math.max(1, nextSeenBy.length) };
                });
                return changed ? { ...prev, [chatId]: next } : prev;
            });
            return;
        }
        setMessages(prev => {
            const list = prev[chatId];
            if (!list) return prev;
            let changed = false;
            const next = list.map(m => {
                if (m.seen) return m;
                changed = true;
                return { ...m, seen: true };
            });
            return changed ? { ...prev, [chatId]: next } : prev;
        });
        setChats(prev => prev.map(c => (c.id === chatId ? { ...c, unreadCount: 0 } : c)));
    }, []);

    const handleReactionUpdated = useCallback((chatId: string, messageId: string, reactions: any[]) => {
        setMessages(prev => {
            const arr = prev[chatId];
            if (!arr) return prev;
            const idx = arr.findIndex(m => m.id === messageId);
            if (idx === -1) return prev;
            const next = arr.slice();
            next[idx] = { ...arr[idx], reactions };
            return { ...prev, [chatId]: next };
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

    const handleAISearchResults = useCallback((payload: any) => {
        const messageId = String(payload?.messageId || '');
        const aiChatId = String(payload?.aiChatId || activeAIChatId || '');
        if (!messageId || !aiChatId) return;
        const sources: AISearchSource[] = Array.isArray(payload?.searchSources) ? payload.searchSources : [];
        setAIMessagesByChat((prev) => {
            const current = prev[aiChatId] || [];
            const idx = current.findIndex((m) => m.id === messageId);
            if (idx === -1) return prev;
            const next = [...current];
            next[idx] = { ...next[idx], searchEnabled: true, searchStatus: 'completed', searchSources: sources };
            return { ...prev, [aiChatId]: next };
        });
    }, [activeAIChatId]);

    const handleAIMemoriesUpdated = useCallback(async () => {
        try {
            const memories = await apiFetch('/ai/memories');
            if (Array.isArray(memories)) setAIMemories(memories);
        } catch (error) {
            console.error('Failed to reload AI memories:', error);
        }
    }, []);

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
        if (payload?.usage?.tokens) {
            setAIUsageStatus(payload.usage);
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
            next[targetIndex] = {
                ...next[targetIndex],
                ...messageWithChatId,
                ...(messageWithChatId.aiAttachment
                    ? { aiAttachment: { ...next[targetIndex].aiAttachment, ...messageWithChatId.aiAttachment } }
                    : {}),
            };
            return { ...prev, [aiChatId]: next };
        });
        setAIChats(prev => prev.map((c) => (
            c.id === aiChatId
                ? { ...c, updatedAt: Date.now() }
                : c
        )));
    }, [activeAIChatId]);

    const handleAIError = useCallback((payload: { message: string; code?: string; remaining?: number; usage?: AIUsageStatus }) => {
        const message = String(payload?.message || 'خطا در سرویس هوش مصنوعی');
        notify({ message, type: payload?.code === 'ai_daily_limit_reached' ? 'info' : 'error' });
        if (payload?.usage?.tokens) {
            setAIUsageStatus(payload.usage);
        }
        setAITyping(false);
        setAIResponding(false);
        setAIReasoningPending(false);
        setAIRespondingChatId(null);
    }, []);

    
    const { sendMessage: sendViaWS, editMessage: editViaWS, deleteMessage: deleteViaWS, sendSeen, sendTyping, sendUploadStatus, reconnectExhausted, reconnectNow, sendAIMessage, stopAIGeneration } = useWebSocket({
        token: authToken,
        enabled: !isChessGameRoute,
        onNewMessage: handleNewMessage,
        onMessageEdited: handleMessageEdited,
        onMessageDeleted: handleMessageDeleted,
        onUserStatusChange: handleUserStatusChange,
        onMessagesSeen: handleMessagesSeen,
        onReactionUpdated: handleReactionUpdated,
        onTypingStatus: handleTypingStatus,
        onUploadStatus: handleUploadStatus,
        onMessagePinned: handleMessagePinned,
        onMessageUnpinned: handleMessageUnpinned,
        onConnectionChange: setWsConnected,
        onReconnectExhausted: handleWsReconnectExhausted,
        onAINewMessage: handleNewAIMessage,
        onAIError: handleAIError,
        onAIUserMessageSaved: handleAIUserMessageSaved,
        onAIStreamStart: handleAIStreamStart,
        onAIStreamChunk: handleAIStreamChunk,
        onAIStreamDone: handleAIStreamDone,
        onAISearchResults: handleAISearchResults,
        onAIMemoriesUpdated: handleAIMemoriesUpdated,
    });

    useEffect(() => {
        setWsReconnectExhausted(reconnectExhausted);
    }, [reconnectExhausted]);

    
    useEffect(() => {
        if (!authToken) {
            setIsAuthChecking(false);
            return;
        }
        apiFetch('/profile/me')
            .then(async (user) => {
                if (authToken) {
                    localStorage.setItem('token', authToken);
                    document.cookie = `auth_token=${encodeURIComponent(authToken)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
                }
                const decryptedBio = await decryptBioClientSide(String(user?.bio || ''), authToken || '', String(user?.chatId || ''));
                setCurrentUser({ ...user, bio: decryptedBio });
                setIsAuthenticated(true);
            })
            .catch((error: any) => {
                if (Number(error?.status) === 401) {
                    localStorage.removeItem('token');
                    document.cookie = 'auth_token=; path=/; max-age=0; samesite=lax';
                    setAuthToken(null);
                    setIsAuthenticated(false);
                    setCurrentUser(null);
                }
            })
            .finally(() => {
                setIsAuthChecking(false);
            });
    }, [authToken]);

    const handleLoginSuccess = (user: User, token: string) => {
        localStorage.setItem('token', token);
        document.cookie = `auth_token=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
        setAuthToken(token);
        setCurrentUser(user);
        setIsAuthenticated(true);
        navigate('/', { replace: true });
    };

    const handleRegisterSuccess = (user: User, token: string) => {
        localStorage.setItem('token', token);
        document.cookie = `auth_token=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
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
        params?: { direction?: 'latest' | 'older' | 'newer'; cursorTs?: number; cursorId?: string; mode?: 'replace' | 'prepend' | 'append'; finalizeInitialLoad?: boolean }
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
            const existing = prev[chatId] || [];
            const merged = mergeMessages(existing, chunk, mode);
            if (merged === existing && prev[chatId]) return prev;
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

        if (direction === 'latest' && mode === 'replace') {
            jumpRangeChatIdsRef.current.delete(chatId);
        }

        if (params?.finalizeInitialLoad && chunk.length > 0) {
            setMessagesLoadedOnce((prev) => (prev[chatId] ? prev : { ...prev, [chatId]: true }));
            setMessagesLoading((prev) => (prev[chatId] ? { ...prev, [chatId]: false } : prev));
        }
        return chunk.length;
    }, [authToken, currentUser?.chatId]);

    const hasInitialWsConnectRef = useRef(false);
    const prevWsConnectedRef = useRef(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const wasInChessGameRef = useRef(false);

    useEffect(() => {
        if (isChessGameRoute) {
            wasInChessGameRef.current = true;
            return;
        }
        if (!wasInChessGameRef.current) return;
        wasInChessGameRef.current = false;
        setIsUpdating(true);
    }, [isChessGameRoute]);

    useEffect(() => {
        if (!isUpdating || !wsConnected) return;
        let cancelled = false;
        loadChats(false).finally(() => {
            if (!cancelled) setIsUpdating(false);
        });
        return () => {
            cancelled = true;
        };
    }, [isUpdating, wsConnected, loadChats]);

    useEffect(() => {
        const wasConnected = prevWsConnectedRef.current;
        prevWsConnectedRef.current = wsConnected;
        if (!wsConnected || !isAuthenticated) return;
        setWsReconnectExhausted(false);
        if (!wasConnected && hasInitialWsConnectRef.current) {
            loadChats(false);
            const currentActive = activeChatIdRef.current;
            if (currentActive) {
                fetchPagedMessages(currentActive, { direction: 'latest', mode: 'replace' })
                    .then(() => {
                        if (currentUser && currentActive !== `saved_messages_${currentUser.chatId}`) {
                            sendSeen(currentActive);
                        }
                    })
                    .catch((err) => console.error('Failed to sync messages after reconnect', err));
            }
        }
        hasInitialWsConnectRef.current = true;
    }, [wsConnected, isAuthenticated]);

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

                const state = messageRangeStateRef.current[targetChatId];
                const userIsViewingHistory = Boolean(state?.hasNewer);
                if (state?.newestCursor && !userIsViewingHistory) {
                    await fetchPagedMessages(targetChatId, {
                        direction: 'newer',
                        cursorTs: state.newestCursor.cursorTs,
                        cursorId: state.newestCursor.cursorId,
                        mode: 'append',
                    });
                } else if (!userIsViewingHistory && messagesLoadedOnceRef.current[targetChatId]) {
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
            if (wsConnected || isChessGameRoute) return;
            void syncFromServer();
        }, 15000);

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
        wsConnected,
        isChessGameRoute,
        loadChats,
        fetchPagedMessages,
        currentUser,
        sendSeen,
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

        
        const openingUnread = chatsRef.current.find(c => c.id === chatId)?.unreadCount || 0;
        setOpenChatUnread({ chatId, count: openingUnread });

        activeChatIdRef.current = chatId;
        viewRef.current = 'chatRoom';
        setActiveChatId(chatId);
        setView('chatRoom');
        if (shouldNavigate) {
            const savedMessagesId = currentUser ? `saved_messages_${currentUser.chatId}` : '';
            if (chatId === 'official-channel') {
                navigate('/official-channel');
            } else if (savedMessagesId && chatId === savedMessagesId) {
                navigate('/save-message');
            } else {
                navigate(`/chat/${encodeURIComponent(chatId)}`);
            }
        }

        setChats((prev) => {
            const target = prev.find((c) => c.id === chatId);
            if (!target || !target.unreadCount) return prev;
            return prev.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c));
        });

        const cachedMessages = messagesRef.current[chatId] || [];
        const lastKnownMessageId = chatsRef.current.find(c => c.id === chatId)?.lastMessage?.id;
        const cachedLastMessageId = cachedMessages[cachedMessages.length - 1]?.id;
        const jumpedRange = jumpRangeChatIdsRef.current.has(chatId);
        const hasNewerRange = jumpedRange
            || Boolean(messageRangeStateRef.current[chatId]?.hasNewer)
            || Boolean(lastKnownMessageId && cachedLastMessageId && lastKnownMessageId !== cachedLastMessageId);
        if (hasNewerRange) {
            setMessages(prev => (prev[chatId]?.length ? { ...prev, [chatId]: [] } : prev));
            setMessagesLoadedOnce(prev => (prev[chatId] ? { ...prev, [chatId]: false } : prev));
        }

        const inMemory = hasNewerRange ? [] : cachedMessages;
        let hasImmediateMessages = inMemory.length > 0;

        const shouldShowSkeleton = hasNewerRange || (!messagesLoadedOnceRef.current[chatId] && !hasImmediateMessages);
        if (shouldShowSkeleton) {
            if (hasNewerRange) {
                setMessagesLoading(prev => ({ ...prev, [chatId]: true }));
            } else {
                const cached = await getChatSnapshot(chatId);
                if (chatLoadRequestRef.current !== requestId) return;
                if (cached && cached.length > 0) {
                    hasImmediateMessages = true;
                    setMessages(prev => (prev[chatId]?.length ? prev : { ...prev, [chatId]: cached }));
                    setMessagesLoadedOnce(prev => (prev[chatId] ? prev : { ...prev, [chatId]: true }));
                } else {
                    setMessagesLoading(prev => ({ ...prev, [chatId]: true }));
                }
            }
        }

        try {
            if (hasImmediateMessages) {
                setMessagesLoadedOnce(prev => (prev[chatId] ? prev : { ...prev, [chatId]: true }));
                if (currentUser && chatId !== `saved_messages_${currentUser.chatId}`) {
                    sendSeen(chatId);
                }
                void fetchPagedMessages(chatId, { direction: 'latest', mode: 'replace' });
                return;
            }

            let loadedCount = await fetchPagedMessages(chatId, { direction: 'latest', mode: 'replace', finalizeInitialLoad: true });
            if (loadedCount === 0 && chatLoadRequestRef.current === requestId) {
                await new Promise((resolve) => window.setTimeout(resolve, 180));
                loadedCount = await fetchPagedMessages(chatId, { direction: 'latest', mode: 'replace', finalizeInitialLoad: true });
            }
            if (chatLoadRequestRef.current !== requestId) return;
            setMessagesLoadedOnce(prev => (prev[chatId] ? prev : { ...prev, [chatId]: true }));

            if (currentUser && chatId !== `saved_messages_${currentUser.chatId}`) {
                sendSeen(chatId);
            }
        } catch (err) {
            console.error(err);
        } finally {
            if (chatLoadRequestRef.current !== requestId) return;
            if (shouldShowSkeleton) {
                setMessagesLoading(prev => (prev[chatId] ? { ...prev, [chatId]: false } : prev));
            }
        }
    }, [sendSeen, currentUser, navigate, fetchPagedMessages]);

    const handleDragHoverChat = useCallback((chatId: string) => {
        if (!chatId) return;
        if (dragHoverPendingChatIdRef.current === chatId) return;
        dragHoverPendingChatIdRef.current = chatId;
        if (dragHoverChatTimerRef.current) {
            window.clearTimeout(dragHoverChatTimerRef.current);
        }
        dragHoverChatTimerRef.current = window.setTimeout(() => {
            void handleSelectChat(chatId);
            dragHoverPendingChatIdRef.current = null;
        }, 120);
    }, [handleSelectChat]);

    useEffect(() => () => {
        if (dragHoverChatTimerRef.current) {
            window.clearTimeout(dragHoverChatTimerRef.current);
        }
    }, []);

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
        if (pathname.startsWith('/login') || pathname.startsWith('/register') || pathname.startsWith('/reset-password')) return;

        if (pathname === '/' || pathname === '') {
            setView('chatList');
            setShowAIChat(false);
            setPendingUser(null);
            setActiveChatId(null);
            return;
        }

        if (pathname === '/new-chat') {
            setShowAIChat(false);
            setView('newChat');
            return;
        }

        if (pathname === '/profile') {
            setView('profile');
            return;
        }
        if (pathname === '/profile/edit') {
            setView('profileEdit');
            return;
        }
        if (pathname === '/settings' || pathname === '/settings/') {
            setView('settings');
            return;
        }
        if (pathname === '/settings/devices') {
            setView('settingsDevices');
            return;
        }
        if (pathname === '/settings/theme') {
            setView('settingsTheme');
            return;
        }
        if (pathname === '/settings/privacy') {
            setView('settingsPrivacy');
            return;
        }
        if (pathname === '/settings/data-storage') {
            setView('settingsDataStorage');
            return;
        }
        if (pathname === '/settings/devices/logs') {
            setView('settingsLogs');
            return;
        }
        if (pathname === '/settings/admin') {
            if (currentUser?.adminLevel) setView('settingsAdmin');
            else setView('settings');
            return;
        }
        if (pathname === '/settings/admin/panel' || pathname.startsWith('/settings/admin/panel/')) {
            if (currentUser?.adminLevel === 'admin0') setView('settingsAdminPanel');
            else setView('settings');
            return;
        }
        if (pathname === '/settings/admin/links') {
            if (currentUser?.adminLevel) setView('settingsAdminLinks');
            else setView('settings');
            return;
        }

        if (
            pathname === '/chess' ||
            pathname === '/chess/' ||
            /^\/chess\/game\/[A-Za-z0-9]+$/.test(pathname) ||
            /^\/chess\/join\/[A-Za-z0-9]+$/.test(pathname)
        ) {
            setShowAIChat(false);
            setPendingUser(null);
            setActiveChatId(null);
            setView('chess');
            return;
        }

        if (pathname === '/ai') {
            setActiveChatId(null);
            setPendingUser(null);
            setShowAIChat(true);
            setTemporaryAIChat(false);
            setView('chatRoom');
            return;
        }

        const aiChatMatch = pathname.match(/^\/ai\/c\/(.+)$/);
        if (aiChatMatch?.[1]) {
            const decodedAIChatId = decodeURIComponent(aiChatMatch[1]);
            setActiveChatId(null);
            setPendingUser(null);
            setShowAIChat(true);
            setView('chatRoom');
            if (decodedAIChatId === 'temporary') {
                return;
            }
            if (decodedAIChatId === 'new') {
                if (temporaryAIChat) {
                    setTemporaryAIChat(false);
                }
                if (activeAIChatId !== null) {
                    setActiveAIChatId(null);
                }
                return;
            }
            if (temporaryAIChat) {
                setTemporaryAIChat(false);
            }
            if (activeAIChatId !== decodedAIChatId) {
                setActiveAIChatId(decodedAIChatId);
            }
            return;
        }

        if (pathname === '/official-channel') {
            if (activeChatIdRef.current !== 'official-channel' || viewRef.current !== 'chatRoom') {
                handleSelectChat('official-channel', { navigateToRoute: false });
            }
            return;
        }

        if (pathname === '/save-message') {
            if (!currentUser) return;
            const savedMessagesId = `saved_messages_${currentUser.chatId}`;
            if (activeChatIdRef.current !== savedMessagesId || viewRef.current !== 'chatRoom') {
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
            activeChatIdRef.current = null;
            viewRef.current = 'chatRoom';
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
            if (activeChatIdRef.current !== decodedChatId || viewRef.current !== 'chatRoom' || showAIChat) {
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
        temporaryAIChat,
        activeAIChatId,
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



    const handleSendMessage = useCallback(async (payload: { text: string; replyToId?: string; editMessageId?: string; attachment?: PendingAttachment }) => {
        if (!currentUser) return;
        const text = payload.text;
        const attachment = payload.attachment;
        const makeClientId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const pushOptimisticMessage = (targetChatId: string, clientId: string) => {
            const now = Date.now();
            const sourceMessages = messages[targetChatId] || [];
            const replySrc = payload.replyToId ? sourceMessages.find((m) => m.id === payload.replyToId) : null;
            const optimisticFile: FileMetadata | undefined = attachment ? {
                fileId: `local-${clientId}`,
                fileName: attachment.file.name,
                fileSize: attachment.file.size,
                mimeType: attachment.file.type || 'application/octet-stream',
                uploadedAt: new Date(now).toISOString(),
                width: attachment.width,
                height: attachment.height,
                duration: attachment.duration,
                localUrl: URL.createObjectURL(attachment.file),
            } : undefined;
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
                file: optimisticFile,
                upload: attachment ? { phase: 'uploading', progress: 0 } : undefined,
                replyTo: replySrc ? { id: replySrc.id, senderId: replySrc.senderId, text: replySrc.text } : undefined,
            };
            setMessages((prev) => {
                const nextState = {
                    ...prev,
                    [targetChatId]: [...(prev[targetChatId] || []), optimistic],
                };
                return nextState;
            });
            setChats((prev) => prev.map((chat) => (
                chat.id === targetChatId
                    ? {
                        ...chat,
                        lastMessage: {
                            id: clientId,
                            text: text || '',
                            senderId: currentUser.chatId,
                            timestamp: now,
                            file: optimisticFile,
                        },
                    }
                    : chat
            )));
            if (attachment) setUploadProgress(clientId, { phase: 'uploading', progress: 0 });
            return optimisticFile?.localUrl;
        };

        const runFileSend = async (targetChatId: string, clientId: string, localUrl: string) => {
            if (!attachment) return;
            const controller = new AbortController();
            registerUpload(clientId, controller);
            sendUploadStatus(targetChatId, true);
            try {
                await enqueueUpload(targetChatId, async () => {
                    const file = await uploadChatFile({
                        attachment,
                        token: authToken || '',
                        chatId: targetChatId,
                        signal: controller.signal,
                        onPhase: (phase, progress) => {
                            setUploadProgress(clientId, { phase, progress });
                        },
                    });
                    registerLocalBlobUrl(file.fileId, localUrl);
                    const success = await sendViaWS(targetChatId, text, payload.replyToId, file, clientId);
                    if (!success) console.warn('WebSocket not connected, message was not sent');
                    clearUploadProgress(clientId);
                    window.setTimeout(() => {
                        localBlobUrls.delete(file.fileId);
                        URL.revokeObjectURL(localUrl);
                    }, 15000);
                });
            } catch (error) {
                clearUploadProgress(clientId);
                setMessages((prev) => ({
                    ...prev,
                    [targetChatId]: (prev[targetChatId] || []).filter((m) => m.id !== clientId),
                }));
                URL.revokeObjectURL(localUrl);
                void loadChats(false);
                if ((error as Error | undefined)?.message !== 'aborted') alert('خطا در آپلود فایل');
            } finally {
                releaseUpload(clientId);
                sendUploadStatus(targetChatId, false);
            }
        };

        const dispatch = async (targetChatId: string) => {
            const clientId = makeClientId();
            const localUrl = pushOptimisticMessage(targetChatId, clientId);
            if (!attachment || !localUrl) {
                const success = await sendViaWS(targetChatId, text, payload.replyToId, undefined, clientId);
                if (!success) console.warn('WebSocket not connected, message was not sent');
                return;
            }
            await runFileSend(targetChatId, clientId, localUrl);
        };

        if (payload.editMessageId) {
            if (!activeChatId) return;
            const success = await editViaWS(activeChatId, payload.editMessageId, text);
            if (!success) console.warn('WebSocket not connected');
            return;
        }

        const savedMessagesId = `saved_messages_${currentUser.chatId}`;
        if (activeChatId === savedMessagesId) {
            await dispatch(savedMessagesId);
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

                await dispatch(createdChatId);

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

        await dispatch(activeChatId);
    }, [activeChatId, currentUser, pendingUser, sendViaWS, editViaWS, loadChats, navigate, chats, isUserBlocked, messages, authToken, sendUploadStatus]);

    const handleDeleteMessage = useCallback((messageId: string) => {
        if (!activeChatId) return;

        const currentMessages = messages[activeChatId] || [];
        const msgToDelete = currentMessages.find(m => m.id === messageId);

        if (msgToDelete?.deliveryStatus === 'sending') {
            cancelUpload(messageId);
            setMessages((prev) => {
                const nextState = {
                    ...prev,
                    [activeChatId]: prev[activeChatId].filter((m) => m.id !== messageId)
                };
                return nextState;
            });
            return;
        }

        deleteViaWS(activeChatId, messageId);
    }, [activeChatId, deleteViaWS]);

    const handleDeleteMessages = useCallback(async (messageIds: string[]) => {
        if (!activeChatId || messageIds.length === 0) return;
        const currentMessages = messages[activeChatId] || [];
        const sendingIds = new Set<string>();
        const persistedIds: string[] = [];

        for (const id of messageIds) {
            const msg = currentMessages.find((m) => m.id === id);
            if (msg?.deliveryStatus === 'sending') {
                sendingIds.add(id);
                cancelUpload(id);
            } else {
                persistedIds.push(id);
            }
        }

        if (sendingIds.size > 0) {
            setMessages((prev) => ({
                ...prev,
                [activeChatId]: (prev[activeChatId] || []).filter((m) => !sendingIds.has(m.id)),
            }));
        }

        if (persistedIds.length === 0) return;

        setMessages((prev) => ({
            ...prev,
            [activeChatId]: (prev[activeChatId] || []).filter((m) => !persistedIds.includes(m.id)),
        }));

        try {
            await apiFetch(`/chats/${encodeURIComponent(activeChatId)}/messages/batch-delete`, {
                method: 'POST',
                body: JSON.stringify({ messageIds: persistedIds }),
            });
        } catch (err) {
            console.error('Failed to batch delete messages:', err);
            void fetchPagedMessages(activeChatId, { direction: 'latest', mode: 'replace' });
        }
    }, [activeChatId, messages, fetchPagedMessages]);

    const handleForwardMessage = useCallback(async (sourceChatId: string, messageIdOrIds: string | string[], targetChatId: string) => {
        const messageIds = (Array.isArray(messageIdOrIds) ? messageIdOrIds : [messageIdOrIds]).filter(Boolean);
        if (messageIds.length === 0) return;

        const sourceChat = chats.find((c) => c.id === sourceChatId);
        const chatMsgs = messages[sourceChatId] || [];
        const aiMsgsExact = aiMessagesByChat[sourceChatId] || [];
        const aiMsgsAll = Object.values(aiMessagesByChat).flat();

        const findSourceMessage = (id: string) =>
            chatMsgs.find((m) => m.id === id)
            || aiMsgsExact.find((m) => m.id === id)
            || aiMsgsAll.find((m) => m.id === id)
            || null;

        const resolvedEntries = messageIds
            .map((id, idx) => {
                const sourceMessage = findSourceMessage(id);
                if (!sourceMessage) return null;
                const forwardClientId = `fwd-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
                return { id, sourceMessage, forwardClientId };
            })
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

        if (resolvedEntries.length === 0) return;

        const oldIdToClientId = new Map<string, string>();
        const oldIdToSourceMsg = new Map<string, Message>();
        for (const entry of resolvedEntries) {
            oldIdToClientId.set(entry.id, entry.forwardClientId);
            oldIdToSourceMsg.set(entry.id, entry.sourceMessage);
        }

        const baseNow = Date.now();
        const optimisticForwards: Message[] = resolvedEntries.map((entry, idx) => {
            const { sourceMessage, forwardClientId } = entry;
            const sourceSenderId = String(sourceMessage.senderId || '');
            const isAI = sourceChatId.startsWith('ai_chat_') || Boolean(aiMsgsAll.find((m) => m.id === entry.id));
            const sourceSenderProfile = sourceSenderId === currentUser?.chatId
                ? currentUser
                : (sourceChat as any)?.otherUser;
            const fallbackForwardedFrom = isAI
                ? (sourceSenderId === currentUser?.chatId
                    ? {
                        originalSenderId: currentUser.chatId,
                        name: currentUser.name || currentUser.username || currentUser.chatId,
                        username: currentUser.username || '',
                    }
                    : {
                        originalSenderId: 'ai',
                        name: 'NovaRoom AI',
                        username: 'novaroom_ai',
                    })
                : {
                    originalSenderId: sourceSenderId || String((sourceChat as any)?.otherUser?.chatId || ''),
                    name: String((sourceSenderProfile as any)?.name || (sourceSenderProfile as any)?.username || sourceSenderId || 'ناشناس'),
                    username: String((sourceSenderProfile as any)?.username || ''),
                };

            const origReplyId = sourceMessage.replyTo?.id;
            const mappedReplyClientId = origReplyId ? oldIdToClientId.get(origReplyId) : undefined;
            const repliedSourceMsg = origReplyId ? oldIdToSourceMsg.get(origReplyId) : undefined;
            const optimisticReplyTo = mappedReplyClientId
                ? {
                    id: mappedReplyClientId,
                    senderId: currentUser?.chatId || '',
                    text: String(repliedSourceMsg?.text || sourceMessage.replyTo?.text || ''),
                }
                : undefined;

            return {
                id: forwardClientId,
                clientId: forwardClientId,
                chatId: targetChatId,
                senderId: currentUser?.chatId || '',
                text: String(sourceMessage.text || ''),
                timestamp: baseNow + idx,
                seen: false,
                deliveryStatus: 'sending',
                file: sourceMessage.file,
                upload: sourceMessage.file ? { phase: 'encrypting', progress: 100 } : undefined,
                forwarding: sourceMessage.file ? true : undefined,
                replyTo: optimisticReplyTo,
                forwardedFrom: sourceMessage.forwardedFrom || fallbackForwardedFrom,
                reasoningContent: sourceMessage.reasoningContent,
                reasoningEnabled: sourceMessage.reasoningEnabled,
                reasoningDurationSec: sourceMessage.reasoningDurationSec,
                aiModelKey: sourceMessage.aiModelKey,
                aiModelName: sourceMessage.aiModelName,
            };
        });

        setMessages((prev) => ({
            ...prev,
            [targetChatId]: [...(prev[targetChatId] || []), ...optimisticForwards],
        }));

        const clientIdsSet = new Set(resolvedEntries.map((e) => e.forwardClientId));
        for (const entry of resolvedEntries) {
            if (entry.sourceMessage.file) setUploadProgress(entry.forwardClientId, { phase: 'encrypting', progress: 100 });
        }
        const clearForwardProgress = () => {
            clientIdsSet.forEach((id) => clearUploadProgress(id));
        };

        try {
            const items = await Promise.all(resolvedEntries.map(async ({ id, sourceMessage, forwardClientId }) => {
                const encryptedText = await encryptChatTextClientSide(String(sourceMessage.text || ''), authToken || '', targetChatId);
                const encryptedReasoningContent = sourceMessage.reasoningContent
                    ? await encryptChatTextClientSide(String(sourceMessage.reasoningContent || ''), authToken || '', targetChatId)
                    : undefined;
                const origReplyId = sourceMessage.replyTo?.id;
                let encryptedReplyText: string | undefined;
                if (origReplyId && oldIdToSourceMsg.has(origReplyId)) {
                    const parentMsg = oldIdToSourceMsg.get(origReplyId);
                    const rawReplyText = String(parentMsg?.text || sourceMessage.replyTo?.text || '');
                    encryptedReplyText = await encryptChatTextClientSide(rawReplyText, authToken || '', targetChatId);
                }
                return {
                    messageId: id,
                    encryptedText,
                    encryptedReasoningContent,
                    encryptedReplyText,
                    clientId: forwardClientId,
                };
            }));

            await apiFetch('/messages/forward', {
                method: 'POST',
                body: JSON.stringify({
                    sourceChatId,
                    targetChatId,
                    items,
                }),
            });

            clearForwardProgress();
            setMessages((prev) => ({
                ...prev,
                [targetChatId]: (prev[targetChatId] || []).filter((m) => !clientIdsSet.has(m.id)),
            }));

            if (activeChatId === targetChatId) {
                try {
                    await fetchPagedMessages(targetChatId, { direction: 'latest', mode: 'replace' });
                } catch (syncErr) {
                    console.warn('Failed to sync forwarded messages immediately', syncErr);
                }
            }
        } catch (e) {
            console.error('Failed to forward messages', e);
            clearForwardProgress();
            setMessages((prev) => ({
                ...prev,
                [targetChatId]: (prev[targetChatId] || []).filter((m) => !clientIdsSet.has(m.id)),
            }));
            throw e;
        }
        loadChats(false);
    }, [loadChats, messages, aiMessagesByChat, authToken, currentUser, chats, activeChatId, fetchPagedMessages]);

    const handleSetPendingForwardDraft = useCallback((targetChatId: string, draft: PendingForwardDraft) => {
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

        const myId = currentUser?.chatId;
        if (myId) {
            const existing = chatsRef.current.find((c) => {
                
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
                
                setChats(prev => [newGroupChat, ...prev.filter(c => c.id !== res.chatId)]);
            }

            
            
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
            if (res?.chatId) {
                handleSelectChat(res.chatId);
            } else {
                setView('chatList');
                navigate('/', { replace: true });
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

    const handleOpenProfile = useCallback(() => {
        setView('profile');
        navigate('/profile');
    }, [navigate]);
    const handleOpenSettings = useCallback(() => {
        setView('settings');
        navigate('/settings');
    }, [navigate]);
    const handleNewChatClick = useCallback(() => {
        setView('newChat');
        navigate('/new-chat');
    }, [navigate]);
    const handleCloseNewChat = useCallback(() => {
        setView('chatList');
        navigate('/', { replace: true });
    }, [navigate]);
    const cleanupTemporaryAIChat = useCallback(async (chatId: string) => {
        try {
            await apiFetch(`/ai/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
        } catch {
            
        }
        setAIChats((prev) => prev.filter((c) => c.id !== chatId));
        setAIMessagesByChat((prev) => {
            const next = { ...prev };
            delete next[chatId];
            return next;
        });
        setActiveAIChatId((prev) => (prev === chatId ? null : prev));
    }, []);
    const disposeChatSession = useCallback((chatId: string | null) => {
        if (!chatId) return;
        setMessagesLoading((prev) => {
            if (!prev[chatId]) return prev;
            const { [chatId]: _, ...rest } = prev;
            return rest;
        });
        const nextRecent = [...recentChatIdsRef.current.filter((id) => id !== chatId), chatId];
        const evictedIds = nextRecent.length > 10 ? nextRecent.slice(0, nextRecent.length - 10) : [];
        recentChatIdsRef.current = nextRecent.slice(-10);
        const willTrim = (messagesRef.current[chatId]?.length ?? 0) > MESSAGE_PAGE_SIZE;

        setMessages((prev) => {
            let changed = false;
            const next = { ...prev };
            const currentList = next[chatId];
            if (currentList && currentList.length > MESSAGE_PAGE_SIZE) {
                next[chatId] = currentList.slice(-MESSAGE_PAGE_SIZE);
                changed = true;
            }
            for (const evictId of evictedIds) {
                if (evictId in next) {
                    delete next[evictId];
                    changed = true;
                }
            }
            return changed ? next : prev;
        });

        if (evictedIds.length > 0) {
            setMessagesLoadedOnce((prev) => {
                const next = { ...prev };
                evictedIds.forEach((id) => delete next[id]);
                return next;
            });
            setMessageRangeState((prev) => {
                const next = { ...prev };
                evictedIds.forEach((id) => delete next[id]);
                return next;
            });
        }
        if (willTrim) {
            setMessageRangeState((prev) => {
                if (!prev[chatId]) return prev;
                const { [chatId]: _, ...rest } = prev;
                return rest;
            });
        }
    }, []);
    const handleBack = () => {
        if (temporaryAIChat && activeAIChatId && !aiResponding) {
            void cleanupTemporaryAIChat(activeAIChatId);
        }
        if (!showAIChat) {
            disposeChatSession(activeChatIdRef.current);
        }
        setView('chatList');
        setPendingUser(null);
        setShowAIChat(false);
        setActiveChatId(null);
        setTemporaryAIChat(false);
        navigate('/', { replace: true });
    };

    const handleCloseChat = () => {
        disposeChatSession(activeChatIdRef.current);
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

    const getAIRoutePath = useCallback((chatId: string | null, temporary: boolean): string => {
        if (temporary) return '/ai/c/temporary';
        if (chatId) return `/ai/c/${encodeURIComponent(chatId)}`;
        return '/ai/c/new';
    }, []);

    const handleOpenAIChat = useCallback(() => {
        setActiveChatId(null);
        setPendingUser(null);
        setShowAIChat(true);
        setView('chatRoom');
        if (aiResponding && aiRespondingChatId) {
            setActiveAIChatId(aiRespondingChatId);
            setTemporaryAIChat(false);
            navigate(`/ai/c/${encodeURIComponent(aiRespondingChatId)}`);
        } else {
            setActiveAIChatId(null);
            setTemporaryAIChat(false);
            navigate('/ai/c/new');
        }
    }, [aiResponding, aiRespondingChatId, navigate]);

    const handleSelectNavTab = useCallback((tab: 'ai' | 'chess' | 'chats' | 'settings' | 'profile') => {
        if (tab === 'ai') {
            handleOpenAIChat();
        } else if (tab === 'chess') {
            setShowAIChat(false);
            setActiveChatId(null);
            setView('chess');
            navigate('/chess');
        } else if (tab === 'chats') {
            if (showAIChat || view !== 'chatList') {
                setShowAIChat(false);
                setView('chatList');
                setActiveChatId(null);
                navigate('/', { replace: true });
            }
        } else if (tab === 'settings') {
            handleOpenSettings();
        } else if (tab === 'profile') {
            handleOpenProfile();
        }
    }, [showAIChat, view, handleOpenAIChat, handleOpenSettings, handleOpenProfile, navigate]);

    const handleCreateAIChat = useCallback(() => {
        if (temporaryAIChat && activeAIChatId && !aiResponding) {
            void cleanupTemporaryAIChat(activeAIChatId);
        }
        setTemporaryAIChat(false);
        setActiveAIChatId(null);
        navigate('/ai/c/new');
    }, [temporaryAIChat, activeAIChatId, aiResponding, cleanupTemporaryAIChat, navigate]);

    const handleCreateTemporaryAIChat = useCallback(async () => {
        try {
            const created = await apiFetch('/ai/chats', { method: 'POST', body: JSON.stringify({ temporary: true }) });
            setAIMessagesByChat((prev) => ({ ...prev, [created.id]: [] }));
            setActiveAIChatId(created.id);
            setTemporaryAIChat(true);
            navigate('/ai/c/temporary', { replace: true });
        } catch (error) {
            console.error('Failed to create temporary AI chat', error);
            notify({ message: 'ساخت گفتگوی موقت انجام نشد.', type: 'error' });
        }
    }, []);


    useEffect(() => {
        if (!isAuthenticated || !showAIChat) return;
        if (location.pathname !== '/ai/c/temporary') return;
        if (temporaryAIChat) return;
        void handleCreateTemporaryAIChat();
    }, [isAuthenticated, showAIChat, location.pathname, temporaryAIChat, handleCreateTemporaryAIChat]);

    const handleSelectAIChat = useCallback((chatId: string) => {
        if (temporaryAIChat && activeAIChatId && chatId !== activeAIChatId && !aiResponding) {
            void cleanupTemporaryAIChat(activeAIChatId);
            setTemporaryAIChat(false);
        }
        setActiveAIChatId(chatId);
        navigate(`/ai/c/${encodeURIComponent(chatId)}`);
    }, [temporaryAIChat, activeAIChatId, aiResponding, cleanupTemporaryAIChat, navigate]);


    useEffect(() => {
        if (!isAuthenticated || !showAIChat) return;
        if (location.pathname === '/' || location.pathname === '') return;
        if (location.pathname.startsWith('/ai/c/')) return;
        const nextPath = getAIRoutePath(activeAIChatId, temporaryAIChat);
        if (location.pathname !== nextPath) {
            navigate(nextPath, { replace: true });
        }
    }, [isAuthenticated, showAIChat, activeAIChatId, temporaryAIChat, location.pathname, navigate, getAIRoutePath]);

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
                navigate('/ai/c/new', { replace: true });
            } else if (location.pathname === `/ai/c/${encodeURIComponent(chatId)}`) {
                navigate('/ai/c/new', { replace: true });
            }
        } catch (error) {
            console.error('Failed to delete AI chat', error);
            alert('حذف گفتگو با خطا مواجه شد');
        }
    }, [activeAIChatId, location.pathname, navigate]);

    const handleRenameAIChat = useCallback(async (chatId: string, nextTitle: string): Promise<boolean> => {
        const trimmed = nextTitle.trim();
        if (!trimmed) {
            notify({ message: 'عنوان گفتگو نمی‌تواند خالی باشد.', type: 'info' });
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
            notify({ message: 'تغییر نام گفتگو انجام نشد.', type: 'error' });
            return false;
        }
    }, []);

    const handleAddAIMemory = useCallback(async (content: string): Promise<boolean> => {
        const trimmed = content.trim();
        if (!trimmed) return false;
        try {
            const created = await apiFetch('/ai/memories', {
                method: 'POST',
                body: JSON.stringify({ content: trimmed }),
            });
            setAIMemories((prev) => [created, ...prev].slice(0, 10));
            return true;
        } catch (error: any) {
            notify({ message: error?.message || 'ذخیره حافظه انجام نشد.', type: 'error' });
            return false;
        }
    }, []);

    const handleDeleteAIMemory = useCallback(async (memoryId: string) => {
        try {
            await apiFetch(`/ai/memories/${encodeURIComponent(memoryId)}`, { method: 'DELETE' });
            setAIMemories((prev) => prev.filter((item) => item.id !== memoryId));
        } catch (error) {
            console.error('Failed to delete AI memory', error);
            notify({ message: 'حذف حافظه انجام نشد.', type: 'error' });
        }
    }, []);

    const handleOpenSavedMessages = useCallback(() => {
        if (!currentUser) return;
        const savedMessagesId = `saved_messages_${currentUser.chatId}`;
        navigate('/save-message');
        handleSelectChat(savedMessagesId, { navigateToRoute: false });
    }, [currentUser, handleSelectChat, navigate]);

    const handleSendAIMessage = useCallback(async (text: string, useReasoner = false, modelKey: AIModelKey = 'nova-flash', useWebSearch = false, attachment: AIAttachmentMeta | null = null): Promise<boolean> => {
        if (!currentUser) return false;
        if (!text.trim() && !attachment) return false;
        if (aiSendInFlightRef.current) return false;
        if (aiUsageStatus.tokens.exhausted) {
            notify({ message: 'سهمیه ۲۰٬۰۰۰ توکنی امروز شما تکمیل شده است. تا ۰۰:۰۰ به وقت تهران صبر کنید.', type: 'info' });
            return false;
        }
        if (useWebSearch && aiUsageStatus.search.remaining <= 0) {
            notify({ message: 'سقف ۵ جستجوی روزانه شما تکمیل شده است.', type: 'info' });
            return false;
        }
        if (attachment && aiUsageStatus.files.remaining <= 0) {
            notify({ message: 'سقف ۵ فایل روزانه شما تکمیل شده است.', type: 'info' });
            return false;
        }
        aiSendInFlightRef.current = true;
        try {

            if (aiResponding && aiRespondingChatId && activeAIChatId !== aiRespondingChatId) {
                const respondingTitle = aiChats.find((c) => c.id === aiRespondingChatId)?.title || 'گفتگوی در حال پاسخ';
                notify({ message: `گفتگوی «${respondingTitle}» هنوز تکمیل نشده است.`, type: 'info' });
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
                    alert('ساخت گفتگوی جدید با خطا مواجه شد');
                    setAITyping(false);
                    setAIResponding(false);
                    setAIReasoningPending(false);
                    return false;
                }
            }
            if (!targetChatId) return false;

            const finalChatId = targetChatId;
            const targetRoute = `/ai-chat/${encodeURIComponent(finalChatId)}`;
            if (location.pathname !== targetRoute) {
                navigate(targetRoute);
            }

            const currentAIChatMessages = aiMessagesByChat[finalChatId] || [];
            const sentCount = currentAIChatMessages.filter((m) => m.senderId === currentUser.chatId).length;
            if (sentCount >= 60) {
                alert('حداکثر ۶۰ پیام در هر گفتگو مجاز است. لطفاً یک چت جدید باز کنید.');
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
                ...(attachment ? { aiAttachment: attachment } : {}),
            };

            setAIMessagesByChat((prev) => ({
                ...prev,
                [finalChatId]: [...(prev[finalChatId] || []), userMessage],
            }));
            setAIRespondingChatId(finalChatId);

            const success = sendAIMessage(
                text,
                finalChatId,
                clientId,
                useReasoner,
                modelKey,
                useWebSearch,
                attachment?.tempFileId
                    ? {
                        tempFileId: attachment.tempFileId,
                        fileName: attachment.fileName,
                        fileSize: attachment.fileSize,
                        mimeType: attachment.mimeType,
                        isImage: attachment.isImage,
                    }
                    : null,
            );
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
        } finally {
            aiSendInFlightRef.current = false;
        }
    }, [currentUser, activeAIChatId, aiMessagesByChat, sendAIMessage, aiResponding, aiRespondingChatId, aiChats, aiUsageStatus, location.pathname, navigate]);

    const handleStopAIResponse = useCallback(() => {
        const success = stopAIGeneration();
        if (!success) return;
        setAITyping(false);
        setAIResponding(false);
        setAIReasoningPending(false);
        setAIRespondingChatId(null);
    }, [stopAIGeneration]);

    const getActiveContact = useCallback((): User => {
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
                lastSeen: (chat.otherUser as any)?.lastSeen,
                lastSeenCategory: (chat.otherUser as any)?.lastSeenCategory,
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
    }, [pendingUser, currentUser, activeChatId, chats]);

    const activeContact = useMemo(() => getActiveContact(), [getActiveContact]);

    useEffect(() => {
        if (!isAuthenticated) return;
        apiFetch('/auth/login-events').then((r: any) => {
            setLoginEvents(Array.isArray(r?.events) ? r.events : []);
            setUnseenLoginCount(Number(r?.unseenCount || 0));
        }).catch(() => { });
    }, [isAuthenticated, location.pathname]);

    useEffect(() => {
        if (!isAuthenticated) return;
        if (location.pathname !== '/settings/devices/logs') return;
        apiFetch('/auth/login-events/mark-seen', { method: 'POST' }).then(() => setUnseenLoginCount(0)).catch(() => { });
    }, [isAuthenticated, location.pathname]);

    if (isAuthChecking) {
        return null;
    }

    const resetTokenMatch = location.pathname.match(/^\/reset-password\/([^/]+)$/);
    if (resetTokenMatch?.[1]) {
        return <ResetPasswordLink key={resetTokenMatch[1]} token={decodeURIComponent(resetTokenMatch[1])} />;
    }

    
    if (!isAuthenticated) {
        return (
            <Routes>
                <Route path="/login" element={
                    <Login onLoginSuccess={handleLoginSuccess} />
                } />
                <Route path="/register/:token" element={
                    <Register
                        onRegisterSuccess={handleRegisterSuccess}
                        onBackToLogin={() => navigate('/login')}
                    />
                } />
                <Route path="/chess/join/:inviteToken" element={
                    <ChessJoinPage authToken={null} currentUser={null} />
                } />
                <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
        );
    }

    
    const authPages = ['/login', '/register'];
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
    const isActiveAIResponding = Boolean(activeAIChatId && aiRespondingChatId && activeAIChatId === aiRespondingChatId);

    const initialUnreadCount = openChatUnread?.chatId && openChatUnread.chatId === (activeChatId || 'pending')
        ? openChatUnread.count
        : 0;

    const currentSearchParams = new URLSearchParams(location.search);
    const isInfoRouteActive = currentSearchParams.get('panel') === 'info' && view !== 'profile' && view !== 'profileEdit';

    const activeNavTab: 'ai' | 'chess' | 'chats' | 'settings' | 'profile' = showAIChat
        ? 'ai'
        : view === 'chess'
        ? 'chess'
        : view === 'profile' || view === 'profileEdit'
        ? 'profile'
        : String(view).startsWith('settings')
        ? 'settings'
        : 'chats';

    return (
        <MusicPlayerProvider>
            <NotificationCenter />
            <div className={cx('app', 'app--resizable-desktop')} style={desktopSidebarWidth != null ? ({ ['--desktop-sidebar-width' as string]: `${desktopSidebarWidth}px` }) : undefined}>
                {!showAIChat && (
                    <div className={cx('app__sidebar', (view === 'chatRoom' || view === 'newChat' || view === 'chess' || view === 'profile' || view === 'profileEdit' || String(view).startsWith('settings')) && 'app__sidebar--hidden-mobile')}>
                        <ChatList
                            chats={chats}
                            currentUser={currentUser!}
                            activeChatId={activeChatId}
                            wsConnected={wsConnected || isChessGameRoute}
                            wsReconnectExhausted={wsReconnectExhausted}
                            isUpdating={isUpdating}
                            interactiveOnlineUsers={interactiveOnlineUsers}
                            onSelectChat={handleSelectChat}
                            onNewChatClick={handleNewChatClick}
                            onLogout={handleLogout}
                            onOpenAIChat={handleOpenAIChat}
                            onOpenSavedMessages={handleOpenSavedMessages}
                            onReconnectNow={reconnectNow}
                            onDragHoverChat={handleDragHoverChat}
                            loading={isInitialChatsLoad}
                        />
                        <BottomNavbar
                            activeTab={activeNavTab}
                            onSelectTab={handleSelectNavTab}
                            currentUser={currentUser}
                            hasUnseenSettings={unseenLoginCount > 0}
                        />
                    </div>
                )}

                {showAIChat && (
                    <main className="app__main app__main--full">
                        <AIChatRoom
                            messages={aiMessages}
                            currentUserId={currentUser!.chatId}
                            onSendMessage={handleSendAIMessage}
                            selectedModel={selectedAIModel}
                            onSelectModel={setSelectedAIModel}
                            usageStatus={aiUsageStatus}
                            memories={aiMemories}
                            onAddMemory={handleAddAIMemory}
                            onDeleteMemory={handleDeleteAIMemory}
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
                            onCreateAIChat={handleCreateAIChat}
                            onCreateTemporaryAIChat={handleCreateTemporaryAIChat}
                            onSelectAIChat={handleSelectAIChat}
                            onDeleteAIChat={handleDeleteAIChat}
                            onRenameAIChat={handleRenameAIChat}
                            respondingAIChatId={aiRespondingChatId}
                            temporaryMode={temporaryAIChat}
                            currentUserVerified={Boolean((currentUser as any)?.verified)}
                        />
                    </main>
                )}

                {!showAIChat && (
                    <div
                        className="app__resizer"
                        onMouseDown={(event) => {
                            if (window.innerWidth < DESKTOP_BREAKPOINT) return;
                            event.preventDefault();
                            setIsResizingDesktopLayout(true);
                        }}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize panels"
                    />
                )}

                {!showAIChat && (
                    <main className={cx('app__main', view === 'chatList' && 'app__main--hidden-mobile')} style={{ position: 'relative' }}>
                        {view === 'newChat' ? (
                            <NewChatModal
                                onClose={handleCloseNewChat}
                                onUserSelected={handleUserSelectedFromModal}
                                onCreateGroup={handleCreateGroup}
                                onJoinGroup={handleJoinGroup}
                                currentUser={currentUser}
                            />
                        ) : view === 'chess' && currentUser ? (
                            <>
                                {chessJoinToken ? (
                                    <ChessJoinPage
                                        key={chessJoinToken}
                                        authToken={authToken}
                                        currentUser={currentUser}
                                    />
                                ) : (
                                    <ChessScreen
                                        currentUser={currentUser}
                                        gameId={location.pathname.match(/^\/chess\/game\/([A-Za-z0-9]+)$/)?.[1] ?? null}
                                        authToken={authToken}
                                        chats={chats}
                                        interactiveOnlineUsers={interactiveOnlineUsers}
                                        isUserBlocked={isUserBlocked}
                                        onToggleBlockUser={toggleBlockUser}
                                        onOpenDirectChat={(user) => handleUserSelectedFromModal(user)}
                                        onOpenProfile={handleOpenProfile}
                                        onContactOpenChange={setChessContactOpen}
                                        onOpenGame={(id) => navigate(`/chess/game/${id}`)}
                                        onExitGame={() => navigate('/chess')}
                                    />
                                )}
                                {!isChessGameRoute && !chessJoinToken && !chessContactOpen && (
                                    <BottomNavbar
                                        activeTab={activeNavTab}
                                        onSelectTab={handleSelectNavTab}
                                        currentUser={currentUser}
                                        hasUnseenSettings={unseenLoginCount > 0}
                                    />
                                )}
                            </>
                        ) : (view === 'profile' || view === 'profileEdit') && currentUser ? (
                            <>
                                <Profile
                                    key={view}
                                    user={currentUser}
                                    mode={view === 'profileEdit' ? 'edit' : 'view'}
                                    onUpdateProfile={async (u) => {
                                        await apiFetch('/profile/me', { method: 'PATCH', body: JSON.stringify(u) });
                                        setCurrentUser(prev => (prev ? { ...prev, ...u } : null));
                                    }}
                                    onEdit={() => {
                                        setView('profileEdit');
                                        navigate('/profile/edit');
                                    }}
                                    onFinishEdit={() => {
                                        setView('profile');
                                        navigate('/profile');
                                    }}
                                    onLogout={handleLogout}
                                />
                                {view === 'profile' && (
                                    <BottomNavbar
                                        activeTab={activeNavTab}
                                        onSelectTab={handleSelectNavTab}
                                        currentUser={currentUser}
                                        hasUnseenSettings={unseenLoginCount > 0}
                                    />
                                )}
                            </>
                        ) : String(view).startsWith('settings') ? (
                            <>
                                <Settings
                                    key={view}
                                    section={view === 'settingsDevices' ? 'devices' : view === 'settingsTheme' ? 'theme' : view === 'settingsLogs' ? 'logs' : view === 'settingsDataStorage' ? 'dataStorage' : view === 'settingsPrivacy' ? 'privacy' : view === 'settingsAdmin' ? 'adminMenu' : view === 'settingsAdminPanel' ? 'adminPanel' : view === 'settingsAdminLinks' ? 'adminLinks' : 'menu'}
                                    adminSection={adminPanelSection}
                                    onAdminSectionChange={(adminSection) => navigate(adminSection === 'users' ? '/settings/admin/panel' : `/settings/admin/panel/${adminSection}`)}
                                    onOpenSection={(section) => navigate(section === 'logs' ? '/settings/devices/logs' : section === 'dataStorage' ? '/settings/data-storage' : section === 'privacy' ? '/settings/privacy' : section === 'adminMenu' ? '/settings/admin' : section === 'adminPanel' ? '/settings/admin/panel' : section === 'adminLinks' ? '/settings/admin/links' : `/settings/${section}`)}
                                    onBackToMenu={() => navigate('/settings')}
                                    loginEvents={loginEvents}
                                    hasUnseenLoginLogs={unseenLoginCount > 0}
                                    currentUser={currentUser}
                                    onUpdateCurrentUser={(updates) => setCurrentUser((prev) => prev ? { ...prev, ...updates } : prev)}
                                    onLogout={handleLogout}
                                />
                                {view === 'settings' && (
                                    <BottomNavbar
                                        activeTab={activeNavTab}
                                        onSelectTab={handleSelectNavTab}
                                        currentUser={currentUser}
                                        hasUnseenSettings={unseenLoginCount > 0}
                                    />
                                )}
                            </>
                        ) : view === 'chatRoom' && (activeChat || pendingUser || isSavedMessagesActive || activeChatId) ? (
                            <ChatRoom
                                key={activeChatId || 'pending'}
                                chatId={activeChatId || 'pending'}
                                contact={activeContact}
                                messages={activeMessages}
                                currentUserId={currentUser!.chatId}
                                currentUser={currentUser}
                                interactiveOnlineUsers={interactiveOnlineUsers}
                                onSendMessage={handleSendMessage}
                                onDeleteMessage={handleDeleteMessage}
                                onDeleteMessages={handleDeleteMessages}
                                onBack={handleBack}
                                onCloseChat={handleCloseChat}
                                onChatDeleted={handleChatDeleted}
                                loading={activeMessagesLoading || (!activeChat && !pendingUser && !isSavedMessagesActive)}
                                chats={chats}
                                onSelectChat={handleSelectChat}
                                onOpenDirectChat={(user) => handleUserSelectedFromModal(user)}
                                onOpenProfile={handleOpenProfile}
                                onOpenAIChat={handleOpenAIChat}
                                onOpenContactInfo={(targetChatId) => navigate(`/chat/${encodeURIComponent(targetChatId)}?panel=info`)}
                                forceContactInfoOpen={isInfoRouteActive}
                                onCloseForcedContactInfo={(currentChatId) => {
                                    if (location.search.includes('panel=info')) {
                                        navigate(-1);
                                        return;
                                    }
                                    const backChatId = currentChatId || activeChatId;
                                    navigate(backChatId && backChatId !== 'pending' ? `/chat/${encodeURIComponent(backChatId)}` : '/');
                                }}
                                initialUnreadCount={initialUnreadCount}
                                onConsumeInitialUnread={consumeOpenChatUnread}
                                onForwardMessage={handleForwardMessage}
                                pendingForwardDraft={activeChatId ? (pendingForwardDrafts[activeChatId] || null) : null}
                                onSetPendingForwardDraft={handleSetPendingForwardDraft}
                                onClearPendingForwardDraft={handleClearPendingForwardDraft}
                                typingUserIds={typingUserIdsByChat[activeChatId || 'pending'] || EMPTY_IDS}
                                uploadingUserIds={uploadingUserIdsByChat[activeChatId || 'pending'] || EMPTY_IDS}
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
                                pinnedMessage={activeChat?.pinnedMessage}
                                onPinMessage={handlePinMessage}
                                onUnpinMessage={handleUnpinMessage}
                                onJumpToMessage={handleJumpToMessage}
                                targetScrollMessage={targetScrollMessage}
                                jumpingToMessage={Boolean(jumpLoading && jumpLoading.chatId === (activeChatId || 'pending'))}
                                onJumpToMessageSettled={handleJumpToMessageSettled}
                                onCancelJumpToMessage={handleCancelJumpToMessage}
                            />
                        ) : (
                            <EmptyState />
                        )}
                    </main>
                )}
            </div>
            <MiniMusicPlayer />
        </MusicPlayerProvider>
    );
}
