import { useState, useEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, Copy, Check, SendHorizontal, Brain, PanelRight, PencilLine, Trash2, History, CornerUpLeft, ChevronDown, Menu, Pin, PinOff, MessageSquareDashed } from 'lucide-react';
import { motion, AnimatePresence, type Variants } from "framer-motion";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Components } from 'react-markdown';
import type { Message, Chat, FileMetadata, AIChatSummary, AIModelKey } from '../types';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';
import { ForwardModal } from './ForwardModal';
import { notify } from '../utils/notificationBus';

interface AIChatRoomProps {
    messages: Message[];
    currentUserId: string;
    onSendMessage: (text: string, useReasoner?: boolean, modelKey?: AIModelKey) => boolean | Promise<boolean>;
    selectedModel: AIModelKey;
    onSelectModel: (modelKey: AIModelKey) => void;
    proRemainingToday: number;
    flashRemainingToday: number;
    onStopGenerating?: () => void;
    onDeleteMessage: (messageId: string) => void;
    onBack: () => void;
    loading?: boolean;
    isTyping?: boolean;
    isResponding?: boolean;
    isReasoningPending?: boolean;
    chats: Chat[];
    onSelectChat?: (chatId: string) => void;
    onSetPendingForwardDraft?: (targetChatId: string, draft: { sourceChatId: string; messageId: string; previewText?: string; previewFile?: FileMetadata | null }) => void;
    aiChats: AIChatSummary[];
    activeAIChatId: string | null;
    activeAIChatTitle?: string;
    onCreateAIChat: () => void;
    onCreateTemporaryAIChat?: () => void;
    onSelectAIChat: (chatId: string) => void;
    onDeleteAIChat: (chatId: string) => void;
    onRenameAIChat: (chatId: string, nextTitle: string) => Promise<boolean>;
    respondingAIChatId?: string | null;
    temporaryMode?: boolean;
    currentUserVerified?: boolean;
}

const IRAN_OFFSET_MS = 210 * 60 * 1000; // +03:30

function normalizeTs(ts: unknown): number {
    if (ts == null) return Date.now();
    if (typeof ts === 'string') {
        const n = Date.parse(ts);
        return Number.isFinite(n) ? n : Date.now();
    }
    if (typeof ts === 'number') {
        return ts < 1_000_000_000_000 ? ts * 1000 : ts;
    }
    if (ts instanceof Date) return ts.getTime();
    return Date.now();
}

function iranShiftedDate(ts: unknown): Date {
    return new Date(normalizeTs(ts) + IRAN_OFFSET_MS);
}

function formatMessageTime(ts: unknown) {
    const d = iranShiftedDate(ts);
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
    return toPersianDigits(time);
}

function toPersianDigits(value: string | number): string {
    return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
}

function setCookie(name: string, value: string, maxAgeSec = 60 * 60 * 4) {
    if (typeof document === 'undefined') return;
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; samesite=lax`;
}

function getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const key = `${encodeURIComponent(name)}=`;
    const row = document.cookie.split('; ').find((item) => item.startsWith(key));
    if (!row) return null;
    return decodeURIComponent(row.slice(key.length));
}

function deleteCookie(name: string) {
    if (typeof document === 'undefined') return;
    document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; samesite=lax`;
}

// ─── CodeBlock with copy button ───────────────────────────────────────────────
function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const code = typeof children === 'string' ? children : String(children ?? '');
        try {
            if (navigator.clipboard && (window as unknown as { isSecureContext?: boolean }).isSecureContext) {
                await navigator.clipboard.writeText(code);
            } else {
                const ta = document.createElement('textarea');
                ta.value = code;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore
        }
    };

    // extract language label e.g. "language-python" → "python"
    const lang = className?.replace('language-', '') ?? '';

    return (
        <div className="md-code-block-wrapper">
            <div className="md-code-block-header">
                {lang && <span className="md-code-lang">{lang}</span>}
                <button
                    type="button"
                    className={copied ? 'md-code-copy-btn md-code-copy-btn--copied' : 'md-code-copy-btn'}
                    onClick={handleCopy}
                    aria-label="Copy code"
                >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
            </div>
            <pre className="md-code-block">
                <code className={className}>{children}</code>
            </pre>
        </div>
    );
}
// ──────────────────────────────────────────────────────────────────────────────

const markdownComponents: Components = {
    code({ className, children, ...props }) {
        const isInline = !('data-language' in props) && !className?.includes('language-');
        if (!isInline) {
            return <CodeBlock className={className}>{children}</CodeBlock>;
        }
        return <code className="md-code-inline">{children}</code>;
    },
    h1: ({ children }: { children?: React.ReactNode }) => <h1 className="md-h1">{children}</h1>,
    h2: ({ children }: { children?: React.ReactNode }) => <h2 className="md-h2">{children}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3 className="md-h3">{children}</h3>,
    h4: ({ children }: { children?: React.ReactNode }) => <h4 className="md-h4">{children}</h4>,
    h5: ({ children }: { children?: React.ReactNode }) => <h5 className="md-h5">{children}</h5>,
    h6: ({ children }: { children?: React.ReactNode }) => <h6 className="md-h6">{children}</h6>,
    p: ({ children }: { children?: React.ReactNode }) => <p className="md-p">{children}</p>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="md-ul">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="md-ol">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="md-li">{children}</li>,
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="md-strong">{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em className="md-em">{children}</em>,
    del: ({ children }: { children?: React.ReactNode }) => <del className="md-del">{children}</del>,
    blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="md-blockquote">{children}</blockquote>,
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
        <a className="md-link" href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    ),
};


function hasMathLikeContent(text: string): boolean {
    return /\$[^$]+\$|\\\(|\\\)|\\\[|\\\]|\\frac|\\sqrt|[∑∫√∞≈≠≤≥±πθλμ]/.test(text);
}
const AI_EMPTY_STATE_PROMPTS = [
    'درمورد چه چیزی سوال دارید؟',
    'هر چیزی می‌خواهید بپرسید.',
    'به چه چیزی فکر می‌کنید؟',
    'چه ایده‌ای در سر دارید؟',
    'دوست دارید از کجا شروع کنیم؟',
    'الان دنبال چه پاسخی هستید؟',
    'می‌خواهید روی چه موضوعی کار کنیم؟',
    'چه چیزی امروز ذهنتان را مشغول کرده؟',
];

function pickRandomEmptyPrompt(): string {
    return AI_EMPTY_STATE_PROMPTS[Math.floor(Math.random() * AI_EMPTY_STATE_PROMPTS.length)];
}

export function AIChatRoom({
    messages,
    currentUserId,
    onSendMessage,
    selectedModel,
    onSelectModel,
    proRemainingToday,
    flashRemainingToday,
    onStopGenerating,
    onBack,
    loading = false,
    isTyping = false,
    isResponding = false,
    isReasoningPending = false,
    chats,
    onSelectChat,
    onSetPendingForwardDraft,
    aiChats,
    activeAIChatId,
    activeAIChatTitle,
    onCreateAIChat,
    onCreateTemporaryAIChat,
    onSelectAIChat,
    onDeleteAIChat,
    onRenameAIChat,
    respondingAIChatId = null,
    temporaryMode = false,
    currentUserVerified = false,
}: AIChatRoomProps) {
    const MAX_AI_MESSAGE_LENGTH = 3000;
    const [text, setText] = useState('');
    const [msgMenu, setMsgMenu] = useState<{ id: string; top: number; left: number } | null>(null);
    const [newMsgCount, setNewMsgCount] = useState(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [hideScrollBtnUntilBottom, setHideScrollBtnUntilBottom] = useState(false);
    const [forwardModalOpen, setForwardModalOpen] = useState(false);
    const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const prevActiveAIChatIdRef = useRef<string | null>(activeAIChatId);
    const [aiChatsDrawerOpen, setAIChatsDrawerOpen] = useState(false);
    const [pendingDeleteChat, setPendingDeleteChat] = useState<AIChatSummary | null>(null);
    const [emptyStatePrompt, setEmptyStatePrompt] = useState<string>(() => pickRandomEmptyPrompt());
    const [reasoningPanelByMessage, setReasoningPanelByMessage] = useState<Record<string, boolean>>({});
    const [reasoningElapsedByMessage, setReasoningElapsedByMessage] = useState<Record<string, number>>({});
    const reasoningStartAtRef = useRef<Record<string, number>>({});
    const reasoningStopAtRef = useRef<Record<string, number>>({});
    const autoClosedReasoningRef = useRef<Record<string, boolean>>({});
    const [aiChatActionMenu, setAIChatActionMenu] = useState<null | { chatId: string; top: number; left: number }>(null);
    const [pendingRenameChat, setPendingRenameChat] = useState<AIChatSummary | null>(null);
    const [renameTitleInput, setRenameTitleInput] = useState('');
    const [renameBusy, setRenameBusy] = useState(false);
    const [pinnedAIChatIds, setPinnedAIChatIds] = useState<string[]>([]);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const aiDrawerScrollTopRef = useRef(0);
    const modelDropdownRef = useRef<HTMLDivElement | null>(null);

    const msgMenuRef = useRef<HTMLDivElement | null>(null);
    const aiChatActionMenuRef = useRef<HTMLDivElement | null>(null);
    const aiChatActionBtnRef = useRef<HTMLElement | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const aiDrawerListRef = useRef<HTMLDivElement | null>(null);
    const roomRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const sendSoundRef = useRef<HTMLAudioElement | null>(null);
    const receiveSoundRef = useRef<HTMLAudioElement | null>(null);
    const isAtBottomRef = useRef(true);
    const prevLenRef = useRef(0);
    const initialScrollDoneRef = useRef(false);
    const prevLastMessageRef = useRef<Message | null>(null);
    const responseVibrationIntervalRef = useRef<number | null>(null);
    const streamingReasoningMessage = [...messages].reverse().find((m) => m.senderId !== currentUserId && m.isStreaming && m.reasoningEnabled);
    const PINNED_AI_CHATS_STORAGE_KEY = `pinnedAIChats:${currentUserId}`;

    const resizeTextarea = () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 200)}px`;
    };

    useEffect(() => { resizeTextarea(); }, [text]);

    useEffect(() => {
        sendSoundRef.current = new Audio('/sounds/send.mp3');
        receiveSoundRef.current = new Audio('/sounds/receive.mp3');
        return () => {
            sendSoundRef.current = null;
            receiveSoundRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
            return;
        }

        if (isResponding && isReasoningPending) {
            navigator.vibrate([10, 180, 16]);
            responseVibrationIntervalRef.current = window.setInterval(() => {
                navigator.vibrate([10, 180, 16]);
            }, 1800);
        } else {
            if (responseVibrationIntervalRef.current) {
                clearInterval(responseVibrationIntervalRef.current);
                responseVibrationIntervalRef.current = null;
            }
        }

        return () => {
            if (responseVibrationIntervalRef.current) {
                clearInterval(responseVibrationIntervalRef.current);
                responseVibrationIntervalRef.current = null;
            }
        };
    }, [isResponding, isReasoningPending]);

    useEffect(() => {
        setReasoningEnabled(false);
    }, []);

    useEffect(() => {
        const prevId = prevActiveAIChatIdRef.current;
        const nextId = activeAIChatId;
        const changed = prevId !== nextId;
        const isAutoCreateTransition = prevId === null && nextId !== null && messages.length > 0;

        if (changed && !isAutoCreateTransition && reasoningEnabled) {
            setReasoningEnabled(false);
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([9, 32, 14]);
            }
        }

        prevActiveAIChatIdRef.current = nextId;
    }, [activeAIChatId, messages.length, reasoningEnabled]);

    useEffect(() => {
        setEmptyStatePrompt(pickRandomEmptyPrompt());
    }, [activeAIChatId]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(PINNED_AI_CHATS_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (Array.isArray(parsed?.ids)) {
                setPinnedAIChatIds(parsed.ids.slice(0, 10));
            } else {
                setPinnedAIChatIds([]);
            }
        } catch {
            setPinnedAIChatIds([]);
        }
    }, [PINNED_AI_CHATS_STORAGE_KEY]);

    useEffect(() => () => {
        if (!reasoningEnabled) return;
        if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
        navigator.vibrate([9, 32, 14]);
    }, [reasoningEnabled]);

    useEffect(() => {
        prevLenRef.current = messages.length;
        prevLastMessageRef.current = messages[messages.length - 1] ?? null;
        initialScrollDoneRef.current = false;
        setNewMsgCount(0);
        setShowScrollBtn(false);
        setHideScrollBtnUntilBottom(false);
        requestAnimationFrame(() => scrollToBottom(false));
    }, [activeAIChatId]);

    const playChatSound = (kind: 'send' | 'receive') => {
        const audio = kind === 'send' ? sendSoundRef.current : receiveSoundRef.current;
        if (!audio) return;
        audio.currentTime = 0;
        audio.play().catch(() => {
            // Ignore blocked autoplay errors.
        });
    };

    const scrollToBottom = (smooth = false) => {
        const container = messagesContainerRef.current;
        if (container) {
            const top = Math.max(0, container.scrollHeight - container.clientHeight);
            container.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
            return;
        }
        const el = messagesEndRef.current;
        if (!el) return;
        el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    };

    const computeNearBottom = () => {
        const container = messagesContainerRef.current;
        if (!container) return true;
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return distanceFromBottom < 120;
    };

    // Keyboard offset handling
    useEffect(() => {
        const room = roomRef.current;
        if (!room) return;

        const vv = (window as unknown as { visualViewport?: VisualViewport }).visualViewport;
        if (!vv) {
            room.style.setProperty('--keyboard-offset', '0px');
            return;
        }

        let raf: number | null = null;

        const update = () => {
            const el = roomRef.current;
            if (!el) return;

            const offsetTop = typeof vv.offsetTop === 'number' ? vv.offsetTop : 0;
            const keyboard = Math.max(0, window.innerHeight - vv.height - offsetTop);
            el.style.setProperty('--keyboard-offset', `${Math.round(keyboard)}px`);

            if (isAtBottomRef.current) {
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => scrollToBottom(false));
            }
        };

        update();
        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        window.addEventListener('orientationchange', update);

        return () => {
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
            window.removeEventListener('orientationchange', update);
            if (raf) cancelAnimationFrame(raf);
            room.style.removeProperty('--keyboard-offset');
        };
    }, []);

    // Close menu when clicking outside
    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (msgMenuRef.current && msgMenuRef.current.contains(e.target as Node)) return;
            setMsgMenu(null);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    // Initial scroll to bottom
    useEffect(() => {
        const raf = requestAnimationFrame(() => scrollToBottom(false));
        return () => cancelAnimationFrame(raf);
    }, []);

    // Handle new messages
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) {
            prevLenRef.current = messages.length;
            return;
        }

        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;

        if (!initialScrollDoneRef.current) {
            if (messages.length > 0) {
                const raf = requestAnimationFrame(() => scrollToBottom(false));
                initialScrollDoneRef.current = true;
                prevLenRef.current = messages.length;
                return () => cancelAnimationFrame(raf);
            }
            prevLenRef.current = messages.length;
            return;
        }

        const added = messages.length - prevLenRef.current;
        if (added > 0) {
            const prevLast = prevLastMessageRef.current;
            const newLast = messages[messages.length - 1];
            if (newLast && (!prevLast || prevLast.id !== newLast.id) && newLast.senderId !== currentUserId) {
                playChatSound('receive');
            }

            if (nearBottom) {
                const raf = requestAnimationFrame(() => scrollToBottom(true));
                prevLenRef.current = messages.length;
                prevLastMessageRef.current = messages[messages.length - 1] ?? null;
                return () => cancelAnimationFrame(raf);
            }
            setNewMsgCount((c) => c + added);
        }

        prevLenRef.current = messages.length;
        prevLastMessageRef.current = messages[messages.length - 1] ?? null;
    }, [messages, currentUserId]);

    // Handle typing indicator
    useEffect(() => {
        if (isTyping && isAtBottomRef.current) {
            requestAnimationFrame(() => scrollToBottom(true));
        }
    }, [isTyping]);

    useEffect(() => {
        const streamMessageId = streamingReasoningMessage?.id;
        if (!streamMessageId) return;
        const timerCookieKey = `ai_reasoning_start_${streamMessageId}`;

        if (reasoningPanelByMessage[streamMessageId] === undefined) {
            setReasoningPanelByMessage((prev) => ({ ...prev, [streamMessageId]: true }));
        }

        if (!reasoningStartAtRef.current[streamMessageId]) {
            const saved = Number(getCookie(timerCookieKey) || 0);
            reasoningStartAtRef.current[streamMessageId] = saved > 0 ? saved : Number(streamingReasoningMessage?.timestamp || Date.now());
            setCookie(timerCookieKey, String(reasoningStartAtRef.current[streamMessageId]));
        }

        const hasMainResponseStarted = Boolean((streamingReasoningMessage.text || '').trim());
        if (hasMainResponseStarted && !autoClosedReasoningRef.current[streamMessageId]) {
            autoClosedReasoningRef.current[streamMessageId] = true;
            setReasoningPanelByMessage((prev) => ({ ...prev, [streamMessageId]: false }));
        }
        if ((hasMainResponseStarted || !streamingReasoningMessage?.isStreaming) && !reasoningStopAtRef.current[streamMessageId]) {
            reasoningStopAtRef.current[streamMessageId] = Date.now();
        }

        const interval = window.setInterval(() => {
            const startedAt = reasoningStartAtRef.current[streamMessageId];
            if (!startedAt) return;
            const stoppedAt = reasoningStopAtRef.current[streamMessageId] || Date.now();
            const elapsed = Math.max(0, Math.floor((stoppedAt - startedAt) / 1000));
            setReasoningElapsedByMessage((prev) => ({ ...prev, [streamMessageId]: elapsed }));
        }, 1000);
        if (!streamingReasoningMessage?.isStreaming) {
            deleteCookie(timerCookieKey);
        }
        return () => clearInterval(interval);
    }, [streamingReasoningMessage?.id, streamingReasoningMessage?.text, reasoningPanelByMessage]);

    useEffect(() => {
        if (isResponding || isTyping) {
            setMsgMenu(null);
        }
    }, [isResponding, isTyping]);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (aiChatActionMenuRef.current?.contains(target)) return;
            if (aiChatActionBtnRef.current?.contains(target)) return;
            setAIChatActionMenu(null);
        };
        if (aiChatActionMenu) {
            document.addEventListener('mousedown', onDocClick);
        }
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [aiChatActionMenu]);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (modelDropdownRef.current?.contains(target)) return;
            setModelDropdownOpen(false);
        };
        if (modelDropdownOpen) {
            document.addEventListener('mousedown', onDocClick);
        }
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [modelDropdownOpen]);

    useEffect(() => {
        if (!aiChatsDrawerOpen) return;
        const raf = window.requestAnimationFrame(() => {
            const list = aiDrawerListRef.current;
            if (!list) return;
            list.scrollTop = aiDrawerScrollTopRef.current;
        });
        return () => window.cancelAnimationFrame(raf);
    }, [aiChatsDrawerOpen]);

    const persistPinnedAIChats = (ids: string[]) => {
        localStorage.setItem(PINNED_AI_CHATS_STORAGE_KEY, JSON.stringify({ ids }));
    };

    const togglePinAIChat = (chatId: string) => {
        const pinned = pinnedAIChatIds.includes(chatId);
        if (!pinned && pinnedAIChatIds.length >= 10) {
            notify({ message: 'حداکثر ۱۰ گفتگوی AI را می‌توانید سنجاق کنید.', type: 'info' });
            return;
        }
        const next = pinned
            ? pinnedAIChatIds.filter((id) => id !== chatId)
            : [chatId, ...pinnedAIChatIds];
        setPinnedAIChatIds(next);
        persistPinnedAIChats(next);
        setAIChatActionMenu(null);
    };

    const openAIChatActionMenu = (chatId: string, btnEl: HTMLElement) => {
        const r = btnEl.getBoundingClientRect();
        const menuWidth = 180;
        const menuHeight = 140;
        const padding = 8;
        const top = Math.max(padding, Math.min(r.bottom + 6, window.innerHeight - menuHeight - padding));
        const left = Math.max(padding, Math.min(r.right - menuWidth, window.innerWidth - menuWidth - padding));
        setAIChatActionMenu((prev) => (prev?.chatId === chatId ? null : { chatId, top, left }));
    };

    const sortedAIChats = [...aiChats].sort((a, b) => {
        if (respondingAIChatId) {
            if (a.id === respondingAIChatId && b.id !== respondingAIChatId) return -1;
            if (b.id === respondingAIChatId && a.id !== respondingAIChatId) return 1;
        }
        const aPinned = pinnedAIChatIds.includes(a.id) ? 1 : 0;
        const bPinned = pinnedAIChatIds.includes(b.id) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    });

    useEffect(() => {
        const nextElapsed: Record<string, number> = {};
        for (const msg of messages) {
            if (!msg.reasoningEnabled || !msg.reasoningContent) continue;
            const fromServer = Number(msg.reasoningDurationSec || 0);
            const local = reasoningElapsedByMessage[msg.id] || 0;
            nextElapsed[msg.id] = Math.max(fromServer, local);
        }
        if (Object.keys(nextElapsed).length > 0) {
            setReasoningElapsedByMessage((prev) => ({ ...prev, ...nextElapsed }));
        }
    }, [messages]);

    const onMessagesScroll = () => {
        const container = messagesContainerRef.current;
        if (!container) return;
        if (msgMenu) setMsgMenu(null);
        if (aiChatActionMenu) setAIChatActionMenu(null);

        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;
        if (nearBottom) {
            setNewMsgCount(0);
            setShowScrollBtn(false);
            setHideScrollBtnUntilBottom(false);
        } else {
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            if (hideScrollBtnUntilBottom) {
                setShowScrollBtn(false);
            } else {
                setShowScrollBtn(distanceFromBottom > 300);
            }
        }
    };

    const isMobileKeyboardInput = () => {
        if (typeof window === 'undefined') return false;
        const coarse = window.matchMedia?.('(pointer: coarse)').matches;
        const ua = navigator.userAgent || '';
        return Boolean(coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(ua));
    };

    const submit = async () => {
        const t = text.trim();
        if (t.length > MAX_AI_MESSAGE_LENGTH) {
            alert(`حداکثر طول پیام ${MAX_AI_MESSAGE_LENGTH} کاراکتر است`);
            return;
        }
        if (!t || isResponding) return;

        const sent = await onSendMessage(t, reasoningEnabled, selectedModel);
        if (!sent) return;
        playChatSound('send');
        setText('');
        requestAnimationFrame(() => scrollToBottom(true));
    };

    const toggleReasoning = () => {
        setReasoningEnabled((prev) => {
            const next = !prev;
            if (next && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([8, 24, 14]);
            }
            return next;
        });
    };
    const isProDisabled = proRemainingToday <= 0;
    const isFlashDisabled = flashRemainingToday <= 0;
    const selectedModelLabel = selectedModel === 'nova-pro' ? 'Nova Pro' : 'Nova Flash';

    const handleSelectModel = (modelKey: AIModelKey) => {
        if (modelKey === 'nova-pro' && isProDisabled) {
            notify({ message: 'سهمیه روزانه Nova Pro شما تمام شده است. این مدل بعد از ۰۰:۰۰ دوباره فعال می‌شود.', type: 'info' });
            return;
        }
        if (modelKey === 'nova-flash' && isFlashDisabled) {
            notify({ message: 'سهمیه روزانه Nova Flash شما تمام شده است. این مدل بعد از ۰۰:۰۰ دوباره فعال می‌شود.', type: 'info' });
            return;
        }
        onSelectModel(modelKey);
        setModelDropdownOpen(false);
    };

    const openMessageMenu = (messageId: string, targetEl: HTMLElement, clientX?: number, clientY?: number) => {
        if (isResponding || isTyping) return;
        const room = roomRef.current;
        if (!room) return;
        if (msgMenu?.id === messageId) {
            setMsgMenu(null);
            return;
        }

        const roomRect = room.getBoundingClientRect();
        const r = targetEl.getBoundingClientRect();
        const clickX = typeof clientX === 'number' ? clientX : r.left + 12;
        const clickY = typeof clientY === 'number' ? clientY : r.bottom;
        let top = clickY - roomRect.top + 8;
        let left = clickX - roomRect.left - 12;

        const menuHeight = 80;
        const menuWidth = 180;

        const maxTop = roomRect.height - menuHeight - 16;
        top = Math.max(56, Math.min(top, maxTop));

        const maxLeft = roomRect.width - menuWidth - 16;
        left = Math.max(12, Math.min(left, maxLeft));

        setMsgMenu({ id: messageId, top, left });
    };

    const doCopyMessage = async (m: Message) => {
        const value = m.text ?? '';
        try {
            if (navigator.clipboard && (window as unknown as { isSecureContext?: boolean }).isSecureContext) {
                await navigator.clipboard.writeText(value);
            } else {
                const ta = document.createElement('textarea');
                ta.value = value;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch {
            // ignore
        }
        setMsgMenu(null);
    };

    const openForwardModal = (messageId: string) => {
        setForwardingMessageId(messageId);
        setForwardModalOpen(true);
        setMsgMenu(null);
    };

    const handleForwardFromModal = (targetChatId: string) => {
        if (!forwardingMessageId) return;
        const sourceMessage = messages.find((m) => m.id === forwardingMessageId);
        onSetPendingForwardDraft?.(targetChatId, {
            sourceChatId: `ai_chat_${currentUserId}`,
            messageId: forwardingMessageId,
            previewText: sourceMessage?.text || '',
            previewFile: sourceMessage?.file || null,
        });
        setForwardingMessageId(null);
        setForwardModalOpen(false);
        onSelectChat?.(targetChatId);
    };

    const activeMsg = msgMenu ? messages.find((m) => m.id === msgMenu.id) : null;

    const toastVariants: Variants = {
        hidden: { opacity: 0, },
        visible: { opacity: 1, transition: { duration: 0.2 } },
        exit: { opacity: 0, transition: { duration: 0.2 } },
    };

    return (
        <motion.div
            className="chat-room ai-chat-room" style={{ position: 'relative' }} ref={roomRef}
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            <div className="chat-room__header">
                <button
                    className="chat-room__back-btn"
                    onClick={onBack}
                    aria-label="Back"
                    type="button"
                    style={{ display: 'flex' }}
                >
                    <ArrowLeft size={20} />
                </button>

                <div className="chat-room__header-clickable chat-room__header-clickable--full ai-chat-room__header-main">
                    <div className="ai-chat-room__header-brand" ref={modelDropdownRef}>
                        <button
                            type="button"
                            className="ai-model-switcher"
                            onClick={() => setModelDropdownOpen((prev) => !prev)}
                            aria-label="انتخاب مدل هوش مصنوعی"
                        >
                            <span>{selectedModelLabel}</span>
                            <ChevronDown size={14} className={modelDropdownOpen ? 'ai-model-switcher__chevron ai-model-switcher__chevron--open' : 'ai-model-switcher__chevron'} />
                        </button>
                        <AnimatePresence>
                            {modelDropdownOpen && (
                                <motion.div
                                    className="ai-model-switcher__menu"
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -6 }}
                                    transition={{ duration: 0.16 }}
                                >
                                    <button type="button" className={`${selectedModel === 'nova-flash' ? 'ai-model-option ai-model-option--active' : 'ai-model-option'}${isFlashDisabled ? ' ai-model-option--disabled' : ''}`} onClick={() => handleSelectModel('nova-flash')}>
                                        <div className="ai-model-option__title">Nova Flash</div>
                                        <div className="ai-model-option__desc">سریع و سبک برای گفتگوهای روزانه، سوال‌های کوتاه و پاسخ‌ فوری</div>
                                    </button>
                                    <button
                                        type="button"
                                        className={`${selectedModel === 'nova-pro' ? 'ai-model-option ai-model-option--active' : 'ai-model-option'}${isProDisabled ? ' ai-model-option--disabled' : ''}`}
                                        onClick={() => handleSelectModel('nova-pro')}
                                    >
                                        <div className="ai-model-option__title">Nova Pro</div>
                                        <div className="ai-model-option__desc">دقیق‌تر برای تحلیل عمیق، کارهای حرفه‌ای و درخواست‌های پیچیده‌تر</div>
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <div className="ai-chat-room__header-title">
                        {temporaryMode ? 'گفتگوی موقت' : (activeAIChatTitle || 'گفتگوی جدید')}
                    </div>
                </div>
                <button
                    type="button"
                    className="chat-room__back-btn"
                    onClick={() => setAIChatsDrawerOpen(true)}
                    aria-label="AI chats menu"
                    style={{ display: 'flex' }}
                >
                    <PanelRight size={18} />
                </button>
            </div>

            <div
                className="chat-room__messages"
                ref={messagesContainerRef}
                onScroll={onMessagesScroll}
            >
                <div className="chat-room__messages-inner">
                    {loading ? (
                        <ChatMessagesSkeleton />
                    ) : messages.length === 0 && !isResponding && !isTyping ? (
                        <div className="ai-chat-empty-state">
                            {temporaryMode ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                    <MessageSquareDashed size={34} />
                                    <div style={{ fontSize: 24, fontWeight: 800 }}>گفتگوی موقت</div>
                                    <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>پیام‌های گفتگوی موقت ذخیره نمی‌شوند و با خروج از این صفحه حذف می‌شوند.</div>
                                </div>
                            ) : emptyStatePrompt}
                        </div>
                    ) : (
                        messages.map((message) => {
                            const isMine = message.senderId === currentUserId;
                            const isReasoningMessage = !isMine && Boolean(message.reasoningEnabled);
                            const elapsed = reasoningElapsedByMessage[message.id] ?? Number(message.reasoningDurationSec || 0);
                            const elapsedLabel = `${toPersianDigits(Math.floor(elapsed / 60))}:${toPersianDigits(String(elapsed % 60).padStart(2, '0'))}`;

                            return (
                                <div
                                    key={message.id}
                                    className={isMine ? 'message-row message-row--mine' : 'message-row message-row--theirs'}
                                >
                                    {isReasoningMessage ? (
                                        <div
                                            className="message-bubble message-bubble--theirs msg-shape--single ai-reasoning-wrap"
                                            onClick={(e) => {
                                                const ne = e.nativeEvent as MouseEvent;
                                                openMessageMenu(message.id, e.currentTarget, ne.clientX, ne.clientY);
                                            }}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') openMessageMenu(message.id, e.currentTarget as HTMLElement);
                                            }}
                                            style={{ cursor: isResponding || isTyping ? 'default' : 'pointer' }}
                                        >
                                            <div className="ai-reasoning-message-stack">
                                                <button
                                                    type="button"
                                                    className="ai-reasoning-header"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        const isOpen = reasoningPanelByMessage[message.id] ?? (message.isStreaming ? true : false);
                                                        setReasoningPanelByMessage((prev) => ({ ...prev, [message.id]: !isOpen }));
                                                    }}
                                                >
                                                    <span className="ai-reasoning-header-main">
                                                        <span className={message.isStreaming && !(message.text || '').trim() ? 'thinking-indicator__text' : 'ai-reasoning-static-title'}>
                                                            {(message.isStreaming && !(message.text || '').trim()) ? 'در حال استدلال' : 'روند استدلال'}
                                                        </span>
                                                        <span className='ai-reasoning-timer'>
                                                            {elapsedLabel}
                                                        </span>
                                                    </span>
                                                    <ChevronDown size={15} className={reasoningPanelByMessage[message.id] ? 'ai-reasoning-chevron ai-reasoning-chevron--open' : 'ai-reasoning-chevron'} />
                                                </button>
                                                <AnimatePresence initial={false}>
                                                    {Boolean(reasoningPanelByMessage[message.id]) && (
                                                        <motion.div
                                                            className="ai-reasoning-body"
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: 'auto', opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            transition={{ duration: 0.2, ease: 'easeOut' }}
                                                        >
                                                            <div className="ai-reasoning-content">
                                                                {message.reasoningContent || '...'}
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                                <div className="ai-reasoning-answer">
                                                    <div className={hasMathLikeContent(cachedTextByMessageId[m.id] ?? m.text) ? 'message-text message-text--markdown message-text--math' : 'message-text message-text--markdown'}>
                                                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                                                            {message.text ?? ''}
                                                        </ReactMarkdown>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="message-meta message-meta--theirs">
                                                {message.aiModelName && <span className="message-ai-model-label">{message.aiModelName}</span>}
                                                <span className="message-time">{formatMessageTime(message.timestamp)}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div
                                            className={
                                                isMine
                                                    ? 'message-bubble message-bubble--mine msg-shape--single'
                                                    : 'message-bubble message-bubble--theirs msg-shape--single'
                                            }
                                            onClick={(e) => {
                                                const ne = e.nativeEvent as MouseEvent;
                                                openMessageMenu(message.id, e.currentTarget, ne.clientX, ne.clientY);
                                            }}
                                            role="button"
                                            tabIndex={0}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') openMessageMenu(message.id, e.currentTarget as HTMLElement);
                                            }}
                                            style={{ cursor: isResponding || isTyping ? 'default' : 'pointer' }}
                                        >
                                            {isMine ? (
                                                <div className="message-text">{message.text}</div>
                                            ) : (
                                                <div className={hasMathLikeContent(cachedTextByMessageId[m.id] ?? m.text) ? 'message-text message-text--markdown message-text--math' : 'message-text message-text--markdown'}>
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm, remarkBreaks]}
                                                        components={markdownComponents}
                                                    >
                                                        {message.text ?? ''}
                                                    </ReactMarkdown>
                                                </div>
                                            )}
                                            <div className={isMine ? 'message-meta message-meta--mine' : 'message-meta message-meta--theirs'}>
                                                {message.aiModelName && <span className="message-ai-model-label">{message.aiModelName}</span>}
                                                <span className="message-time">{formatMessageTime(message.timestamp)}</span>
                                                {isMine && (
                                                    <span className="message-seen message-seen--double" aria-label="sent">
                                                        <Check size={12} strokeWidth={2.5} className="message-seen__check message-seen__check--first" />
                                                        <Check size={12} strokeWidth={2.5} className="message-seen__check message-seen__check--second" />
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}

                    {isTyping && !messages.some((m) => m.senderId !== currentUserId && m.isStreaming) && (
                        <div className="message-row message-row--theirs">
                            <div className="message-bubble message-bubble--theirs msg-shape--single">
                                {isReasoningPending ? (<div className="thinking-indicator"><span className="thinking-indicator__text">در حال استدلال</span></div>) : (
                                    <div className="typing-indicator">
                                        <span></span>
                                        <span></span>
                                        <span></span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            <AnimatePresence>
                {aiChatsDrawerOpen && (
                    <motion.div
                        className="ai-chat-drawer__overlay"
                        onClick={() => setAIChatsDrawerOpen(false)}
                        role="presentation"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                    >
                        <motion.aside
                            className="ai-chat-drawer"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ x: 280 }}
                            animate={{ x: 0 }}
                            exit={{ x: 280 }}
                            transition={{ type: 'spring', stiffness: 440, damping: 36, mass: 0.8 }}
                        >
                            <button
                                type="button"
                                className="ai-chat-drawer__icon-btn"
                                onClick={() => setAIChatsDrawerOpen(false)}
                                aria-label="بستن منوی گفتگوها"
                            >
                                <PanelRight size={18} />
                            </button>

                            <div className="ai-chat-drawer__new-chat-row">
                                <button
                                    type="button"
                                    className="ai-chat-drawer__new-chat"
                                    onClick={() => {
                                        onCreateTemporaryAIChat?.();
                                        setAIChatActionMenu(null);
                                        setAIChatsDrawerOpen(false);
                                    }}
                                >
                                    <span>گفتگوی موقت</span>
                                    <MessageSquareDashed size={16} />
                                </button>
                                <button
                                    type="button"
                                    className="ai-chat-drawer__new-chat"
                                    onClick={() => {
                                        onCreateAIChat();
                                        setAIChatActionMenu(null);
                                        setAIChatsDrawerOpen(false);
                                    }}
                                >
                                    <span>گفتگوی جدید</span>
                                    <PencilLine size={16} />
                                </button>
                            </div>

                            <div className="ai-chat-drawer__section-header">
                                <div className="ai-chat-drawer__section-title">تاریخچه</div>
                                <History size={15} />
                            </div>
                            <div
                                className="ai-chat-drawer__list"
                                ref={aiDrawerListRef}
                                onScroll={(e) => {
                                    aiDrawerScrollTopRef.current = e.currentTarget.scrollTop;
                                    if (aiChatActionMenu) setAIChatActionMenu(null);
                                }}
                            >
                                {sortedAIChats.map((chat) => (
                                    <div key={chat.id} className="ai-chat-drawer__item">
                                        <button
                                            type="button"
                                            className={chat.id === activeAIChatId ? 'ai-chat-drawer__item-title ai-chat-drawer__item-title--active' : 'ai-chat-drawer__item-title'}
                                            onClick={() => {
                                                onSelectAIChat(chat.id);
                                                setAIChatsDrawerOpen(false);
                                            }}
                                        >
                                            {respondingAIChatId === chat.id && <span className="ai-chat-drawer__loader" />}
                                            {pinnedAIChatIds.includes(chat.id) && <Pin size={13} className="ai-chat-drawer__pin" style={{ fill: 'currentColor' }} />}
                                            {chat.title || 'گفتگوی جدید'}
                                        </button>
                                        <button
                                            type="button"
                                            className="ai-chat-drawer__delete"
                                            onClick={(e) => {
                                                aiChatActionBtnRef.current = e.currentTarget;
                                                openAIChatActionMenu(chat.id, e.currentTarget);
                                            }}
                                            aria-label="گزینه‌های گفتگو"
                                        >
                                            <Menu size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </motion.aside>
                    </motion.div>
                )}
            </AnimatePresence>

            {aiChatActionMenu && (
                <div
                    ref={aiChatActionMenuRef}
                    className="popover popover--mini"
                    style={{ top: aiChatActionMenu.top, left: aiChatActionMenu.left, right: 'auto', position: 'fixed', zIndex: 130 }}
                >
                    <button
                        className="popover__item"
                        type="button"
                        onClick={() => togglePinAIChat(aiChatActionMenu.chatId)}
                    >
                        {pinnedAIChatIds.includes(aiChatActionMenu.chatId) ? <PinOff size={15} /> : <Pin size={15} />}
                        {pinnedAIChatIds.includes(aiChatActionMenu.chatId) ? 'برداشتن سنجاق' : 'سنجاق'}
                    </button>
                    <button
                        className="popover__item"
                        type="button"
                        onClick={() => {
                            const target = aiChats.find((c) => c.id === aiChatActionMenu.chatId) || null;
                            setPendingRenameChat(target);
                            setRenameTitleInput(target?.title || '');
                            setAIChatActionMenu(null);
                        }}
                    >
                        <PencilLine size={15} />
                        تغییر نام
                    </button>
                    <button
                        className="popover__item popover__item--danger"
                        type="button"
                        onClick={() => {
                            const target = aiChats.find((c) => c.id === aiChatActionMenu.chatId) || null;
                            setPendingDeleteChat(target);
                            setAIChatActionMenu(null);
                        }}
                    >
                        <Trash2 size={15} />
                        حذف
                    </button>
                </div>
            )}

            <AnimatePresence>
                {pendingDeleteChat && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        style={{ zIndex: 120 }}
                        onClick={() => setPendingDeleteChat(null)}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14, ease: 'easeOut' }}
                    >
                        <motion.div
                            className="chat-room-confirm-modal"
                            role="dialog"
                            aria-modal="true"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, y: 14, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h3 className="chat-room-confirm-modal__title">حذف گفتگو؟</h3>
                            <p className="chat-room-confirm-modal__text">
                                {`گفتگوی «${pendingDeleteChat.title || 'گفتگوی جدید'}» حذف شود؟`}
                            </p>
                            <div className="chat-room-confirm-modal__actions">
                                <button
                                    className="chat-room-confirm-modal__btn"
                                    type="button"
                                    onClick={() => setPendingDeleteChat(null)}
                                >
                                    انصراف
                                </button>
                                <button
                                    className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger"
                                    type="button"
                                    onClick={() => {
                                        onDeleteAIChat(pendingDeleteChat.id);
                                        setPendingDeleteChat(null);
                                    }}
                                >
                                    حذف
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            <AnimatePresence>
                {pendingRenameChat && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        style={{ zIndex: 120 }}
                        onClick={() => !renameBusy && setPendingRenameChat(null)}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14, ease: 'easeOut' }}
                    >
                        <motion.div
                            className="chat-room-confirm-modal"
                            role="dialog"
                            aria-modal="true"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, y: 14, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h3 className="chat-room-confirm-modal__title">تغییر نام گفتگو</h3>
                            <input
                                value={renameTitleInput}
                                onChange={(e) => setRenameTitleInput(e.target.value)}
                                className="chat-room-confirm-modal__input"
                                placeholder="عنوان جدید..."
                                maxLength={56}
                                disabled={renameBusy}
                            />
                            <div className="chat-room-confirm-modal__actions">
                                <button
                                    className="chat-room-confirm-modal__btn"
                                    type="button"
                                    onClick={() => setPendingRenameChat(null)}
                                    disabled={renameBusy}
                                >
                                    انصراف
                                </button>
                                <button
                                    className="chat-room-confirm-modal__btn"
                                    type="button"
                                    disabled={renameBusy || !renameTitleInput.trim()}
                                    onClick={async () => {
                                        if (!pendingRenameChat) return;
                                        setRenameBusy(true);
                                        const ok = await onRenameAIChat(pendingRenameChat.id, renameTitleInput.trim());
                                        setRenameBusy(false);
                                        if (ok) setPendingRenameChat(null);
                                    }}
                                >
                                    ذخیره
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {msgMenu && activeMsg && (
                <div
                    ref={msgMenuRef}
                    className="popover popover--mini"
                    style={{ top: msgMenu.top, left: msgMenu.left, right: 'auto', position: 'absolute', zIndex: 50 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button className="popover__item" onClick={() => doCopyMessage(activeMsg)} type="button">
                        <Copy size={16} />
                        کپی
                    </button>
                    <button className="popover__item" onClick={() => openForwardModal(activeMsg.id)} type="button">
                        <CornerUpLeft size={16} />
                        فوروارد
                    </button>
                </div>
            )}

            <ForwardModal
                isOpen={forwardModalOpen}
                chats={chats}
                currentUserId={currentUserId}
                currentUserVerified={currentUserVerified}
                onClose={() => setForwardModalOpen(false)}
                onSelectTargetChat={handleForwardFromModal}
                onSelectChat={onSelectChat}
            />

            <AnimatePresence>
                {!hideScrollBtnUntilBottom && (newMsgCount > 0 || showScrollBtn) && (
                    <motion.button
                        type="button"
                        aria-label="Jump to latest messages"
                        onClick={() => {
                            setHideScrollBtnUntilBottom(true);
                            scrollToBottom(true);
                            setNewMsgCount(0);
                            setShowScrollBtn(false);
                        }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14, ease: 'easeOut' }}
                        style={{
                            position: 'absolute',
                            right: 16,
                            bottom: 96,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: newMsgCount > 0 ? '8px 10px' : '10px',
                            borderRadius: 999,
                            border: '1px solid var(--border-secondary)',
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            boxShadow: 'var(--shadow-md)',
                            cursor: 'pointer',
                            fontSize: 12,
                            lineHeight: '12px',
                        }}
                    >
                        <ArrowDown size={16} />
                        {newMsgCount > 0 && (
                            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{newMsgCount}</span>
                                <span
                                    style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: 999,
                                        background: 'var(--accent-primary)',
                                        marginTop: 4,
                                    }}
                                />
                            </span>
                        )}
                    </motion.button>
                )}
            </AnimatePresence>

            <div className="chat-room__input-area">
                <div className="chat-room__input-wrapper">
                    <button
                        type="button"
                        onClick={toggleReasoning}
                        aria-label="Reasoning mode"
                        title="حالت استدلال"
                        style={{
                            height: 44,
                            padding: '0 10px',
                            borderRadius: 12,
                            border: `1px solid ${reasoningEnabled ? 'color-mix(in srgb, var(--accent-primary) 50%, transparent)' : 'var(--border-secondary)'}`,
                            background: reasoningEnabled ? 'color-mix(in srgb, var(--accent-primary) 18%, var(--bg-secondary))' : 'var(--bg-secondary)',
                            color: reasoningEnabled ? 'var(--accent-hover)' : 'var(--text-secondary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            justifyContent: 'center',
                            flexShrink: 0,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            fontSize: 12,
                            fontWeight: 600,
                            fontFamily: 'inherit',
                        }}
                    >
                        <Brain size={15} />
                        <span>استدلال</span>
                    </button>
                    <textarea
                        ref={textareaRef}
                        className="chat-room__text-input"
                        placeholder="پیام خود را بنویسید..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onFocus={() => {
                            setTimeout(() => {
                                if (computeNearBottom()) scrollToBottom(false);
                            }, 80);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && !isMobileKeyboardInput()) {
                                e.preventDefault();
                                submit();
                            }
                        }}
                        rows={1}
                        disabled={false}
                    />
                    <button
                        className={
                            isResponding || (text.trim() && !isResponding)
                                ? 'chat-room__send-btn chat-room__send-btn--active'
                                : 'chat-room__send-btn chat-room__send-btn--disabled'
                        }
                        onClick={isResponding ? onStopGenerating : submit}
                        disabled={isResponding ? false : !text.trim()}
                        aria-label={isResponding ? 'Stop response' : 'Send'}
                        type="button"
                    >
                        {isResponding ? (
                            <span
                                style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: 4,
                                    background: 'currentColor',
                                    display: 'inline-block',
                                }}
                            />
                        ) : (
                            <SendHorizontal size={18} />
                        )}
                    </button>
                </div>
            </div>

            <style>{`
                .ai-chat-room .chat-room__header {
                    padding: 10px 10px;
                    padding-top: 12px;
                }
                .ai-chat-room .chat-room__back-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 0;
                    margin-bottom: 4px;
                }
                .ai-chat-room .chat-room__header-clickable--full {
                    padding: 2px 5px;
                }
                .ai-chat-room__header-main {
                    justify-content: space-between;
                    gap: 6px;
                    direction: ltr;
                    align-items: center;
                    position: relative;
                    z-index: 60;
                }
                .ai-chat-room__header-main.chat-room__header-clickable:hover {
                    opacity: 1;
                }
                .ai-chat-room__header-title {
                    min-width: 0;
                    flex: 1;
                    direction: rtl;
                    text-align: right;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-secondary);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    line-height: 1.2;
                    margin-bottom: 1px;
                }
                .ai-chat-room__header-brand {
                    flex-shrink: 0;
                    font-size: 18px;
                    text-align: left;
                    margin-right: 8px;
                    line-height: 1.2;
                    position: relative;
                }
                .ai-model-switcher {
                    border: 0;
                    background: var(--bg-primary);
                    color: var(--text-primary);
                    font-weight: 700;
                    font-size: 16px;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    cursor: pointer;
                    padding: 0;
                    border-radius: 0;
                    font-family: inherit;
                }
                .ai-model-switcher__chevron {
                    transition: transform 0.2s ease;
                }
                .ai-model-switcher__chevron--open {
                    transform: rotate(180deg);
                }
                .ai-model-switcher__menu {
                    position: absolute;
                    top: calc(100% + 8px);
                    left: 0;
                    width: 260px;
                    border: 1px solid var(--border-secondary);
                    border-radius: 12px;
                    background: var(--bg-primary);
                    box-shadow: var(--shadow-md);
                    padding: 6px;
                    z-index: 61;
                    direction: rtl;
                    font-family: Vazir, sans-serif;
                    backdrop-filter: none;
                    -webkit-backdrop-filter: none;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .ai-model-option {
                    width: 100%;
                    border: 0;
                    background: transparent;
                    text-align: right;
                    border-radius: 10px;
                    padding: 8px 10px;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                    color: var(--text-primary);
                }
                .ai-model-option:hover {
                    background: var(--bg-secondary);
                }
                .ai-model-option--active {
                    background: var(--bg-tertiary);
                }
                .ai-model-option--disabled {
                    opacity: 0.45;
                    cursor: not-allowed;
                }
                .ai-model-option__title {
                    font-size: 14px;
                    font-weight: 700;
                    font-family: Vazir, sans-serif;
                }
                .ai-model-option__desc {
                    font-size: 12px;
                    color: var(--text-secondary);
                    line-height: 1.5;
                    font-family: Vazir, sans-serif;
                }
                .typing-indicator {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 0;
                }
                .typing-indicator span {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #9ca3af;
                    animation: typing-bounce 1.9s infinite ease-in-out;
                }
                .typing-indicator span:nth-child(1) { animation-delay: -0.28s; }
                .typing-indicator span:nth-child(2) { animation-delay: -0.14s; }
                .thinking-indicator {
                    display: inline-flex;
                    align-items: center;
                    min-height: 24px;
                }
                .thinking-indicator__text {
                    font-size: 15px;
                    font-weight: 700;
                    background: linear-gradient(
                        90deg,
                        rgba(156,163,175,0.25) 0%,
                        rgba(156,163,175,0.95) 50%,
                        rgba(156,163,175,0.25) 100%
                    );
                    background-size: 220% 100%;
                    -webkit-background-clip: text;
                    background-clip: text;
                    color: transparent;
                    animation: thinking-shimmer 1.8s linear infinite;
                }
                .ai-chat-drawer__item-title {
                    direction: rtl;
                    text-align: right;
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: flex-start;
                }
                .ai-chat-drawer__item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .ai-reasoning-wrap {
                    width: min(100%, 560px);
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    overflow: hidden;
                }
                .ai-reasoning-message-stack {
                    width: min(100%, 560px);
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .ai-reasoning-header {
                    all: unset;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    direction: rtl;
                    color: var(--text-secondary);
                }
                .ai-reasoning-header-main {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                }
                .ai-reasoning-timer {
                    font-variant-numeric: tabular-nums;
                    font-size: 12px;
                    opacity: 0.8;
                }
                .ai-reasoning-chevron {
                    transition: transform 0.2s ease;
                }
                .ai-reasoning-chevron--open {
                    transform: rotate(180deg);
                }
                .ai-reasoning-static-title {
                    font-size: 14px;
                    font-weight: 700;
                    color: var(--text-secondary);
                }
                .ai-reasoning-body {
                    overflow: hidden;
                }
                .ai-reasoning-content {
                    font-size: 13px;
                    line-height: 1.7;
                    color: var(--text-secondary);
                    white-space: pre-wrap;
                    border-inline-start: 2px solid var(--border-secondary);
                    padding-inline-start: 10px;
                    direction: rtl;
                    text-align: right;
                }
                .ai-reasoning-answer {
                    margin-top: 6px;
                    border-top: 1px solid var(--border-secondary);
                    padding-top: 8px;
                    direction: rtl;
                    text-align: right;
                }
                .ai-chat-room .message-text--markdown {
                    max-width: 100%;
                    overflow-x: hidden;
                    word-break: break-word;
                    overflow-wrap: anywhere;
                }
                .ai-chat-room .message-text--markdown pre,
                .ai-chat-room .message-text--markdown .md-code-block-wrapper,
                .ai-chat-room .message-text--markdown .md-code-block {
                    max-width: 100%;
                    overflow-x: auto;
                }
                .ai-chat-room .message-text--markdown pre,
                .ai-chat-room .message-text--markdown code {
                    overflow-x: auto;
                    word-break: break-word;
                    overflow-wrap: anywhere;
                }
                @keyframes thinking-shimmer {
                    0% { background-position: 220% 0; }
                    100% { background-position: -220% 0; }
                }
                @keyframes typing-bounce {
                    0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
                    40% { transform: scale(1.2); opacity: 1; }
                }
                .ai-chat-drawer__pin {
                    color: var(--accent-primary);
                    flex-shrink: 0;
                }
                .ai-chat-drawer__new-chat-row {
                    display: flex;
                    gap: 8px;
                }
                .ai-chat-drawer__new-chat-row .ai-chat-drawer__new-chat {
                    flex: 1;
                    font-size: 12px;
                }
                .chat-room-confirm-modal__input {
                    width: 100%;
                    margin-top: 6px;
                    min-height: 42px;
                    border-radius: 10px;
                    border: 1px solid var(--border-secondary);
                    background: var(--bg-secondary);
                    color: var(--text-primary);
                    font: inherit;
                    padding: 0 10px;
                    direction: rtl;
                    text-align: right;
                    outline: none;
                }
            `}</style>
        </motion.div>
    );
}
