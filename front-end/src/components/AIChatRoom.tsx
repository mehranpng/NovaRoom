import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronLeft, Copy, Check, Brain, PanelRight, PencilLine, Trash2, History, CornerUpLeft, ChevronDown, Pin, PinOff, MessageSquareDashed, X, Plus, Paperclip, Globe, Loader2 } from 'lucide-react';
import { SendIcon } from './SendIcon';
import { motion, AnimatePresence, type Variants } from "framer-motion";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Components } from 'react-markdown';
import type { Message, Chat, AIChatSummary, AIModelKey, PendingForwardDraft, AIAttachmentMeta, AIUsageStatus, AIMemoryItem, AISearchSource } from '../types';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';
import { ForwardModal } from './ForwardModal';
import { notify } from '../utils/notificationBus';
import { cx } from '../utils/cx';
import { isLtrText } from '../utils/format';
import { isElementScrolled } from '../utils/scrollFade';
import { updateSearchPillsFade } from '../utils/searchPillsFade';
import { triggerHaptic } from '../utils/haptics';
import { copyText } from '../utils/clipboard';
import { apiFetch } from '../config/api';

interface AIChatRoomProps {
    messages: Message[];
    currentUserId: string;
    onSendMessage: (text: string, useReasoner?: boolean, modelKey?: AIModelKey, useWebSearch?: boolean, attachment?: AIAttachmentMeta | null) => boolean | Promise<boolean>;
    selectedModel: AIModelKey;
    onSelectModel: (modelKey: AIModelKey) => void;
    usageStatus: AIUsageStatus;
    memories: AIMemoryItem[];
    onAddMemory: (content: string) => Promise<boolean>;
    onDeleteMemory: (memoryId: string) => void;
    onStopGenerating?: () => void;
    onDeleteMessage: (messageId: string) => void;
    onBack: () => void;
    loading?: boolean;
    isTyping?: boolean;
    isResponding?: boolean;
    isReasoningPending?: boolean;
    chats: Chat[];
    onSelectChat?: (chatId: string) => void;
    onSetPendingForwardDraft?: (targetChatId: string, draft: PendingForwardDraft) => void;
    aiChats: AIChatSummary[];
    activeAIChatId: string | null;
    onCreateAIChat: () => void;
    onCreateTemporaryAIChat?: () => void;
    onSelectAIChat: (chatId: string) => void;
    onDeleteAIChat: (chatId: string) => void;
    onRenameAIChat: (chatId: string, nextTitle: string) => Promise<boolean>;
    respondingAIChatId?: string | null;
    temporaryMode?: boolean;
    currentUserIsAdmin?: boolean;
}

const IRAN_OFFSET_MS = 210 * 60 * 1000; 
const MAX_SELECTED_MESSAGES = 30;

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
            
        }
    };

    
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

function normalizeMessageTextForRender(text: string): string {
    let t = String(text || '').replace(/\\n/g, '\n');
    
    t = t.replace(/\\\[/g, '$$$$');
    t = t.replace(/\\\]/g, '$$$$');
    
    t = t.replace(/\\\(/g, '$$');
    t = t.replace(/\\\)/g, '$$');
    return t;
}

export function AIChatRoom({
    messages,
    currentUserId,
    onSendMessage,
    selectedModel,
    onSelectModel,
    usageStatus,
    memories,
    onAddMemory,
    onDeleteMemory,
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
    onCreateAIChat,
    onCreateTemporaryAIChat,
    onSelectAIChat,
    onDeleteAIChat,
    onRenameAIChat,
    respondingAIChatId = null,
    temporaryMode = false,
    currentUserIsAdmin = false,
}: AIChatRoomProps) {
    const MAX_AI_MESSAGE_LENGTH = 3000;
    const [text, setText] = useState('');
    const [msgMenu, setMsgMenu] = useState<{ id: string; top: number; left: number } | null>(null);
    const [newMsgCount, setNewMsgCount] = useState(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [messagesScrolled, setMessagesScrolled] = useState(false);
    const [hideScrollBtnUntilBottom, setHideScrollBtnUntilBottom] = useState(false);
    const [forwardModalOpen, setForwardModalOpen] = useState(false);
    const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);
    const [forwardingMessageIds, setForwardingMessageIds] = useState<string[]>([]);
    const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
    const [selectionShake, setSelectionShake] = useState(0);
    const [copyToast, setCopyToast] = useState<string | null>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressOriginRef = useRef({ x: 0, y: 0 });
    const suppressClickRef = useRef(false);
    const [reasoningEnabled, setReasoningEnabled] = useState(false);
    const [webSearchEnabled, setWebSearchEnabled] = useState(false);
    const [composerMenuOpen, setComposerMenuOpen] = useState(false);
    const [stagedAttachment, setStagedAttachment] = useState<AIAttachmentMeta | null>(null);
    const [attachmentUploading, setAttachmentUploading] = useState(false);
    const [searchPanelsExpanded, setSearchPanelsExpanded] = useState<Record<string, boolean>>({});
    const [memoriesExpanded, setMemoriesExpanded] = useState(false);
    const [chatListCollapsed, setChatListCollapsed] = useState(false);
    const [memoryDraft, setMemoryDraft] = useState('');
    const [memorySaving, setMemorySaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const composerMenuRef = useRef<HTMLDivElement | null>(null);
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
    const aiChatActionMenuOpenedAtRef = useRef(0);
    const aiChatActionMenuClosedAtRef = useRef(0);
    const [aiChatMenuPressSuppressed, setAIChatMenuPressSuppressed] = useState(false);
    const aiChatLastTouchAtRef = useRef(0);
    const aiChatLongPressTimerRef = useRef<number | null>(null);
    const aiChatIsLongPressTriggeredRef = useRef(false);
    const [pendingRenameChat, setPendingRenameChat] = useState<AIChatSummary | null>(null);
    const [renameTitleInput, setRenameTitleInput] = useState('');
    const [renameBusy, setRenameBusy] = useState(false);
    const [pinnedAIChatIds, setPinnedAIChatIds] = useState<string[]>([]);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const aiDrawerScrollTopRef = useRef(0);
    const modelDropdownRef = useRef<HTMLDivElement | null>(null);

    const msgMenuRef = useRef<HTMLDivElement | null>(null);
    const inputAreaRef = useRef<HTMLDivElement | null>(null);
    const [composerHeight, setComposerHeight] = useState(0);
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

    useEffect(() => {
        if (!temporaryMode && messages.length === 0) {
            setEmptyStatePrompt(pickRandomEmptyPrompt());
        }
    }, [activeAIChatId, temporaryMode, messages.length]);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (composerMenuRef.current?.contains(e.target as Node)) return;
            setComposerMenuOpen(false);
        };
        if (composerMenuOpen) document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [composerMenuOpen]);

    const resizeTextarea = () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 200)}px`;
    };

    useEffect(() => { resizeTextarea(); }, [text]);

    useEffect(() => {
        sendSoundRef.current = new Audio('/sounds/send.ogg');
        receiveSoundRef.current = new Audio('/sounds/receive.ogg');
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
        setSelectedMessageIds([]);
        requestAnimationFrame(() => scrollToBottom(false));
    }, [activeAIChatId]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && selectedMessageIds.length > 0) {
                setSelectedMessageIds([]);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedMessageIds.length]);

    const playChatSound = (kind: 'send' | 'receive') => {
        const audio = kind === 'send' ? sendSoundRef.current : receiveSoundRef.current;
        if (!audio) return;
        audio.currentTime = 0;
        audio.play().catch(() => {
            
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

    
    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (msgMenuRef.current && msgMenuRef.current.contains(e.target as Node)) return;
            setMsgMenu(null);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    
    useEffect(() => {
        const raf = requestAnimationFrame(() => scrollToBottom(false));
        return () => cancelAnimationFrame(raf);
    }, []);

    
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
            if (Date.now() - aiChatActionMenuOpenedAtRef.current < 250) return;
            const target = e.target as Node;
            if (aiChatActionMenuRef.current?.contains(target)) return;
            if (aiChatActionBtnRef.current?.contains(target)) return;
            aiChatActionMenuClosedAtRef.current = Date.now();
            setAIChatActionMenu(null);
        };
        let timerId: number | null = null;
        if (aiChatActionMenu) {
            timerId = window.setTimeout(() => {
                document.addEventListener('mousedown', onDocClick);
            }, 50);
        }
        return () => {
            if (timerId) window.clearTimeout(timerId);
            document.removeEventListener('mousedown', onDocClick);
        };
    }, [aiChatActionMenu]);

    useEffect(() => {
        if (!aiChatMenuPressSuppressed) return;
        const release = () => setAIChatMenuPressSuppressed(false);
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
        window.addEventListener('touchend', release);
        window.addEventListener('mouseup', release);
        return () => {
            window.removeEventListener('pointerup', release);
            window.removeEventListener('pointercancel', release);
            window.removeEventListener('touchend', release);
            window.removeEventListener('mouseup', release);
        };
    }, [aiChatMenuPressSuppressed]);

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

    const openAIChatActionMenu = (chatId: string, el: HTMLElement, allowToggle = true) => {
        aiChatActionBtnRef.current = el;
        aiChatActionMenuOpenedAtRef.current = Date.now();
        const r = el.getBoundingClientRect();
        const menuWidth = 180;
        const menuHeight = 140;
        const padding = 8;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        const preferredTop = r.bottom + 4;
        const preferredBottomTop = r.top - menuHeight - 4;
        const top = preferredTop + menuHeight <= viewportHeight - padding
            ? preferredTop
            : Math.max(padding, preferredBottomTop);

        const preferredLeft = r.right - menuWidth;
        const left = Math.max(padding, Math.min(preferredLeft, viewportWidth - menuWidth - padding));

        setAIChatActionMenu((prev) => {
            if (prev?.chatId === chatId) {
                return allowToggle && !aiChatIsLongPressTriggeredRef.current ? null : prev;
            }
            return { chatId, top, left };
        });
    };

    const startAIChatLongPress = (chatId: string, el: HTMLElement) => {
        if (aiChatLongPressTimerRef.current) window.clearTimeout(aiChatLongPressTimerRef.current);
        aiChatIsLongPressTriggeredRef.current = false;
        aiChatLongPressTimerRef.current = window.setTimeout(() => {
            aiChatIsLongPressTriggeredRef.current = true;
            window.setTimeout(() => {
                aiChatIsLongPressTriggeredRef.current = false;
            }, 800);
            try {
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    navigator.vibrate(12);
                }
            } catch {
            }
            openAIChatActionMenu(chatId, el, false);
        }, 500);
    };

    const cancelAIChatLongPress = () => {
        if (aiChatLongPressTimerRef.current) {
            window.clearTimeout(aiChatLongPressTimerRef.current);
            aiChatLongPressTimerRef.current = null;
        }
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
        setMessagesScrolled(isElementScrolled(container));
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
        if ((!t && !stagedAttachment) || isResponding || attachmentUploading) return;

        const sent = await onSendMessage(t, reasoningEnabled, selectedModel, webSearchEnabled, stagedAttachment);
        if (!sent) return;
        playChatSound('send');
        setText('');
        clearStagedAttachment(false);
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

    const toggleWebSearch = () => {
        if (usageStatus.search.remaining <= 0 && !webSearchEnabled) {
            notify({ message: `سقف ${toPersianDigits(usageStatus.search.limit)} جستجوی روزانه شما تکمیل شده است.`, type: 'info' });
            return;
        }
        setWebSearchEnabled((prev) => {
            const next = !prev;
            if (next && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([8, 24, 14]);
            }
            return next;
        });
    };

    const clearStagedAttachment = (deleteOnServer = true) => {
        const previous = stagedAttachment;
        if (!previous) {
            setStagedAttachment(null);
            return;
        }
        if (deleteOnServer && previous.previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(previous.previewUrl);
        }
        if (deleteOnServer && previous.tempFileId) {
            void apiFetch(`/ai/files/${encodeURIComponent(previous.tempFileId)}`, { method: 'DELETE' }).catch(() => undefined);
        }
        setStagedAttachment(null);
    };

    const readFileAsDataUrl = (file: File): Promise<string> =>
        new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
        });

    const handleAttachmentPick = async (file: File | null) => {
        if (!file) return;
        setComposerMenuOpen(false);
        clearStagedAttachment(true);
        setAttachmentUploading(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const [uploaded, dataUrl] = await Promise.all([
                apiFetch('/ai/files/upload', { method: 'POST', body: form }),
                file.type.startsWith('image/') ? readFileAsDataUrl(file) : Promise.resolve(''),
            ]);
            const isImage = Boolean(uploaded?.isImage);
            setStagedAttachment({
                tempFileId: String(uploaded?.tempFileId || ''),
                fileName: String(uploaded?.fileName || file.name),
                fileSize: Number(uploaded?.fileSize || file.size),
                mimeType: String(uploaded?.mimeType || file.type || 'application/octet-stream'),
                isImage,
                previewUrl: isImage ? (dataUrl || URL.createObjectURL(file)) : undefined,
            });
        } catch (error: any) {
            notify({ message: error?.message || 'آپلود فایل انجام نشد.', type: 'error' });
        } finally {
            setAttachmentUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes >= 1024 * 1024) return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
        if (bytes >= 1024) return `${toPersianDigits(Math.round(bytes / 1024))} کیلوبایت`;
        return `${toPersianDigits(bytes)} بایت`;
    };

    const sourceDomain = (source: AISearchSource) => {
        if (source.domain) return source.domain;
        try {
            return new URL(source.url).hostname;
        } catch {
            return source.url;
        }
    };

    const toggleSearchPanel = (messageId: string) => {
        setSearchPanelsExpanded((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
    };

    const renderSearchBlock = (message: Message) => {
        if (!message.searchEnabled) return null;
        const sources = message.searchSources || [];
        const isSearching = Boolean(
            message.isStreaming &&
            (message.searchStatus === 'searching' || !(message.text || '').trim())
        );
        const expanded = searchPanelsExpanded[message.id] ?? false;
        return (
            <div className="ai-search-block">
                <button
                    type="button"
                    className="ai-search-block__header"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (sources.length > 0) toggleSearchPanel(message.id);
                    }}
                >
                    <span className="ai-search-block__header-main">
                        <Globe size={15} />
                        <span className={isSearching ? 'thinking-indicator__text' : 'ai-search-block__title'}>
                            {isSearching
                                ? 'در حال جستجو در وب...'
                                : `جستجو در وب · ${toPersianDigits(sources.length)} منبع`}
                        </span>
                    </span>
                    {sources.length > 0 && (
                        <ChevronDown size={15} className={expanded ? 'ai-reasoning-chevron ai-reasoning-chevron--open' : 'ai-reasoning-chevron'} />
                    )}
                </button>
                <AnimatePresence initial={false}>
                    {expanded && sources.length > 0 && (
                        <motion.div
                            className="ai-search-block__body"
                            initial={{ height: 0, opacity: 1 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 1 }}
                            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                        >
                            {sources.map((source) => (
                                <a
                                    key={`${source.index}-${source.url}`}
                                    className="ai-search-source-card"
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <span className="ai-search-source-card__title">{source.title || sourceDomain(source)}</span>
                                    <span className="ai-search-source-card__domain">{sourceDomain(source)}</span>
                                    {source.snippet && <span className="ai-search-source-card__snippet">{source.snippet}</span>}
                                </a>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        );
    };

    useEffect(() => {
        const onResize = () => {
            roomRef.current?.querySelectorAll<HTMLElement>('.ai-search-pills').forEach(updateSearchPillsFade);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const renderSourcePills = (message: Message) => {
        const sources = message.searchSources || [];
        if (!message.searchEnabled || message.searchStatus !== 'completed' || sources.length === 0) return null;
        return (
            <div
                className="ai-search-pills"
                ref={(el) => { if (el) updateSearchPillsFade(el); }}
                onScroll={(e) => updateSearchPillsFade(e.currentTarget)}
            >
                {sources.map((source) => (
                    <a
                        key={`${source.index}-${source.url}`}
                        className="ai-search-pill"
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={source.title}
                    >
                        <Globe size={12} />
                        <span>{sourceDomain(source)}</span>
                    </a>
                ))}
            </div>
        );
    };

    const isModelExhausted = usageStatus.tokens.exhausted;
    const selectedModelLabel = selectedModel === 'nova-pro' ? 'Nova Pro' : 'Nova Flash';

    const handleSelectModel = (modelKey: AIModelKey) => {
        if (isModelExhausted) {
            notify({ message: 'سهمیه توکن روزانه شما تمام شده است. این مدل بعد از ۰۰:۰۰ دوباره فعال می‌شود.', type: 'info' });
            return;
        }
        onSelectModel(modelKey);
        setModelDropdownOpen(false);
    };

    const isSelectionModeActive = selectedMessageIds.length > 0;

    const toggleMessageSelection = (messageId: string) => {
        if (!selectedMessageIds.includes(messageId) && selectedMessageIds.length >= MAX_SELECTED_MESSAGES) {
            triggerHaptic();
            setSelectionShake((value) => value + 1);
            return;
        }
        setSelectedMessageIds((prev) => (
            prev.includes(messageId)
                ? prev.filter((id) => id !== messageId)
                : [...prev, messageId]
        ));
    };

    const handleCopySelected = async () => {
        if (selectedMessageIds.length === 0) return;
        const selectedMsgs = messages
            .filter((m) => selectedMessageIds.includes(m.id))
            .sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp));

        const textLines = selectedMsgs
            .map((m) => (m.text ?? '').trim())
            .filter(Boolean);

        if (textLines.length > 0) {
            try {
                await copyText(textLines.join('\n\n'));
                setCopyToast('متن پیام‌ها کپی شد');
                window.setTimeout(() => setCopyToast(null), 2000);
            } catch {
                alert('کپی با خطا مواجه شد');
            }
        }
        setSelectedMessageIds([]);
    };

    const handleOpenForwardSelected = () => {
        if (selectedMessageIds.length === 0) return;
        setForwardingMessageIds([...selectedMessageIds]);
        setForwardModalOpen(true);
    };

    const cancelMessageLongPress = () => {
        if (longPressTimerRef.current === null) return;
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
    };

    const startMessageLongPress = (messageId: string, x: number, y: number) => {
        cancelMessageLongPress();
        suppressClickRef.current = false;
        if (isSelectionModeActive || isResponding || isTyping) return;
        longPressOriginRef.current = { x, y };
        longPressTimerRef.current = window.setTimeout(() => {
            longPressTimerRef.current = null;
            suppressClickRef.current = true;
            setMsgMenu(null);
            toggleMessageSelection(messageId);
            triggerHaptic();
        }, 450);
    };

    const trackMessageLongPressMove = (x: number, y: number) => {
        if (longPressTimerRef.current === null) return;
        const dx = x - longPressOriginRef.current.x;
        const dy = y - longPressOriginRef.current.y;
        if (Math.hypot(dx, dy) > 8) cancelMessageLongPress();
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

        const menuHeight = 120;
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
            
        }
        setMsgMenu(null);
    };

    const openForwardModal = (messageId: string) => {
        setForwardingMessageId(messageId);
        setForwardingMessageIds([]);
        setForwardModalOpen(true);
        setMsgMenu(null);
    };

    const handleForwardFromModal = (targetChatId: string) => {
        const idsToForward = forwardingMessageIds.length > 0
            ? [...forwardingMessageIds]
            : (forwardingMessageId ? [forwardingMessageId] : []);
        if (idsToForward.length === 0) return;

        setForwardModalOpen(false);
        setForwardingMessageId(null);
        setForwardingMessageIds([]);
        setSelectedMessageIds([]);

        const sortedMsgs = messages
            .filter((m) => idsToForward.includes(m.id))
            .sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp));
        const messageIds = sortedMsgs.map((m) => m.id);
        if (messageIds.length === 0) return;

        const firstMessage = sortedMsgs[0];
        onSetPendingForwardDraft?.(targetChatId, {
            sourceChatId: activeAIChatId || `ai_chat_${currentUserId}`,
            messageId: messageIds[0],
            messageIds: messageIds.length > 1 ? messageIds : undefined,
            sourceChatName: 'هوش مصنوعی',
            previewText: firstMessage.text || '',
            previewFile: messageIds.length === 1 ? (firstMessage.file || null) : null,
        });
        onSelectChat?.(targetChatId);
    };

    const activeMsg = msgMenu ? messages.find((m) => m.id === msgMenu.id) : null;
    const hasComposerChips = Boolean(reasoningEnabled || webSearchEnabled || stagedAttachment || attachmentUploading);
    const isInAIChat = Boolean(temporaryMode || activeAIChatId || messages.length > 0 || isResponding || isTyping);
    const isEmptyChatState = messages.length === 0 && !isResponding && !isTyping;

    useLayoutEffect(() => {
        const el = inputAreaRef.current;
        if (!el) return;
        const update = () => setComposerHeight(el.offsetHeight);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasComposerChips]);

    useEffect(() => {
        if (!isEmptyChatState && hasComposerChips && isAtBottomRef.current) {
            requestAnimationFrame(() => scrollToBottom(true));
        }
    }, [hasComposerChips]);

    const toastVariants: Variants = {
        hidden: { x: 0 },
        visible: { x: 0 },
        exit: { x: 0 },
    };

    return (
        <motion.div
            className="chat-room ai-chat-room" style={{ position: 'relative' }} ref={roomRef}
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            {isSelectionModeActive ? (
                <div className="chat-room__header chat-room__header--selection">
                    <div className="chat-room__selection-left">
                        <button
                            className="icon-btn chat-room__selection-close-btn"
                            onClick={() => setSelectedMessageIds([])}
                            aria-label="Cancel selection"
                            title="لغو انتخاب"
                            type="button"
                        >
                            <X size={20} />
                        </button>
                        <span
                            key={selectionShake}
                            className={cx('chat-room__selection-count', selectionShake > 0 && 'chat-room__selection-count--shake')}
                        >
                            {toPersianDigits(selectedMessageIds.length)} پیام انتخاب شده
                        </span>
                    </div>

                    <div className="chat-room__selection-actions">
                        <button
                            type="button"
                            className="icon-btn"
                            onClick={handleCopySelected}
                            title="کپی متن پیام‌ها"
                            aria-label="Copy selected messages"
                        >
                            <Copy size={19} />
                        </button>
                        <button
                            type="button"
                            className="icon-btn"
                            onClick={handleOpenForwardSelected}
                            title="فوروارد پیام‌های انتخاب‌شده"
                            aria-label="Forward selected messages"
                        >
                            <CornerUpLeft size={19} />
                        </button>
                    </div>
                </div>
            ) : (
            <div className="chat-room__header">
                <button
                    className={cx('chat-room__back-btn', 'back-icon-btn', messagesScrolled && 'chat-room__back-btn--scrolled')}
                    onClick={onBack}
                    aria-label="Back"
                    type="button"
                    style={{ display: 'flex' }}
                >
                    <ChevronLeft size={22} />
                </button>

                <div className="chat-room__header-clickable chat-room__header-clickable--full ai-chat-room__header-main">
                    <div className="ai-chat-room__header-brand-wrap" ref={modelDropdownRef}>
                        <div className="ai-chat-room__header-brand">
                            <button
                                type="button"
                                className="ai-model-switcher"
                                onClick={() => setModelDropdownOpen((prev) => !prev)}
                                aria-label="انتخاب مدل هوش مصنوعی"
                            >
                                <span>{selectedModelLabel}</span>
                                <ChevronDown size={14} className={modelDropdownOpen ? 'ai-model-switcher__chevron ai-model-switcher__chevron--open' : 'ai-model-switcher__chevron'} />
                            </button>
                        </div>
                        <AnimatePresence initial={false}>
                            {modelDropdownOpen && (
                                <motion.div
                                    className="ai-model-switcher__menu"
                                    initial={{ opacity: 0, y: -8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    transition={{ duration: 0.2, ease: 'easeOut' }}
                                >
                                    <button type="button" className={`${selectedModel === 'nova-flash' ? 'ai-model-option ai-model-option--active' : 'ai-model-option'}${isModelExhausted ? ' ai-model-option--disabled' : ''}`} onClick={() => handleSelectModel('nova-flash')}>
                                        <div className="ai-model-option__title" style={{ fontFamily: "'Nunito', 'Vazir', sans-serif" }}>Nova Flash</div>
                                        <div className="ai-model-option__desc" style={{ fontFamily: "'Nunito', 'Vazir', sans-serif" }}>سریع و سبک برای گفتگوهای روزانه، سوال‌های کوتاه و پاسخ‌ فوری</div>
                                    </button>
                                    <button
                                        type="button"
                                        className={`${selectedModel === 'nova-pro' ? 'ai-model-option ai-model-option--active' : 'ai-model-option'}${isModelExhausted ? ' ai-model-option--disabled' : ''}`}
                                        onClick={() => handleSelectModel('nova-pro')}
                                    >
                                        <div className="ai-model-option__title" style={{ fontFamily: "'Nunito', 'Vazir', sans-serif" }}>Nova Pro</div>
                                        <div className="ai-model-option__desc" style={{ fontFamily: "'Nunito', 'Vazir', sans-serif" }}>دقیق‌تر برای تحلیل عمیق، کارهای حرفه‌ای و درخواست‌های پیچیده‌تر</div>
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
                <div className="ai-chat-room__header-actions">
                    <button
                        type="button"
                        className="chat-room__back-btn"
                        onClick={() => {
                            if (isInAIChat) {
                                onCreateAIChat();
                            } else {
                                onCreateTemporaryAIChat?.();
                            }
                        }}
                        aria-label={isInAIChat ? 'گفتگوی جدید' : 'گفتگوی موقت'}
                        title={isInAIChat ? 'گفتگوی جدید' : 'گفتگوی موقت'}
                        style={{ display: 'flex' }}
                    >
                        {isInAIChat ? <PencilLine size={18} /> : <MessageSquareDashed size={18} />}
                    </button>
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
            </div>
            )}

            <div
                className="chat-room__messages"
                ref={messagesContainerRef}
                onScroll={onMessagesScroll}
                style={{ overflowX: 'hidden', paddingBottom: (composerHeight || 56) + 26 }}
            >
                <div className="chat-room__messages-inner">
                    {loading ? null : isEmptyChatState ? (
                        <div className="ai-chat-empty-state">
                            {temporaryMode ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                    <MessageSquareDashed size={34} />
                                    <div style={{ fontSize: 24, fontWeight: 800 }}>گفتگوی موقت</div>
                                    <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>پیام‌های گفتگوی موقت ذخیره نمی‌شوند و با خروج از این صفحه حذف می‌شوند.</div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'translateY(-20px)', width: '100%' }}>
                                    <div className="ai-chat-empty-logo" role="img" aria-label="NovaAI" />
                                    <div style={{ fontSize: window.innerWidth < 768 ? 20 : 22, fontWeight: 700, opacity: 0.95, lineHeight: 1.5 }}>{emptyStatePrompt}</div>
                                </div>
                            )}

                        </div>
                    ) : (
                        messages.map((message, index) => {
                            const isMine = message.senderId === currentUserId;
                            const isSelected = selectedMessageIds.includes(message.id);
                            const isReasoningMessage = !isMine && Boolean(message.reasoningEnabled);
                            const prevMsg = index > 0 ? messages[index - 1] : null;
                            const isAnalyzingAttachment = !isMine && Boolean(message.isStreaming) && !(message.text || '').trim() && Boolean(message.analyzingAttachment || prevMsg?.aiAttachment);
                            const elapsed = reasoningElapsedByMessage[message.id] ?? Number(message.reasoningDurationSec || 0);
                            const elapsedLabel = `${toPersianDigits(Math.floor(elapsed / 60))}:${toPersianDigits(String(elapsed % 60).padStart(2, '0'))}`;

                            return (
                                <div key={message.id} className="message-item">
                                <div
                                    className={cx(
                                        isMine ? 'message-row message-row--mine' : 'message-row message-row--theirs',
                                        isSelected && 'message-row--selected',
                                        isSelectionModeActive && 'message-row--selecting'
                                    )}
                                    onClickCapture={(e) => {
                                        if (suppressClickRef.current) {
                                            suppressClickRef.current = false;
                                            e.preventDefault();
                                            e.stopPropagation();
                                            return;
                                        }
                                        if (!isSelectionModeActive) return;
                                        const target = e.target as HTMLElement;
                                        if (!target.closest('.message-select-indicator')) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            toggleMessageSelection(message.id);
                                        }
                                    }}
                                    onClick={(e) => {
                                        if (!isSelectionModeActive) return;
                                        if (suppressClickRef.current) {
                                            suppressClickRef.current = false;
                                            return;
                                        }
                                        e.stopPropagation();
                                        toggleMessageSelection(message.id);
                                    }}
                                    onPointerDown={(e) => {
                                        if (e.pointerType === 'mouse' && e.button === 0) startMessageLongPress(message.id, e.clientX, e.clientY);
                                    }}
                                    onPointerMove={(e) => {
                                        if (e.pointerType === 'mouse') trackMessageLongPressMove(e.clientX, e.clientY);
                                    }}
                                    onPointerUp={cancelMessageLongPress}
                                    onPointerCancel={cancelMessageLongPress}
                                    onTouchStart={(e) => {
                                        const t = e.touches[0];
                                        startMessageLongPress(message.id, t.clientX, t.clientY);
                                    }}
                                    onTouchMove={(e) => {
                                        const t = e.touches[0];
                                        trackMessageLongPressMove(t.clientX, t.clientY);
                                    }}
                                    onTouchEnd={cancelMessageLongPress}
                                    onTouchCancel={cancelMessageLongPress}
                                >
                                    {isSelectionModeActive && (
                                        <div
                                            className={`message-select-indicator ${isSelected ? 'message-select-indicator--selected' : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleMessageSelection(message.id);
                                            }}
                                            role="checkbox"
                                            aria-checked={isSelected}
                                            title={isSelected ? 'لغو انتخاب' : 'انتخاب پیام'}
                                        >
                                            {isSelected && <Check size={13} strokeWidth={3} />}
                                        </div>
                                    )}
                                    {isReasoningMessage ? (
                                        <div
                                            className={`message-bubble message-bubble--theirs msg-shape--single ai-reasoning-wrap ${isSelected ? 'message-bubble--selected' : ''}`}
                                            onClick={(e) => {
                                                if (suppressClickRef.current) {
                                                    suppressClickRef.current = false;
                                                    return;
                                                }
                                                if (isSelectionModeActive) {
                                                    toggleMessageSelection(message.id);
                                                    return;
                                                }
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
                                                {renderSearchBlock(message)}
                                                {isAnalyzingAttachment && (
                                                    <div className="thinking-indicator">
                                                        <span className="thinking-indicator__text">در حال آنالیز تصویر و فایل</span>
                                                    </div>
                                                )}
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
                                                            initial={{ height: 0, opacity: 1 }}
                                                            animate={{ height: 'auto', opacity: 1 }}
                                                            exit={{ height: 0, opacity: 1 }}
                                                            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                                                        >
                                                            <div className="ai-reasoning-content">
                                                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                                                                    {normalizeMessageTextForRender(message.reasoningContent || '...')}
                                                                </ReactMarkdown>
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                                <div className="ai-reasoning-answer">
                                                    <div className={cx('message-text', 'message-text--markdown', isLtrText(message.text ?? '') && 'message-text--ltr')}>
                                                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
                                                            {normalizeMessageTextForRender(message.text ?? '')}
                                                        </ReactMarkdown>
                                                    </div>
                                                    {renderSourcePills(message)}
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
                                                    ? `message-bubble message-bubble--mine msg-shape--single ${isSelected ? 'message-bubble--selected' : ''}`
                                                    : `message-bubble message-bubble--theirs msg-shape--single ${isSelected ? 'message-bubble--selected' : ''}`
                                            }
                                            onClick={(e) => {
                                                if (suppressClickRef.current) {
                                                    suppressClickRef.current = false;
                                                    return;
                                                }
                                                if (isSelectionModeActive) {
                                                    toggleMessageSelection(message.id);
                                                    return;
                                                }
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
                                            {!isMine && renderSearchBlock(message)}
                                            {isAnalyzingAttachment && (
                                                <div className="thinking-indicator">
                                                    <span className="thinking-indicator__text">در حال آنالیز تصویر و فایل</span>
                                                </div>
                                            )}
                                            {!isMine && Boolean(message.isStreaming) && !(message.text || '').trim() && !isAnalyzingAttachment && !message.searchEnabled && (
                                                <div className="typing-indicator">
                                                    <span></span>
                                                    <span></span>
                                                    <span></span>
                                                </div>
                                            )}
                                            {isMine && message.aiAttachment && (
                                                <div className="ai-attachment-badge">
                                                    {message.aiAttachment.isImage ? (
                                                        message.aiAttachment.previewUrl ? (
                                                            <img className="ai-attachment-badge__thumb" src={message.aiAttachment.previewUrl} alt={message.aiAttachment.fileName} />
                                                        ) : (
                                                            <Paperclip size={14} />
                                                        )
                                                    ) : (
                                                        <Paperclip size={14} />
                                                    )}
                                                    <span className="ai-attachment-badge__name">{message.aiAttachment.fileName}</span>
                                                    <span className="ai-attachment-badge__size">{formatFileSize(message.aiAttachment.fileSize)}</span>
                                                </div>
                                            )}
                                            {Boolean(message.text) && (
                                                <div className={cx('message-text', 'message-text--markdown', isLtrText(message.text ?? '') && 'message-text--ltr')}>
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm, remarkBreaks]}

                                                        components={markdownComponents}
                                                    >
                                                        {normalizeMessageTextForRender(message.text ?? '')}
                                                    </ReactMarkdown>
                                                </div>
                                            )}
                                            {!isMine && renderSourcePills(message)}
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
                                </div>
                            );
                        })
                    )}

                    {isTyping && !messages.some((m) => m.senderId !== currentUserId && m.isStreaming) && (
                        <div className="message-row message-row--theirs">
                            <div className="message-bubble message-bubble--theirs msg-shape--single">
                                {Boolean(messages[messages.length - 1]?.aiAttachment) ? (
                                    <div className="thinking-indicator">
                                        <span className="thinking-indicator__text">در حال آنالیز تصویر و فایل</span>
                                    </div>
                                ) : isReasoningPending ? (
                                    <div className="thinking-indicator">
                                        <span className="thinking-indicator__text">در حال استدلال</span>
                                    </div>
                                ) : (
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

            {loading && (
                <div className="chat-room__skeleton-layer">
                    <ChatMessagesSkeleton />
                </div>
            )}

            <AnimatePresence>
                {aiChatsDrawerOpen && (
                    <motion.div
                        className="ai-chat-drawer__overlay"
                        onClick={() => setAIChatsDrawerOpen(false)}
                        role="presentation"
                    >
                        <motion.div
                            className="ai-chat-drawer__dim"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.22, ease: 'easeOut' }}
                        />
                        <motion.aside
                            className="ai-chat-drawer"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ right: -360 }}
                            animate={{ right: 10 }}
                            exit={{ right: -360 }}
                            transition={{ type: 'tween', duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
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

                            <div className="ai-chat-drawer__usage">
                                <div className="ai-chat-drawer__section-title">میزان استفاده</div>
                                <div className="ai-usage-row">
                                    <span>توکن روزانه</span>
                                    <span className="ai-usage-row__value">{toPersianDigits(usageStatus.tokens.usedPercent)}٪</span>
                                </div>
                                <div className="ai-usage-bar">
                                    <span style={{ width: `${Math.min(100, Math.max(0, usageStatus.tokens.usedPercent))}%` }} />
                                </div>
                                <div className="ai-usage-counters">
                                    <div className="ai-usage-counter">
                                        <span>فایل</span>
                                        <strong>{toPersianDigits(usageStatus.files.remaining)} / {toPersianDigits(usageStatus.files.limit)}</strong>
                                    </div>
                                    <div className="ai-usage-counter">
                                        <span>جستجو</span>
                                        <strong>{toPersianDigits(usageStatus.search.remaining)} / {toPersianDigits(usageStatus.search.limit)}</strong>
                                    </div>
                                </div>
                            </div>

                            <button
                                type="button"
                                className={memoriesExpanded ? 'ai-chat-drawer__new-chat ai-chat-drawer__memory-entry ai-chat-drawer__memory-entry--active' : 'ai-chat-drawer__new-chat ai-chat-drawer__memory-entry'}
                                onClick={() => {
                                    if (aiChatActionMenu) setAIChatActionMenu(null);
                                    setMemoriesExpanded((prev) => !prev);
                                }}
                                aria-expanded={memoriesExpanded}
                            >
                                <div className="ai-chat-drawer__memory-entry-right">
                                    <span>حافظه</span>
                                    <span className="ai-chat-drawer__memory-count">{toPersianDigits(memories.length)}/۱۰</span>
                                </div>
                                <ChevronDown size={15} className={memoriesExpanded ? 'ai-reasoning-chevron ai-reasoning-chevron--open' : 'ai-reasoning-chevron'} />
                            </button>

                            {memoriesExpanded ? (
                                <div className="ai-memory-panel">
                                    <form
                                        className="ai-memory-form"
                                        onSubmit={async (e) => {
                                            e.preventDefault();
                                            const value = memoryDraft.trim();
                                            if (!value || memorySaving || memories.length >= 10) return;
                                            setMemorySaving(true);
                                            const ok = await onAddMemory(value);
                                            setMemorySaving(false);
                                            if (ok) setMemoryDraft('');
                                        }}
                                    >
                                        <input
                                            className="ai-memory-input"
                                            value={memoryDraft}
                                            onChange={(e) => setMemoryDraft(e.target.value)}
                                            placeholder="یک نکته درباره خودت بنویس..."
                                            maxLength={200}
                                            disabled={memories.length >= 10 || memorySaving}
                                        />
                                        <button
                                            type="submit"
                                            className="ai-memory-add-btn"
                                            disabled={!memoryDraft.trim() || memories.length >= 10 || memorySaving}
                                            aria-label="افزودن حافظه"
                                        >
                                            <Plus size={16} />
                                        </button>
                                    </form>
                                    <div className="ai-memory-list">
                                        {memories.length === 0 ? (
                                            <div className="ai-memory-empty">هنوز حافظه‌ای ذخیره نشده است.</div>
                                        ) : (
                                            memories.map((memory) => (
                                                <div key={memory.id} className="ai-memory-item">
                                                    <span>{memory.content}</span>
                                                    <button
                                                        type="button"
                                                        className="ai-memory-delete"
                                                        onClick={() => onDeleteMemory(memory.id)}
                                                        aria-label="حذف حافظه"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        className="ai-chat-drawer__section-header ai-chat-drawer__section-toggle"
                                        onClick={() => {
                                            if (aiChatActionMenu) setAIChatActionMenu(null);
                                            setChatListCollapsed((prev) => !prev);
                                        }}
                                        aria-expanded={!chatListCollapsed}
                                    >
                                        <ChevronDown size={15} className={!chatListCollapsed ? 'ai-reasoning-chevron ai-reasoning-chevron--open' : 'ai-reasoning-chevron'} />
                                        <div className="ai-chat-drawer__section-header-main">
                                            <div className="ai-chat-drawer__section-title">تاریخچه</div>
                                            <History size={15} />
                                        </div>
                                    </button>
                                    <AnimatePresence initial={false}>
                                        {!chatListCollapsed && (
                                            <motion.div
                                                className="ai-chat-drawer__list"
                                                ref={aiDrawerListRef}
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                                                onScroll={(e) => {
                                                    aiDrawerScrollTopRef.current = e.currentTarget.scrollTop;
                                                    if (aiChatActionMenu) setAIChatActionMenu(null);
                                                }}
                                            >
                                                {sortedAIChats.map((chat) => (
                                                    <div key={chat.id} className="ai-chat-drawer__item">
                                                        <button
                                                            type="button"
                                                            className={cx(
                                                                'ai-chat-drawer__item-title',
                                                                chat.id === activeAIChatId && 'ai-chat-drawer__item-title--active',
                                                                aiChatActionMenu?.chatId === chat.id && 'ai-chat-drawer__item-title--menu-open',
                                                            )}
                                                            onClick={() => {
                                                                if (aiChatActionMenu?.chatId === chat.id) {
                                                                    aiChatActionMenuClosedAtRef.current = Date.now();
                                                                    setAIChatActionMenu(null);
                                                                    return;
                                                                }
                                                                if (Date.now() - aiChatActionMenuClosedAtRef.current < 400) return;
                                                                onSelectAIChat(chat.id);
                                                                setAIChatsDrawerOpen(false);
                                                            }}
                                                            onMouseDown={(e) => {
                                                                if (aiChatActionMenu) {
                                                                    setAIChatMenuPressSuppressed(true);
                                                                    return;
                                                                }
                                                                if (Date.now() - aiChatLastTouchAtRef.current < 800) return;
                                                                startAIChatLongPress(chat.id, e.currentTarget);
                                                            }}
                                                            onMouseUp={cancelAIChatLongPress}
                                                            onMouseLeave={cancelAIChatLongPress}
                                                            onTouchStart={(e) => {
                                                                if (aiChatActionMenu) {
                                                                    setAIChatMenuPressSuppressed(true);
                                                                    return;
                                                                }
                                                                aiChatLastTouchAtRef.current = Date.now();
                                                                startAIChatLongPress(chat.id, e.currentTarget);
                                                            }}
                                                            onTouchEnd={cancelAIChatLongPress}
                                                            onTouchMove={cancelAIChatLongPress}
                                                            onContextMenu={(e) => {
                                                                e.preventDefault();
                                                                cancelAIChatLongPress();
                                                                openAIChatActionMenu(chat.id, e.currentTarget, !aiChatIsLongPressTriggeredRef.current);
                                                            }}
                                                        >
                                                            {respondingAIChatId === chat.id && <span className="ai-chat-drawer__loader" />}
                                                            {pinnedAIChatIds.includes(chat.id) && <Pin size={13} className="ai-chat-drawer__pin" style={{ fill: 'currentColor' }} />}
                                                            {chat.title || 'گفتگوی جدید'}
                                                        </button>
                                                    </div>
                                                ))}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </>
                            )}
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
                    <button
                        className="popover__item"
                        onClick={() => {
                            setMsgMenu(null);
                            setSelectedMessageIds([activeMsg.id]);
                        }}
                        type="button"
                    >
                        <Check size={16} />
                        انتخاب
                    </button>
                </div>
            )}

            {copyToast && (
                <div className="chat-room__toast">
                    {copyToast}
                </div>
            )}

            <ForwardModal
                isOpen={forwardModalOpen}
                chats={chats}
                currentUserId={currentUserId}
                currentUserIsAdmin={currentUserIsAdmin}
                forwardCount={forwardingMessageIds.length || (forwardingMessageId ? 1 : 0)}
                onClose={() => {
                    setForwardModalOpen(false);
                    setForwardingMessageId(null);
                    setForwardingMessageIds([]);
                }}
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
                        className="chat-room__send-btn chat-room__send-btn--disabled"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14, ease: 'easeOut' }}
                        style={{
                            position: 'absolute',
                            right: 12,
                            bottom: (composerHeight || 56) + 18,
                            zIndex: 12,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                        }}
                    >
                        <ChevronDown size={20} />
                        {newMsgCount > 0 && (
                            <span className="chat-room__scroll-badge">{toPersianDigits(newMsgCount)}</span>
                        )}
                    </motion.button>
                )}
            </AnimatePresence>

            <div
                ref={inputAreaRef}
                className="chat-room__input-area"
            >
                {(reasoningEnabled || webSearchEnabled || stagedAttachment || attachmentUploading) && (
                    <div className="ai-composer-chips">
                        {attachmentUploading && (
                            <div className="ai-composer-chip ai-composer-chip--attachment">
                                <Loader2 size={13} className="ai-composer-chip__spinner" />
                                <span>در حال آپلود...</span>
                            </div>
                        )}
                        {stagedAttachment && (
                            <div className="ai-composer-chip ai-composer-chip--attachment">
                                {stagedAttachment.isImage && stagedAttachment.previewUrl ? (
                                    <img className="ai-composer-chip__thumb" src={stagedAttachment.previewUrl} alt={stagedAttachment.fileName} />
                                ) : (
                                    <Paperclip size={13} />
                                )}
                                <span className="ai-composer-chip__name">{stagedAttachment.fileName}</span>
                                <button type="button" className="ai-composer-chip__close" onClick={() => clearStagedAttachment(true)} aria-label="حذف فایل">
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                        {reasoningEnabled && (
                            <div className="ai-composer-chip">
                                <Brain size={13} />
                                <span>استدلال</span>
                                <button type="button" className="ai-composer-chip__close" onClick={toggleReasoning} aria-label="خاموش کردن استدلال">
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                        {webSearchEnabled && (
                            <div className="ai-composer-chip">
                                <Globe size={13} />
                                <span>جستجوی وب</span>
                                <button type="button" className="ai-composer-chip__close" onClick={toggleWebSearch} aria-label="خاموش کردن جستجوی وب">
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                )}
                <div className="chat-room__input-wrapper">
                    <div className="ai-composer-plus-wrap" ref={composerMenuRef}>
                        <button
                            type="button"
                            className={cx(
                                'ai-composer-plus-btn',
                                composerMenuOpen && 'ai-composer-plus-btn--open',
                                (reasoningEnabled || webSearchEnabled || stagedAttachment) && 'ai-composer-plus-btn--active',
                            )}
                            onClick={() => setComposerMenuOpen((prev) => !prev)}
                            aria-label="افزودن"
                            title="افزودن"
                        >
                            <Plus size={20} />
                        </button>
                        <AnimatePresence initial={false}>
                            {composerMenuOpen && (
                                <motion.div
                                    className="ai-composer-plus-menu"
                                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                                    transition={{ duration: 0.18, ease: 'easeOut' }}
                                >
                                    <button
                                        type="button"
                                        className="ai-composer-plus-menu__item"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={attachmentUploading}
                                    >
                                        <Paperclip size={15} />
                                        <span className="ai-composer-plus-menu__label">آپلود فایل یا تصویر</span>
                                        <span className="ai-composer-plus-menu__badge">
                                            {toPersianDigits(usageStatus.files.remaining)}/{toPersianDigits(usageStatus.files.limit)}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className={reasoningEnabled ? 'ai-composer-plus-menu__item ai-composer-plus-menu__item--active' : 'ai-composer-plus-menu__item'}
                                        onClick={() => {
                                            toggleReasoning();
                                            setComposerMenuOpen(false);
                                        }}
                                    >
                                        <Brain size={15} />
                                        <span className="ai-composer-plus-menu__label">حالت استدلال</span>
                                        {reasoningEnabled && <Check size={14} />}
                                    </button>
                                    <button
                                        type="button"
                                        className={webSearchEnabled ? 'ai-composer-plus-menu__item ai-composer-plus-menu__item--active' : 'ai-composer-plus-menu__item'}
                                        onClick={() => {
                                            toggleWebSearch();
                                            setComposerMenuOpen(false);
                                        }}
                                    >
                                        <Globe size={15} />
                                        <span className="ai-composer-plus-menu__label">جستجو در وب</span>
                                        <span className="ai-composer-plus-menu__badge">
                                            {toPersianDigits(usageStatus.search.remaining)}/{toPersianDigits(usageStatus.search.limit)}
                                        </span>
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                        <input
                            ref={fileInputRef}
                            type="file"
                            hidden
                            accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.md,.txt,.csv,.json,.yaml,.yml,.xml,.html,.css,.js,.ts,.tsx,.py,.sql,.sh,.log"
                            onChange={(e) => void handleAttachmentPick(e.target.files?.[0] ?? null)}
                        />
                    </div>
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
                            isResponding || ((text.trim() || stagedAttachment) && !isResponding)
                                ? 'chat-room__send-btn chat-room__send-btn--active'
                                : 'chat-room__send-btn chat-room__send-btn--disabled'
                        }
                        onClick={isResponding ? onStopGenerating : submit}
                        disabled={isResponding ? false : (!text.trim() && !stagedAttachment) || attachmentUploading}
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
                            <SendIcon size={19} />
                        )}
                    </button>
                </div>
            </div>
            <style>{`
                .ai-chat-room .chat-room__header {
                    padding: 0;
                    gap: 8px;
                }
                .ai-chat-room .chat-room__back-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 0;
                }
                .ai-chat-room .chat-room__header-clickable--full {
                    padding: 0;
                }
                .ai-chat-room__header-main {
                    justify-content: space-between;
                    gap: 8px;
                    direction: ltr;
                    align-items: center;
                    position: relative;
                    z-index: 60;
                    background: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    min-height: 46px;
                }
                .ai-chat-room__header-main.chat-room__header-clickable:hover {
                    opacity: 1;
                    background: transparent !important;
                }
                .ai-chat-empty-logo {
                    width: 96px;
                    height: 74px;
                    margin-bottom: 8px;
                    background-color: currentColor;
                    opacity: 0.95;
                    -webkit-mask: url('/logo/logo.svg') center / contain no-repeat;
                    mask: url('/logo/logo.svg') center / contain no-repeat;
                }
                .ai-chat-room__header-brand-wrap {
                    position: relative;
                    display: inline-flex;
                    flex-shrink: 0;
                    height: 46px;
                }
                .ai-chat-room__header-brand {
                    flex-shrink: 0;
                    font-size: 18px;
                    text-align: left;
                    margin-right: 0;
                    line-height: 1.2;
                    position: relative;
                    height: 46px;
                    padding: 0 6px;
                    border-radius: 9999px;
                    background: var(--glass-surface);
                    backdrop-filter: var(--glass-blur);
                    -webkit-backdrop-filter: var(--glass-blur);
                    border: 1px solid var(--glass-border);
                    box-shadow: var(--glass-shadow), var(--glass-specular);
                    display: inline-flex;
                    align-items: center;
                }
                .ai-model-switcher {
                    border: 0;
                    background: transparent;
                    color: var(--text-primary);
                    font-weight: 700;
                    font-size: 15px;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    cursor: pointer;
                    padding: 6px 10px;
                    border-radius: 9999px;
                    font-family: inherit;
                    transition: background 0.15s ease, transform 0.14s ease;
                }
                .ai-model-switcher:hover {
                    background: var(--hover-bg-light);
                }
                .ai-model-switcher:active {
                    transform: scale(0.97);
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
                    width: 268px;
                    border: 1px solid var(--glass-border);
                    border-radius: 18px;
                    background: var(--glass-surface-elevated);
                    box-shadow: var(--shadow-lg), var(--glass-specular);
                    padding: 6px;
                    z-index: 61;
                    direction: rtl;
                    font-family: 'Nunito', 'Vazir', sans-serif;
                    backdrop-filter: var(--glass-blur);
                    -webkit-backdrop-filter: var(--glass-blur);
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .ai-model-option {
                    width: 100%;
                    border: 0;
                    background: transparent;
                    text-align: right;
                    border-radius: 13px;
                    padding: 9px 11px;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                    color: var(--text-primary);
                    transition: background 0.15s ease, transform 0.14s ease;
                }
                .ai-model-option:hover {
                    background: var(--hover-bg-light);
                }
                .ai-model-option:active {
                    transform: scale(0.985);
                }
                .ai-model-option--active {
                    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
                }
                .ai-model-option--disabled {
                    opacity: 0.45;
                    cursor: not-allowed;
                }
                .ai-model-option__title {
                    font-size: 14px;
                    font-weight: 700;
                    font-family: 'Nunito', 'Vazir', sans-serif;
                }
                .ai-model-option__desc {
                    font-size: 12px;
                    color: var(--text-secondary);
                    line-height: 1.5;
                    font-family: 'Nunito', 'Vazir', sans-serif;
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
                    flex-shrink: 0;
                }
                .ai-chat-drawer__new-chat-row .ai-chat-drawer__new-chat {
                    flex: 1;
                    font-size: 12px;
                }
                .chat-room-confirm-modal__input {
                    width: 100%;
                    margin-top: 6px;
                    min-height: 44px;
                    border-radius: 14px;
                    border: 1px solid var(--glass-border);
                    background: var(--glass-surface-soft);
                    color: var(--text-primary);
                    font: inherit;
                    padding: 0 12px;
                    direction: rtl;
                    text-align: right;
                    outline: none;
                }
            `}</style>
        </motion.div>
    );
}
