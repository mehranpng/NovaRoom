import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Copy, Eye, MoreVertical, Pencil, Reply, SendHorizontal, Smile, Trash2, X, Forward, Users, Search, LogOut, Check } from 'lucide-react';
import { motion, type Variants } from "framer-motion";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { Message, MessageReply as MessageReplyType, User, Chat, FileMetadata } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { apiFetch, getMessageSeenBy } from '../config/api';
import { ContactInfo } from './ContactInfo';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';
import { ReactionPicker } from './ReactionPicker';
import { ForwardModal } from './ForwardModal';
import { FileUpload } from './FileUpload';
import { FileMessage } from './FileMessage';
import { ImageMediaViewer } from './ImageMediaViewer';
import './FileComponents.css';

interface ChatRoomProps {
    chatId: string;
    contact: User;
    messages: Message[];
    currentUserId: string;
    currentUser?: User | null;
    onSendMessage: (payload: { text: string; replyToId?: string; editMessageId?: string; file?: FileMetadata }) => void;
    onDeleteMessage: (messageId: string) => void;
    onBack: () => void;
    onCloseChat: () => void;
    onChatDeleted?: (chatId: string) => void;
    loading?: boolean;
    chats: Chat[];
    onSelectChat?: (chatId: string) => void;
    onOpenDirectChat?: (user: User) => void;
    onOpenProfile?: () => void;
    onOpenAIChat?: () => void;
    initialUnreadCount?: number;
    onConsumeInitialUnread?: (chatId: string) => void;
    onReactMessage?: (chatId: string, messageId: string, emoji: string) => Promise<void>;
    onUnreactMessage?: (chatId: string, messageId: string) => Promise<void>;
    onForwardMessage?: (sourceChatId: string, messageId: string, targetChatId: string) => Promise<void>;
    pendingForwardDraft?: { sourceChatId: string; messageId: string; previewText?: string; previewFile?: FileMetadata | null } | null;
    onSetPendingForwardDraft?: (targetChatId: string, draft: { sourceChatId: string; messageId: string; previewText?: string; previewFile?: FileMetadata | null }) => void;
    onClearPendingForwardDraft?: (targetChatId: string) => void;
}

const IRAN_OFFSET_MS = 210 * 60 * 1000;

function normalizeTs(ts: any): number {
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

function iranShiftedDate(ts: any): Date {
    return new Date(normalizeTs(ts) + IRAN_OFFSET_MS);
}

function iranYMD(ts: any): string {
    const d = iranShiftedDate(ts);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function iranDayNumber(ts: any): number {
    const d = iranShiftedDate(ts);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

function formatMessageTime(ts: any) {
    const d = iranShiftedDate(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
}

function sameDay(a: any, b: any) {
    return iranYMD(a) === iranYMD(b);
}

function formatDayLabel(ts: any) {
    const today = iranDayNumber(Date.now());
    const thatDay = iranDayNumber(ts);
    const diffDays = today - thatDay;
    if (diffDays === 0) return 'امروز';
    if (diffDays === 1) return 'دیروز';
    const d = iranShiftedDate(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function bubbleShape(prevSameSender: boolean, nextSameSender: boolean) {
    if (!prevSameSender && !nextSameSender) return 'msg-shape--single';
    if (!prevSameSender && nextSameSender) return 'msg-shape--first';
    if (prevSameSender && nextSameSender) return 'msg-shape--middle';
    if (prevSameSender && !nextSameSender) return 'msg-shape--last';
    return 'msg-shape--single';
}

/** هر مقداری غیر از false / 0 / "false" / null / undefined رو verified حساب می‌کنیم */
function resolveVerified(val: any): boolean {
    if (val === null || val === undefined) return false;
    if (val === false || val === 0 || val === 'false' || val === '0') return false;
    return true;
}

type GroupMember = {
    name: string;
    username: string;
    avatar: string;
    bio: string;
    chatId: string;
    verified?: boolean;
    online?: boolean;
};

type SeenByUser = {
    chatId: string;
    name: string;
    username?: string;
    avatar?: string;
    verified?: boolean;
};

// ── Optimistic reaction helpers ──────────────────────────────────────────────
type ReactionEntry = { emoji: string; count: number; userIds: string[] };

function applyOptimisticReact(
    reactions: ReactionEntry[] | undefined,
    userId: string,
    emoji: string,
): ReactionEntry[] {
    const base: ReactionEntry[] = (reactions || []).map((r) => ({ ...r, userIds: [...r.userIds] }));
    // remove existing reaction by this user from any emoji
    base.forEach((r) => {
        const idx = r.userIds.indexOf(userId);
        if (idx !== -1) { r.userIds.splice(idx, 1); r.count = Math.max(0, r.count - 1); }
    });
    // add new reaction
    const existing = base.find((r) => r.emoji === emoji);
    if (existing) { existing.userIds.push(userId); existing.count += 1; }
    else base.push({ emoji, count: 1, userIds: [userId] });
    // remove entries with count 0
    return base.filter((r) => r.count > 0);
}

function applyOptimisticDeleteReaction(
    reactions: ReactionEntry[] | undefined,
    userId: string,
): ReactionEntry[] {
    const base: ReactionEntry[] = (reactions || []).map((r) => ({ ...r, userIds: [...r.userIds] }));
    base.forEach((r) => {
        const idx = r.userIds.indexOf(userId);
        if (idx !== -1) { r.userIds.splice(idx, 1); r.count = Math.max(0, r.count - 1); }
    });
    return base.filter((r) => r.count > 0);
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
            // ignore
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

/** ویبره خیلی کوتاه — فقط اگر دستگاه پشتیبانی کند */
function triggerHaptic() {
    try { navigator.vibrate?.(18); } catch { /* ignore */ }
}
// ─────────────────────────────────────────────────────────────────────────────

export function ChatRoom({
    chatId,
    contact,
    messages,
    currentUserId,
    currentUser,
    onSendMessage,
    onDeleteMessage,
    onBack,
    onCloseChat,
    onChatDeleted,
    loading = false,
    chats,
    onSelectChat,
    onOpenDirectChat,
    onOpenProfile,
    onOpenAIChat,
    initialUnreadCount = 0,
    onConsumeInitialUnread,
    onReactMessage,
    onUnreactMessage,
    onForwardMessage,
    pendingForwardDraft = null,
    onSetPendingForwardDraft,
    onClearPendingForwardDraft,
}: ChatRoomProps) {
    const MAX_CHAT_MESSAGE_LENGTH = 6000;
    const currentChat = useMemo(
        () => chats.find((c) => c.id === chatId) || null,
        [chats, chatId]
    );
    const isGroupChat = currentChat?.chatType === 'group';
    const isVerifiedUser = resolveVerified(currentUser?.verified);

    const [text, setText] = useState('');
    const [uploadedFile, setUploadedFile] = useState<FileMetadata | null>(null);
    const [chatMenuOpen, setChatMenuOpen] = useState(false);
    const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
    const [confirmLeaveGroup, setConfirmLeaveGroup] = useState(false);
    const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<string | null>(null);
    const [showContactInfo, setShowContactInfo] = useState(false);
    const [forwardModalOpen, setForwardModalOpen] = useState(false);
    const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);
    const [forwardSourceUser, setForwardSourceUser] = useState<User | null>(null);
    const forwardingInFlightRef = useRef(false);

    const [replyTo, setReplyTo] = useState<MessageReplyType | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    const [msgMenu, setMsgMenu] = useState<null | { id: string; top: number; left: number }>(null);
    const [reactionMenu, setReactionMenu] = useState<null | { id: string; top: number; left: number }>(null);
    const [seenByMenu, setSeenByMenu] = useState<null | { id: string; top: number; left: number }>(null);
    const [seenByUsersByMessage, setSeenByUsersByMessage] = useState<Record<string, SeenByUser[]>>({});
    const [seenByLoadingMessageId, setSeenByLoadingMessageId] = useState<string | null>(null);

    // Optimistic reactions: messageId -> overridden reactions array
    const [optimisticReactions, setOptimisticReactions] = useState<Record<string, ReactionEntry[]>>({});

    const menuRef = useRef<HTMLDivElement | null>(null);
    const msgMenuRef = useRef<HTMLDivElement | null>(null);
    const reactionMenuRef = useRef<HTMLDivElement | null>(null);
    const seenByMenuRef = useRef<HTMLDivElement | null>(null);
    const confirmDeleteChatRef = useRef<HTMLDivElement | null>(null);
    const confirmDeleteMsgRef = useRef<HTMLDivElement | null>(null);
    const confirmLeaveGroupRef = useRef<HTMLDivElement | null>(null);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const roomRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const messageElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const [highlightId, setHighlightId] = useState<string | null>(null);
    const highlightTimeoutRef = useRef<number | null>(null);
    const highlightRafRef = useRef<number | null>(null);

    const [dragState, setDragState] = useState<{ id: string | null; x: number; active: boolean }>({
        id: null,
        x: 0,
        active: false,
    });
    const [replySwipeLocked, setReplySwipeLocked] = useState(false);

    const [newMsgCount, setNewMsgCount] = useState(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [chatStats, setChatStats] = useState<{ totalMembers: number; onlineMembers: number } | null>(null);
    const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember>>({});
    const [membersLoading, setMembersLoading] = useState(false);
    const [viewingMemberId, setViewingMemberId] = useState<string | null>(null);
    const [showMembersList, setShowMembersList] = useState(false);
    const [openGroupEditorFromMembers, setOpenGroupEditorFromMembers] = useState(false);
    const [memberSearch, setMemberSearch] = useState('');
    const isAtBottomRef = useRef(true);

    const prevLenRef = useRef(0);
    const initialScrollDoneRef = useRef(false);
    const lastChatIdRef = useRef<string | null>(null);
    const initialMediaPendingIdsRef = useRef<Set<string>>(new Set());
    const initialMediaFollowupDoneRef = useRef(false);
    const unreadConsumedInSessionRef = useRef(false);
    const restoringFromInfoRef = useRef(false);
    const restoreTopAfterInfoRef = useRef<number | null>(null);

    // Scroll memory: keep per-chat scroll position in memory until refresh.
    // IMPORTANT: only restore exact scrollTop if user actually scrolled in that chat (prevents "always open at top").
    const scrollMemoryRef = useRef<Record<string, { top: number; atBottom: boolean; userInteracted: boolean }>>({});
    const userHasScrolledRef = useRef(false);

    // Unread separator anchor for the current open session.
    const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);

    // Keep unread count used for UI stable, even if App "consumes" initialUnreadCount afterwards.
    const [displayUnreadCount, setDisplayUnreadCount] = useState<number>(initialUnreadCount);
    const [openedImage, setOpenedImage] = useState<{ url: string; file: FileMetadata | null } | null>(null);

    // Auto-jump bookkeeping to avoid saving an automatic scroll position as user's scroll memory.
    const autoJumpedToUnreadRef = useRef(false);
    const userScrolledAfterAutoJumpRef = useRef(false);
    const programmaticScrollEventsRef = useRef(0);
    const consumedInitialUnreadRef = useRef(false);

    const markProgrammaticScroll = () => {
        programmaticScrollEventsRef.current += 2;
    };

    const collectInitialMediaPendingIds = () => new Set(
        messages
            .filter((m) => {
                const mt = (m.file?.mimeType || '').toLowerCase();
                return Boolean(m.file && (mt.startsWith('image/') || mt.startsWith('video/')));
            })
            .map((m) => m.id)
    );

    const handleInitialMediaReady = (messageId: string) => {
        if (restoringFromInfoRef.current && restoreTopAfterInfoRef.current !== null) {
            const container = messagesContainerRef.current;
            if (container) {
                markProgrammaticScroll();
                container.scrollTop = restoreTopAfterInfoRef.current;
            }
        }
        if (initialMediaFollowupDoneRef.current) return;
        if (!initialMediaPendingIdsRef.current.has(messageId)) return;
        initialMediaPendingIdsRef.current.delete(messageId);
        if (initialMediaPendingIdsRef.current.size === 0) {
            initialMediaFollowupDoneRef.current = true;
            requestAnimationFrame(() => {
                if (displayUnreadCount > 0) {
                    const anchor = unreadAnchorId || computeUnreadAnchorId(displayUnreadCount);
                    if (anchor) {
                        scrollToMessageTop(anchor);
                        return;
                    }
                }
                scrollToBottom(true);
            });
        }
    };

    const consumeUnreadForOpenSession = () => {
        if (unreadConsumedInSessionRef.current) return;
        if (displayUnreadCount <= 0) return;
        unreadConsumedInSessionRef.current = true;
        setDisplayUnreadCount(0);
        setUnreadAnchorId(null);
        window.setTimeout(() => onConsumeInitialUnread?.(chatId), 0);
    };

    const scrollToBottom = (smooth = false) => {
        const container = messagesContainerRef.current;
        if (container) {
            markProgrammaticScroll();
            container.scrollTo({ top: Math.max(0, container.scrollHeight - container.clientHeight), behavior: smooth ? 'smooth' : 'auto' });
            return;
        }
        markProgrammaticScroll();
        messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    };

    const computeNearBottom = () => {
        const container = messagesContainerRef.current;
        if (!container) return true;
        return container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    };

    const saveScroll = (id: string) => {
        const container = messagesContainerRef.current;
        if (!container) return;
        scrollMemoryRef.current[id] = {
            top: container.scrollTop,
            atBottom: computeNearBottom(),
            userInteracted: Boolean(userHasScrolledRef.current),
        };
    };

    const maybeSaveScroll = (id: string) => {
        // If we auto-jumped to unread and user didn't scroll after that,
        // do NOT persist this position as the user's scroll memory.
        if (autoJumpedToUnreadRef.current && !userScrolledAfterAutoJumpRef.current) return;
        saveScroll(id);
    };

    const restoreScroll = (id: string): boolean => {
        const container = messagesContainerRef.current;
        const mem = scrollMemoryRef.current[id];
        if (!container || !mem) return false;
        isAtBottomRef.current = Boolean(mem.atBottom);
        if (mem.atBottom) {
            scrollToBottom(false);
        } else {
            markProgrammaticScroll();
            container.scrollTop = mem.top;
        }
        return true;
    };

    const scrollToMessageTop = (messageId: string, topOffset = 84) => {
        const el = messageElsRef.current.get(messageId);
        const container = messagesContainerRef.current;
        if (!el || !container) return;
        const cr = container.getBoundingClientRect();
        const tr = el.getBoundingClientRect();
        const delta = tr.top - cr.top;
        markProgrammaticScroll();
        container.scrollTop = Math.max(0, container.scrollTop + delta - topOffset);
        isAtBottomRef.current = computeNearBottom();
    };

    const computeUnreadAnchorId = (unreadCount: number): string | null => {
        // Prefer explicit per-message seen flag if present.
        const firstUnseen = messages.find((m: any) => m.senderId !== currentUserId && m.seen === false);
        if (firstUnseen?.id) return firstUnseen.id;

        const cnt = Number(unreadCount || 0);
        if (!Number.isFinite(cnt) || cnt <= 0) return null;

        let remaining = cnt;
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.senderId === currentUserId) continue;
            remaining -= 1;
            if (remaining === 0) return m.id;
        }
        return messages[0]?.id || null;
    };

    const applyInitialScroll = () => {
        const mem = scrollMemoryRef.current[chatId];

        // Only restore exact scrollTop if user actually scrolled in this chat.
        // (Otherwise a stale "top=0" can cause "always open from first message".)
        if (mem && mem.userInteracted && !mem.atBottom) {
            restoreScroll(chatId);
            return;
        }

        // If opened with unread, jump to first unread (Telegram-like).
        if (displayUnreadCount > 0) {
            const anchor = unreadAnchorId || computeUnreadAnchorId(displayUnreadCount);
            if (anchor) {
                autoJumpedToUnreadRef.current = true;
                userScrolledAfterAutoJumpRef.current = false;

                scrollToMessageTop(anchor);

                if (!consumedInitialUnreadRef.current) {
                    consumedInitialUnreadRef.current = true;
                    // Consume in App so next time you open this chat, it doesn't auto-jump again.
                    window.setTimeout(() => onConsumeInitialUnread?.(chatId), 0);
                }

                return;
            }
        }

        // If we have memory and it was at bottom, keep bottom.
        if (mem && mem.atBottom) {
            restoreScroll(chatId);
            return;
        }

        // Default: always open at bottom.
        scrollToBottom(false);
    };

    const shouldPreserveExactScroll = () => {
        const mem = scrollMemoryRef.current[chatId];
        return Boolean(mem && mem.userInteracted && !mem.atBottom);
    };

    const settleToBottomIfNeeded = () => {
        const c = messagesContainerRef.current;
        if (!c) return;
        if (userHasScrolledRef.current) return;
        if (shouldPreserveExactScroll()) return;
        // If chat has unread, initial logic will jump to unread.
        if (displayUnreadCount > 0) return;

        const hasOverflow = (c.scrollHeight - c.clientHeight) > 300;
        if (!hasOverflow) return;
        if (computeNearBottom()) return;

        // Only force if we're still at the top.
        if (c.scrollTop < 20) scrollToBottom(false);
    };

    const getReplyPreviewText = (reply: MessageReplyType | null | undefined) => {
        if (!reply) return '';
        const repliedMessage = messages.find((msg) => msg.id === reply.id);
        const repliedFile = repliedMessage?.file;
        const fileMime = (repliedFile?.mimeType || '').toLowerCase();
        const fallbackText = (reply.text || '').trim();

        if (!repliedFile) return fallbackText;

        let prefix = '📎 فایل';
        if (fileMime.startsWith('image/')) prefix = '🖼️ تصویر';
        else if (fileMime.startsWith('video/')) prefix = '🎥 ویدیو';
        else if (fileMime.startsWith('audio/')) prefix = '🎵 صوت';

        return fallbackText ? `${prefix} • ${fallbackText}` : prefix;
    };

    const getForwardPreviewText = (draft: { previewText?: string; previewFile?: FileMetadata | null } | null | undefined) => {
        if (!draft) return '';
        const fallbackText = (draft.previewText || '').trim();
        const fileMime = (draft.previewFile?.mimeType || '').toLowerCase();

        if (!draft.previewFile) return fallbackText || 'پیام';

        let prefix = '📎 فایل';
        if (fileMime.startsWith('image/')) prefix = '🖼️ تصویر';
        else if (fileMime.startsWith('video/')) prefix = '🎥 ویدیو';
        else if (fileMime.startsWith('audio/')) prefix = '🎵 صوت';

        return fallbackText ? `${prefix} • ${fallbackText}` : prefix;
    };

    const openForwardSource = (m: Message) => {
        const sourceId = m.forwardedFrom?.originalSenderId;
        if (!sourceId) return;

        if (sourceId === currentUserId) {
            onOpenProfile?.();
            return;
        }

        if (sourceId === 'ai') {
            onOpenAIChat?.();
            return;
        }

        const sourceChat = chats.find((c) => c.chatType === 'direct' && c.otherUser?.chatId === sourceId);
        const sourceUser: User = sourceChat?.otherUser || {
            chatId: sourceId,
            username: m.forwardedFrom?.username || '',
            name: m.forwardedFrom?.name || m.forwardedFrom?.username || sourceId,
            bio: '',
            avatar: '',
            online: false,
        };

        maybeSaveScroll(chatId);
        restoringFromInfoRef.current = true;
        setForwardSourceUser(sourceUser);
    };

    const openMember = (memberId: string) => {
        if (!memberId) return;
        maybeSaveScroll(chatId);
        restoringFromInfoRef.current = true;
        if (memberId === currentUserId) {
            onOpenProfile?.();
            return;
        }
        setViewingMemberId(memberId);
    };

    useEffect(() => {
        if (!isGroupChat) {
            setChatStats(null);
            return;
        }
        let cancelled = false;
        const loadStats = async () => {
            try {
                const stats = await apiFetch(`/chats/${encodeURIComponent(chatId)}/stats`);
                if (!cancelled) {
                    setChatStats({
                        totalMembers: Number(stats?.totalMembers || 0),
                        onlineMembers: Number(stats?.onlineMembers || 0),
                    });
                }
            } catch {
                if (!cancelled) setChatStats(null);
            }
        };
        loadStats();
        const timer = window.setInterval(loadStats, 15000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [chatId, isGroupChat]);

    useEffect(() => {
        if (!isGroupChat) { setGroupMembers({}); setMembersLoading(false); return; }
        let cancelled = false;
        const loadMembers = async () => {
            setMembersLoading(true);
            try {
                const members = await apiFetch(`/chats/${encodeURIComponent(chatId)}/members`);
                if (!cancelled && Array.isArray(members)) {
                    const map: Record<string, GroupMember> = {};
                    members.forEach((m: any) => {
                        const id = m.chatId || m.userId || m.username || '';
                        if (id) map[id] = {
                            name: m.name || '',
                            username: m.username || '',
                            avatar: m.avatar || '',
                            bio: m.bio || '',
                            chatId: id,
                            verified: m.verified,
                            online: Boolean(m.online),
                        };
                    });
                    setGroupMembers(map);
                }
            } catch { /* ignore */ }
            finally {
                if (!cancelled) setMembersLoading(false);
            }
        };
        loadMembers();
        // به روز کردن وضعیت آنلاین هر 15 ثانیه یکبار
        const timer = window.setInterval(loadMembers, 15000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [chatId, isGroupChat]);

    const swipeRef = useRef<{
        id: string | null; startX: number; startY: number;
        active: boolean; captured: boolean; pointerId: number | null; blockClickUntil: number;
    }>({ id: null, startX: 0, startY: 0, active: false, captured: false, pointerId: null, blockClickUntil: 0 });

    const isSavedMessages = contact.chatId === 'saved';
    const canDeleteChat = chatId !== 'pending' && !isSavedMessages;
    const token = localStorage.getItem('token') || '';

    const resizeTextarea = () => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 200)}px`;
    };

    useEffect(() => { resizeTextarea(); }, [text]);

    useEffect(() => {
        const room = roomRef.current;
        if (!room) return;
        const vv = (window as any).visualViewport as VisualViewport | undefined;
        if (!vv) { room.style.setProperty('--keyboard-offset', '0px'); return; }
        const ua = navigator.userAgent || '';
        const isIOSWebKit = /iP(ad|hone|od)/i.test(ua) || (/Macintosh/i.test(ua) && 'ontouchend' in document);
        const isChromeLikeOnIOS = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
        const shouldUseViewportKeyboardOffset = isIOSWebKit && !isChromeLikeOnIOS;
        let raf: number | null = null;
        const update = () => {
            const el = roomRef.current;
            if (!el) return;
            const offsetTop = typeof vv.offsetTop === 'number' ? vv.offsetTop : 0;
            const keyboard = shouldUseViewportKeyboardOffset
                ? Math.max(0, window.innerHeight - vv.height - offsetTop)
                : 0;
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    const resetDrag = (messageId: string) => {
        setDragState({ id: messageId, x: 0, active: false });
        setReplySwipeLocked(false);
        window.setTimeout(() => setDragState((s) => (s.id === messageId ? { id: null, x: 0, active: false } : s)), 140);
    };

    const startHighlight = (messageId: string) => {
        setHighlightId(messageId);
        if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = window.setTimeout(() => setHighlightId(null), 1000);
    };

    const scrollToMessage = (messageId: string) => {
        const el = messageElsRef.current.get(messageId);
        const container = messagesContainerRef.current;
        if (!el || !container) return;
        markProgrammaticScroll();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (highlightRafRef.current) cancelAnimationFrame(highlightRafRef.current);
        const startedAt = performance.now();
        const check = () => {
            const target = messageElsRef.current.get(messageId);
            const cont = messagesContainerRef.current;
            if (!target || !cont) return;
            const cr = cont.getBoundingClientRect();
            const tr = target.getBoundingClientRect();
            const isVisible = tr.bottom > cr.top + 24 && tr.top < cr.bottom - 24;
            const nearCenter = Math.abs((tr.top + tr.bottom) / 2 - (cr.top + cr.bottom) / 2) < 120;
            if ((isVisible && nearCenter) || performance.now() - startedAt > 3000) {
                startHighlight(messageId);
                highlightRafRef.current = null;
                return;
            }
            highlightRafRef.current = requestAnimationFrame(check);
        };
        highlightRafRef.current = requestAnimationFrame(check);
    };

    const doCopyMessage = async (m: Message) => {
        const value = m.text ?? '';
        try {
            if (navigator.clipboard && (window as any).isSecureContext) {
                await navigator.clipboard.writeText(value);
            } else {
                const ta = document.createElement('textarea');
                ta.value = value;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0';
                document.body.appendChild(ta);
                ta.focus(); ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch { /* ignore */ }
        setMsgMenu(null);
    };

    // ── FIX: Optimistic reaction update ──────────────────────────────────────
    const handleReact = async (messageId: string, emoji: string) => {
        setReactionMenu(null); setMsgMenu(null);
        // find current reactions for this message
        const msg = messages.find((m) => m.id === messageId);
        const currentReactions = optimisticReactions[messageId] ?? (msg?.reactions as ReactionEntry[] | undefined);
        // check if user already has this reaction (toggle off scenario → no haptic)
        const alreadyReacted = (currentReactions || []).some(
            (r) => r.emoji === emoji && r.userIds.includes(currentUserId)
        );
        // apply optimistic update immediately
        setOptimisticReactions((prev) => ({
            ...prev,
            [messageId]: applyOptimisticReact(currentReactions, currentUserId, emoji),
        }));
        // ویبره فقط هنگام ثبت ری‌اکشن جدید (نه toggle off)
        if (!alreadyReacted) triggerHaptic();
        try {
            if (onReactMessage) {
                await onReactMessage(chatId, messageId, emoji);
            } else {
                await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
            }
        } catch (e) {
            console.error('Failed to react:', e);
            // rollback on error
            setOptimisticReactions((prev) => {
                const next = { ...prev };
                delete next[messageId];
                return next;
            });
        }
    };

    const handleDeleteReaction = async (messageId: string) => {
        setReactionMenu(null); setMsgMenu(null);
        const msg = messages.find((m) => m.id === messageId);
        const currentReactions = optimisticReactions[messageId] ?? (msg?.reactions as ReactionEntry[] | undefined);
        // apply optimistic delete immediately
        setOptimisticReactions((prev) => ({
            ...prev,
            [messageId]: applyOptimisticDeleteReaction(currentReactions, currentUserId),
        }));
        try {
            if (onUnreactMessage) {
                await onUnreactMessage(chatId, messageId);
            } else {
                await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'DELETE' });
            }
        } catch (e) {
            console.error('Failed to delete reaction:', e);
            // rollback on error
            setOptimisticReactions((prev) => {
                const next = { ...prev };
                delete next[messageId];
                return next;
            });
        }
    };
    // ─────────────────────────────────────────────────────────────────────────

    // Keep optimistic entries only until that specific message is synced from server.
    useEffect(() => {
        setOptimisticReactions((prev) => {
            if (!Object.keys(prev).length) return prev;
            const next = { ...prev };
            let changed = false;
            Object.keys(prev).forEach((messageId) => {
                const msg = messages.find((m) => m.id === messageId);
                if (!msg) {
                    delete next[messageId];
                    changed = true;
                    return;
                }
                const serverReactions = (msg.reactions as ReactionEntry[] | undefined) ?? [];
                const optimistic = prev[messageId] ?? [];
                if (JSON.stringify(serverReactions) === JSON.stringify(optimistic)) {
                    delete next[messageId];
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [messages]);

    const handleForwardMessage = async (sourceChatId: string, messageId: string, targetChatId: string) => {
        if (forwardingInFlightRef.current) return;
        forwardingInFlightRef.current = true;
        const draftSnapshot = pendingForwardDraft;
        onClearPendingForwardDraft?.(targetChatId);
        try {
            if (onForwardMessage) {
                await onForwardMessage(sourceChatId, messageId, targetChatId);
            } else {
                await apiFetch('/messages/forward', { method: 'POST', body: JSON.stringify({ sourceChatId, messageId, targetChatId }) });
            }
        } catch (e) {
            if (draftSnapshot) onSetPendingForwardDraft?.(targetChatId, draftSnapshot);
            console.error('Failed to forward:', e);
            alert('فوروارد پیام با خطا مواجه شد');
        } finally {
            forwardingInFlightRef.current = false;
        }
    };

    const handleForwardFromModal = (targetChatId: string) => {
        if (!forwardingMessageId) return;
        const sourceMessage = messages.find((m) => m.id === forwardingMessageId);
        onSetPendingForwardDraft?.(targetChatId, {
            sourceChatId: chatId,
            messageId: forwardingMessageId,
            previewText: sourceMessage?.text || '',
            previewFile: sourceMessage?.file || null,
        });
        setForwardingMessageId(null);
        onSelectChat?.(targetChatId);
    };

    const openForwardModal = (messageId: string) => {
        setForwardingMessageId(messageId);
        setForwardModalOpen(true);
        setMsgMenu(null);
    };

    const loadSeenBy = async (messageId: string) => {
        if (!isGroupChat) return;
        if (seenByLoadingMessageId === messageId) return;
        setSeenByLoadingMessageId(messageId);
        try {
            const res = await getMessageSeenBy(chatId, messageId);
            const rows = Array.isArray((res as any)?.seenBy) ? (res as any).seenBy : [];
            setSeenByUsersByMessage((prev) => ({ ...prev, [messageId]: rows }));
        } catch (e) {
            console.error('Failed to load seen-by:', e);
            setSeenByUsersByMessage((prev) => ({ ...prev, [messageId]: [] }));
        } finally {
            setSeenByLoadingMessageId((s) => (s === messageId ? null : s));
        }
    };

    const handleFileUploaded = (file: FileMetadata) => setUploadedFile(file);

    const cleanupUploadedFile = async (file: FileMetadata | null) => {
        if (!file?.fileId) return;
        try {
            await apiFetch(`/files/${encodeURIComponent(file.fileId)}`, { method: 'DELETE' });
        } catch {
            // ignore cleanup failures
        }
    };

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (menuRef.current?.contains(target)) return;
            if (msgMenuRef.current?.contains(target)) return;
            if (reactionMenuRef.current?.contains(target)) return;
            if (seenByMenuRef.current?.contains(target)) return;
            if (confirmDeleteChatRef.current) {
                const modal = confirmDeleteChatRef.current.querySelector('.chat-room-confirm-modal');
                if (modal && !modal.contains(target)) { setConfirmDeleteChat(false); return; }
            }
            if (confirmDeleteMsgRef.current) {
                const modal = confirmDeleteMsgRef.current.querySelector('.chat-room-confirm-modal');
                if (modal && !modal.contains(target)) { setConfirmDeleteMsg(null); return; }
            }
            if (confirmLeaveGroupRef.current) {
                const modal = confirmLeaveGroupRef.current.querySelector('.chat-room-confirm-modal');
                if (modal && !modal.contains(target)) { setConfirmLeaveGroup(false); return; }
            }
            setChatMenuOpen(false);
            setMsgMenu(null);
            setReactionMenu(null);
            setSeenByMenu(null);
        };
        document.addEventListener('click', onDocClick);
        return () => document.removeEventListener('click', onDocClick);
    }, []);

    useEffect(() => {
        return () => {
            if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
            if (highlightRafRef.current) cancelAnimationFrame(highlightRafRef.current);
        };
    }, []);

    useEffect(() => {
        return () => {
            if (uploadedFile) {
                void cleanupUploadedFile(uploadedFile);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uploadedFile?.fileId]);

    // Save scroll when leaving current chatId (unmount or switching to another chat).
    useEffect(() => {
        return () => {
            maybeSaveScroll(chatId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    useEffect(() => {
        if (lastChatIdRef.current === chatId) return;
        lastChatIdRef.current = chatId;
        initialScrollDoneRef.current = false;
        prevLenRef.current = messages.length;
        setNewMsgCount(0); setShowScrollBtn(false);
        isAtBottomRef.current = true;
        setShowContactInfo(false);
        setShowMembersList(false);
        setViewingMemberId(null);
        setForwardSourceUser(null);
        setReplyTo(null); setEditingId(null);
        setMsgMenu(null); setReactionMenu(null); setSeenByMenu(null);
        if (uploadedFile) void cleanupUploadedFile(uploadedFile);
        setText(''); setUploadedFile(null);
        setUnreadAnchorId(null);
        setOptimisticReactions({});
        setSeenByLoadingMessageId(null);

        setDisplayUnreadCount(initialUnreadCount);
        autoJumpedToUnreadRef.current = false;
        userScrolledAfterAutoJumpRef.current = false;
        programmaticScrollEventsRef.current = 0;
        consumedInitialUnreadRef.current = false;
        userHasScrolledRef.current = false;
        unreadConsumedInSessionRef.current = false;
        restoringFromInfoRef.current = false;
        restoreTopAfterInfoRef.current = null;
        initialMediaFollowupDoneRef.current = false;
        initialMediaPendingIdsRef.current = collectInitialMediaPendingIds();
        if (initialMediaPendingIdsRef.current.size === 0) {
            initialMediaFollowupDoneRef.current = true;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    // If initialUnreadCount arrives late (edge cases), capture it once for UI.
    useEffect(() => {
        if (initialUnreadCount > 0 && displayUnreadCount === 0) {
            setDisplayUnreadCount(initialUnreadCount);
        }
    }, [initialUnreadCount, displayUnreadCount]);

    // When opening a chat with unread messages, compute anchor once for this open session.
    useEffect(() => {
        if (unreadAnchorId) return;
        if (!displayUnreadCount || displayUnreadCount <= 0) return;
        const id = computeUnreadAnchorId(displayUnreadCount);
        if (id) setUnreadAnchorId(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayUnreadCount, messages.length, chatId]);

    // Back→open can mount while layout is still settling (mobile show/hide); retry a few times to avoid sticking at top.
    useLayoutEffect(() => {
        if (loading) return;
        if (messages.length === 0) return;
        settleToBottomIfNeeded();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId, loading, messages.length, displayUnreadCount]);

    useEffect(() => {
        if (loading) return;
        if (messages.length === 0) return;
        const delays = [0, 80, 180, 350, 700];
        const timers = delays.map((d) => window.setTimeout(() => settleToBottomIfNeeded(), d));
        return () => { timers.forEach((t) => window.clearTimeout(t)); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId, loading, messages.length, displayUnreadCount]);

    // Restore scroll after coming back from ContactInfo / member info / members list.
    useEffect(() => {
        if (showContactInfo || viewingMemberId || showMembersList) return;
        const mem = scrollMemoryRef.current[chatId];
        if (!mem) return;
        restoringFromInfoRef.current = false;
        restoreTopAfterInfoRef.current = mem.atBottom ? null : mem.top;
        const raf = requestAnimationFrame(() => restoreScroll(chatId));

        const timers = mem.atBottom
            ? [60, 160, 320, 520, 820].map((delay) => window.setTimeout(() => {
                if (shouldPreserveExactScroll()) return;
                scrollToBottom(false);
            }, delay))
            : [60, 160, 320, 520, 820].map((delay) => window.setTimeout(() => {
                const c = messagesContainerRef.current;
                if (!c || restoreTopAfterInfoRef.current === null) return;
                markProgrammaticScroll();
                c.scrollTop = restoreTopAfterInfoRef.current;
            }, delay));

        return () => {
            cancelAnimationFrame(raf);
            timers.forEach((t) => window.clearTimeout(t));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showContactInfo, viewingMemberId, showMembersList, chatId]);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) { prevLenRef.current = messages.length; return; }
        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;

        if (!initialScrollDoneRef.current) {
            if (messages.length > 0 && !loading) {
                // فقط در سناریوی لود اولیه‌ای که قبلاً لیست پیام‌ها خالی بوده بود،
                // pendingها را دوباره همگام‌سازی کن تا اسکرول follow-up از دست نرود.
                if (initialMediaFollowupDoneRef.current && initialMediaPendingIdsRef.current.size === 0) {
                    const pendingIds = collectInitialMediaPendingIds();
                    if (pendingIds.size > 0) {
                        initialMediaPendingIdsRef.current = pendingIds;
                        initialMediaFollowupDoneRef.current = false;
                    }
                }
                const raf = requestAnimationFrame(() => {
                    applyInitialScroll();

                    // Safety net: if initial open ended up at top (common when layout not ready), force bottom once.
                    window.setTimeout(() => {
                        const c = messagesContainerRef.current;
                        if (!c) return;
                        if (userHasScrolledRef.current) return;
                        if (displayUnreadCount > 0) return;
                        const mem = scrollMemoryRef.current[chatId];
                        if (mem?.userInteracted && !mem.atBottom) return;
                        const hasOverflow = (c.scrollHeight - c.clientHeight) > 300;
                        if (hasOverflow && c.scrollTop < 20 && !computeNearBottom()) {
                            scrollToBottom(false);
                        }
                    }, 120);
                });
                initialScrollDoneRef.current = true;
                prevLenRef.current = messages.length;
                return () => cancelAnimationFrame(raf);
            }
            prevLenRef.current = messages.length;
            return;
        }

        const added = messages.length - prevLenRef.current;
        if (added > 0) {
            if (nearBottom) {
                const raf = requestAnimationFrame(() => scrollToBottom(true));
                prevLenRef.current = messages.length;
                return () => cancelAnimationFrame(raf);
            }
            setNewMsgCount((c) => c + added);
        }
        prevLenRef.current = messages.length;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length, chatId, loading, displayUnreadCount, unreadAnchorId]);

    useEffect(() => {
        if (displayUnreadCount <= 0) return;
        if (loading) return;
        if (!messages.length) return;
        // Do not auto-consume immediately on open/reflow; this can make the
        // unread separator flash and disappear (seen mostly on desktop Chrome).
        // We only consume after real user scroll interaction.
        if (!userHasScrolledRef.current) return;
        const raf = requestAnimationFrame(() => {
            if (computeNearBottom()) consumeUnreadForOpenSession();
        });
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId, displayUnreadCount, loading, messages.length]);

    const onMessagesScroll = () => {
        const container = messagesContainerRef.current;
        if (!container) return;

        // Ignore programmatic scroll events first (initial unread jump / restore / auto-scroll).
        // These events should not consume unread state.
        if (programmaticScrollEventsRef.current > 0) {
            programmaticScrollEventsRef.current -= 1;
            return;
        }

        if (msgMenu || reactionMenu || seenByMenu) {
            setMsgMenu(null);
            setReactionMenu(null);
            setSeenByMenu(null);
        }

        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;
        if (nearBottom) {
            setNewMsgCount(0); setShowScrollBtn(false);
            consumeUnreadForOpenSession();
        }
        else setShowScrollBtn(container.scrollHeight - container.scrollTop - container.clientHeight > 300);

        userHasScrolledRef.current = true;

        if (autoJumpedToUnreadRef.current) {
            userScrolledAfterAutoJumpRef.current = true;
        }

        // keep memory fresh (in-memory only)
        saveScroll(chatId);
    };

    const items = useMemo(() => messages.map((m, idx) => {
        const prev = idx > 0 ? messages[idx - 1] : null;
        const next = idx < messages.length - 1 ? messages[idx + 1] : null;
        const isMine = m.senderId === currentUserId;
        const prevSameSender = prev ? prev.senderId === m.senderId : false;
        const nextSameSender = next ? next.senderId === m.senderId : false;
        const dayBreak = !prev || !sameDay(prev.timestamp, m.timestamp);
        return { m, isMine, dayBreak, shape: bubbleShape(prevSameSender, nextSameSender) };
    }), [messages, currentUserId]);

    const submit = () => {
        const t = text.trim();
        if (t.length > MAX_CHAT_MESSAGE_LENGTH) {
            alert(`حداکثر طول پیام ${MAX_CHAT_MESSAGE_LENGTH} کاراکتر است`);
            return;
        }
        if (!t && !uploadedFile && (!pendingForwardDraft || Boolean(editingId))) return;
        triggerHaptic();
        if (t || uploadedFile) {
            onSendMessage({ text: t || '', replyToId: replyTo?.id, editMessageId: editingId ?? undefined, file: uploadedFile ?? undefined });
        }
        if (pendingForwardDraft && !editingId) {
            void handleForwardMessage(pendingForwardDraft.sourceChatId, pendingForwardDraft.messageId, chatId);
        }
        setText(''); setUploadedFile(null); setReplyTo(null); setEditingId(null);
        requestAnimationFrame(() => scrollToBottom(true));
    };

    const doDeleteChat = async () => {
        try {
            await apiFetch(`/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
            setConfirmDeleteChat(false); setChatMenuOpen(false);
            if (onChatDeleted) onChatDeleted(chatId); else onBack();
        } catch { alert('حذف گفتگو با خطا مواجه شد'); }
    };

    const doLeaveGroup = async () => {
        try {
            await apiFetch(`/groups/${encodeURIComponent(chatId)}/leave`, { method: 'POST' });
            setConfirmLeaveGroup(false); setChatMenuOpen(false);
            if (onChatDeleted) onChatDeleted(chatId); else onBack();
        } catch { alert('خروج از گروه با خطا مواجه شد'); }
    };

    const openMessageMenu = (messageId: string, targetEl: HTMLElement, clientX?: number, clientY?: number) => {
        const room = roomRef.current;
        if (!room) return;

        // Toggle: clicking the same message while menu is open closes it.
        if (msgMenu?.id === messageId || reactionMenu?.id === messageId || seenByMenu?.id === messageId) {
            setMsgMenu(null);
            setReactionMenu(null);
            setSeenByMenu(null);
            return;
        }

        const roomRect = room.getBoundingClientRect();
        const r = targetEl.getBoundingClientRect();

        const x = typeof clientX === 'number' && Number.isFinite(clientX) ? clientX : (r.left + 12);
        const y = typeof clientY === 'number' && Number.isFinite(clientY) ? clientY : r.bottom;

        // Position near the actual click/touch point (relative to room).
        const relX = x - roomRect.left;
        const relY = y - roomRect.top;

        setMsgMenu({ id: messageId, top: relY + 8, left: relX - 12 });
        setReactionMenu(null);
        setSeenByMenu(null);

        const message = messages.find((m) => m.id === messageId);
        if (isGroupChat && message?.senderId === currentUserId) {
            loadSeenBy(messageId);
        }
    };

    // Clamp msg menu inside the visible room (especially important on mobile).
    useLayoutEffect(() => {
        if (!msgMenu) return;
        const room = roomRef.current;
        const menu = msgMenuRef.current;
        if (!room || !menu) return;

        const rr = room.getBoundingClientRect();
        const mr = menu.getBoundingClientRect();

        const padding = 12;
        const minTop = 64;

        const maxLeft = rr.width - mr.width - padding;
        const maxTop = rr.height - mr.height - padding;

        const clampedLeft = Math.min(Math.max(msgMenu.left, padding), Math.max(padding, maxLeft));
        const clampedTop = Math.min(Math.max(msgMenu.top, minTop), Math.max(minTop, maxTop));

        if (clampedLeft !== msgMenu.left || clampedTop !== msgMenu.top) {
            setMsgMenu((s) => (s ? { ...s, left: clampedLeft, top: clampedTop } : s));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [msgMenu?.id, msgMenu?.top, msgMenu?.left]);

    useLayoutEffect(() => {
        if (!reactionMenu) return;
        const room = roomRef.current;
        const menu = reactionMenuRef.current;
        if (!room || !menu) return;

        const rr = room.getBoundingClientRect();
        const mr = menu.getBoundingClientRect();
        const padding = 12;
        const minTop = 64;
        const maxLeft = rr.width - mr.width - padding;
        const maxTop = rr.height - mr.height - padding;
        const clampedLeft = Math.min(Math.max(reactionMenu.left, padding), Math.max(padding, maxLeft));
        const clampedTop = Math.min(Math.max(reactionMenu.top, minTop), Math.max(minTop, maxTop));
        if (clampedLeft !== reactionMenu.left || clampedTop !== reactionMenu.top) {
            setReactionMenu((s) => (s ? { ...s, left: clampedLeft, top: clampedTop } : s));
        }
    }, [reactionMenu?.id, reactionMenu?.top, reactionMenu?.left]);

    useLayoutEffect(() => {
        if (!seenByMenu) return;
        const room = roomRef.current;
        const menu = seenByMenuRef.current;
        if (!room || !menu) return;

        const rr = room.getBoundingClientRect();
        const mr = menu.getBoundingClientRect();
        const padding = 12;
        const minTop = 64;
        const maxLeft = rr.width - mr.width - padding;
        const maxTop = rr.height - mr.height - padding;
        const clampedLeft = Math.min(Math.max(seenByMenu.left, padding), Math.max(padding, maxLeft));
        const clampedTop = Math.min(Math.max(seenByMenu.top, minTop), Math.max(minTop, maxTop));
        if (clampedLeft !== seenByMenu.left || clampedTop !== seenByMenu.top) {
            setSeenByMenu((s) => (s ? { ...s, left: clampedLeft, top: clampedTop } : s));
        }
    }, [seenByMenu?.id, seenByMenu?.top, seenByMenu?.left]);

    const openReactionMenu = (messageId: string, targetEl: HTMLElement, anchor?: { top: number; left: number }) => {
        const room = roomRef.current;
        if (!room) return;
        const roomRect = room.getBoundingClientRect();
        const r = targetEl.getBoundingClientRect();
        const pickerHeight = 200; const pickerWidth = 320;
        const anchorTop = anchor?.top ?? (r.bottom - roomRect.top);
        const anchorLeft = anchor?.left ?? (r.left - roomRect.left);
        const spaceBelow = roomRect.height - anchorTop;
        const top = spaceBelow < pickerHeight + 16 ? Math.max(64, anchorTop - pickerHeight) : anchorTop;
        const finalLeft = Math.max(12, Math.min(anchorLeft, roomRect.width - pickerWidth - 16));
        setReactionMenu({ id: messageId, top, left: finalLeft });
        setMsgMenu(null);
        setSeenByMenu(null);
    };

    const beginReply = (m: Message, withHaptic = false) => {
        setReplyTo({ id: m.id, senderId: m.senderId, text: m.text });
        setEditingId(null); setMsgMenu(null); setReactionMenu(null); setSeenByMenu(null);
        if (withHaptic) triggerHaptic();
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const beginEdit = (m: Message) => {
        setEditingId(m.id); setReplyTo(null); setText(m.text);
        setMsgMenu(null); setReactionMenu(null); setSeenByMenu(null);
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const doDeleteMessage = (messageId: string) => {
        setMsgMenu(null); setReactionMenu(null); setSeenByMenu(null);
        setConfirmDeleteMsg(messageId);
    };

    const confirmDeleteMessage = () => {
        if (confirmDeleteMsg) { onDeleteMessage(confirmDeleteMsg); setConfirmDeleteMsg(null); }
    };

    if (showContactInfo) {
        const infoUser: any = isGroupChat ? { ...contact, chatId, isGroup: true } : contact;
        return (
            <ContactInfo
                user={infoUser}
                onBack={() => {
                    setShowContactInfo(false);
                    if (openGroupEditorFromMembers) {
                        setShowMembersList(true);
                        setOpenGroupEditorFromMembers(false);
                    }
                }}
                onOpenMembers={isGroupChat ? () => {
                    setOpenGroupEditorFromMembers(false);
                    setShowContactInfo(false);
                    setMemberSearch('');
                    setShowMembersList(true);
                } : undefined}
                autoOpenMembers={!openGroupEditorFromMembers}
                startInEditMode={openGroupEditorFromMembers}
                onOpenChat={(u) => {
                    if (u.chatId === currentUserId) {
                        onOpenProfile?.();
                        setShowContactInfo(false);
                        return;
                    }
                    onOpenDirectChat?.(u);
                    setShowContactInfo(false);
                }}
            />
        );
    }

    if (forwardSourceUser) {
        return (
            <ContactInfo
                user={forwardSourceUser}
                onBack={() => setForwardSourceUser(null)}
                onOpenChat={(u) => {
                    if (u.chatId === currentUserId) {
                        onOpenProfile?.();
                        setForwardSourceUser(null);
                        return;
                    }
                    onOpenDirectChat?.(u);
                    setForwardSourceUser(null);
                }}
            />
        );
    }

    if (viewingMemberId) {
        const memberData = groupMembers[viewingMemberId];
        const memberUser: any = memberData
            ? { chatId: memberData.chatId || viewingMemberId, name: memberData.name || viewingMemberId, username: memberData.username || '', avatar: memberData.avatar || '', bio: memberData.bio || '', online: memberData.online ?? false, verified: memberData.verified || false }
            : { chatId: viewingMemberId, name: viewingMemberId, username: '', avatar: '', bio: '', online: false };
        return (
            <ContactInfo
                user={memberUser}
                onBack={() => setViewingMemberId(null)}
                onOpenChat={(u) => {
                    if (u.chatId === currentUserId) {
                        onOpenProfile?.();
                        setViewingMemberId(null);
                        return;
                    }
                    onOpenDirectChat?.(u);
                    setViewingMemberId(null);
                }}
            />
        );
    }

    if (showMembersList) {
        const membersList = Object.values(groupMembers);
        const filtered = memberSearch.trim()
            ? membersList.filter(m => m.name.toLowerCase().includes(memberSearch.toLowerCase()) || m.username.toLowerCase().includes(memberSearch.toLowerCase()))
            : membersList;
        // آنلاین‌ها اول نمایش داده شون
        const sortedFiltered = [...filtered].sort((a, b) => {
            if (a.online && !b.online) return -1;
            if (!a.online && b.online) return 1;
            return 0;
        });
        const onlineCount = membersList.filter(m => m.online).length;
        const isInviteLink = (s: string) => s.startsWith('novaroom://') || s.startsWith('senoroom://');
        const inviteLink = contact.username && isInviteLink(contact.username) ? contact.username : null;

        return (
            <div className="contact-info">
                <div className="contact-info__header">
                    <button className="contact-info__back" onClick={() => { setShowMembersList(false); }} type="button"><ArrowLeft size={20} /></button>
                    <div className="contact-info__title">اطلاعات گروه</div>
                    <div className="contact-info__spacer" />
                    {isVerifiedUser && (
                        <button
                            type="button"
                            className="icon-btn"
                            aria-label="Edit group"
                            title="ویرایش گروه"
                            onClick={() => {
                                setOpenGroupEditorFromMembers(true);
                                setShowMembersList(false);
                                setShowContactInfo(true);
                            }}
                        >
                            <Pencil size={18} />
                        </button>
                    )}
                </div>

                <div className="contact-info__content">
                    <div className="contact-info__avatar">
                        <Avatar name={contact.name} size="xl" src={contact.avatar} />
                        <div className="contact-info__name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{contact.name}</div>
                        <div className="contact-info__status chat-room__contact-status--online" style={{ color: '#22c55e' }}>
                            {membersList.length} عضو • {onlineCount} آنلاین
                        </div>
                    </div>

                    {inviteLink && (
                        <div className="contact-info__card">
                            <div className="contact-info__label">لینک دعوت</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <div className="contact-info__mono" style={{ fontSize: 13, wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Users size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
                                    {inviteLink}
                                </div>
                                <button type="button" className="icon-btn" style={{ flexShrink: 0 }} onClick={() => navigator.clipboard.writeText(inviteLink).catch(() => { })}>
                                    <Copy size={18} />
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="contact-info__card" style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Search size={15} style={{ opacity: 0.5, flexShrink: 0 }} />
                            <input type="text" placeholder="جستجو در اعضا..." value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
                                style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 14, color: 'var(--text-primary)', fontFamily: 'Vazir, sans-serif', direction: 'rtl' }} />
                        </div>
                    </div>
                    <div style={{ padding: '8px 4px 4px', fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'Vazir, sans-serif' }}>اعضا ({membersList.length})</div>
                    <div className="contact-info__card" style={{ padding: 0, overflow: 'hidden' }}>
                        {membersLoading && membersList.length === 0 ? (
                            Array.from({ length: 6 }).map((_, idx) => (
                                <div key={`members-loading-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: idx > 0 ? '1px solid var(--border-primary)' : 'none' }}>
                                    <span className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}>
                                        <div className="skeleton" style={{ height: 12, width: idx % 2 === 0 ? '52%' : '64%', borderRadius: 6, marginBottom: 8 }} />
                                        <div className="skeleton" style={{ height: 10, width: idx % 2 === 0 ? '30%' : '38%', borderRadius: 6 }} />
                                    </div>
                                </div>
                            ))
                        ) : sortedFiltered.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)', fontSize: 14 }}>عضوی یافت نشد</div>
                        ) : (
                            sortedFiltered.map((member, idx) => (
                                <div key={member.chatId}
                                    onClick={() => {
                                        setShowMembersList(false);
                                        if (member.chatId === currentUserId) onOpenProfile?.();
                                        else {
                                            restoringFromInfoRef.current = true;
                                            setViewingMemberId(member.chatId);
                                        }
                                    }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer', borderTop: idx > 0 ? '1px solid var(--border-primary)' : 'none', transition: 'background 0.15s' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                    {/* آواتار با dot آنلاین — فقط در همین لیست */}
                                    <Avatar name={member.name} size="md" src={member.avatar} online={member.online} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                                            {member.name}
                                            {resolveVerified(member.verified) && <VerifiedBadge size={14} />}
                                        </div>
                                        <div style={{ fontSize: 13, marginTop: 2 }}>
                                            {member.online ? (
                                                <span style={{ color: '#22c55e' }}>آنلاین</span>
                                            ) : (
                                                <span style={{ color: 'var(--text-secondary)' }}>
                                                    {member.username ? `@${member.username}` : 'آفلاین'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const toastVariants: Variants = {
        hidden: { opacity: 0, },
        visible: { opacity: 1, transition: { duration: 0.3 } },
        exit: { opacity: 0, transition: { duration: 0.3 } },
    };
    return (
        <motion.div
            className="chat-room" style={{ position: 'relative' }} ref={roomRef}
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            <div className="chat-room__header">
                <button className="chat-room__back-btn" onClick={() => { maybeSaveScroll(chatId); onBack(); }} aria-label="Back" type="button"><ArrowLeft size={20} /></button>
                <button className="icon-btn chat-room__close-btn" onClick={() => { maybeSaveScroll(chatId); onCloseChat(); }} aria-label="Back to empty" type="button"><ArrowLeft size={20} /></button>

                <button
                    className="chat-room__header-clickable chat-room__header-clickable--full"
                    onClick={() => {
                        if (isSavedMessages) return;
                        maybeSaveScroll(chatId);
                        restoringFromInfoRef.current = true;
                        setOpenGroupEditorFromMembers(false);
                        setShowContactInfo(true);
                    }}
                    aria-label={isSavedMessages ? '' : 'Open contact info'}
                    type="button"
                    style={isSavedMessages ? { cursor: 'default' } : undefined}
                >
                    <Avatar
                        name={contact.name}
                        size="sm"
                        online={isGroupChat || isSavedMessages ? undefined : contact.online}
                        savedMessages={isSavedMessages}
                        src={contact.avatar}
                    />
                    <div className="chat-room__header-info">
                        <div className="chat-room__contact-name" style={{ alignItems: 'center', gap: 6 }}>
                            <p className='chat-room__contact-name-2'>{contact.name}</p>
                            {!isSavedMessages && resolveVerified(contact.verified) ? <VerifiedBadge size={14} /> : null}
                        </div>
                        {!isSavedMessages && (
                            <div className={isGroupChat || contact.online ? 'chat-room__contact-status chat-room__contact-status--online' : 'chat-room__contact-status'}>
                                {isGroupChat
                                    ? `${chatStats?.totalMembers ?? currentChat?.participantIds?.length ?? 0} عضو • ${chatStats?.onlineMembers ?? 0} آنلاین`
                                    : contact.online ? 'آنلاین' : 'آفلاین'}
                            </div>
                        )}
                    </div>
                </button>

                {!isSavedMessages && (
                    <div className="chat-room__header-actions" ref={menuRef}>
                        <button
                            className="icon-btn"
                            onClick={() => setChatMenuOpen((v) => !v)}
                            aria-label="More"
                            disabled={!canDeleteChat}
                            style={!canDeleteChat ? { opacity: 0.4, cursor: 'default' } : undefined}
                            type="button"
                        >
                            <MoreVertical size={20} />
                        </button>

                        {chatMenuOpen && canDeleteChat && (
                            <div className="popover popover--mini popover--right">
                                {isGroupChat ? (
                                    <>
                                        {/* خروج از گروه — همه کاربران */}
                                        <button
                                            className="popover__item popover__item--danger"
                                            onClick={() => {
                                                // FIX: defer closing menu so onDocClick doesn't cancel the modal
                                                setConfirmLeaveGroup(true);
                                                setTimeout(() => setChatMenuOpen(false), 0);
                                            }}
                                            type="button"
                                        >
                                            <LogOut size={16} />
                                            خروج از گروه
                                        </button>
                                        {/* حذف گروه — فقط verified (هر نوع truthy value) */}
                                        {isVerifiedUser && (
                                            <button
                                                className="popover__item popover__item--danger"
                                                onClick={() => {
                                                    // FIX: defer closing menu so onDocClick doesn't cancel the modal
                                                    setConfirmDeleteChat(true);
                                                    setTimeout(() => setChatMenuOpen(false), 0);
                                                }}
                                                type="button"
                                            >
                                                <Trash2 size={16} />
                                                حذف گروه
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <button
                                        className="popover__item popover__item--danger"
                                        onClick={() => {
                                            // FIX: defer closing menu so onDocClick doesn't cancel the modal
                                            setConfirmDeleteChat(true);
                                            setTimeout(() => setChatMenuOpen(false), 0);
                                        }}
                                        type="button"
                                    >
                                        <Trash2 size={16} />
                                        حذف گفتگو
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div
                className="chat-room__messages"
                ref={messagesContainerRef}
                onScroll={onMessagesScroll}
                onPlayCapture={(e) => {
                    const targetVideo = e.target instanceof HTMLVideoElement ? e.target : null;
                    if (!targetVideo) return;
                    const container = messagesContainerRef.current;
                    if (!container) return;
                    container.querySelectorAll('video').forEach((videoEl) => {
                        if (videoEl !== targetVideo && !videoEl.paused) videoEl.pause();
                    });
                }}
                style={{
                    overflowX: replySwipeLocked ? 'hidden' : 'auto',
                    overflowY: replySwipeLocked ? 'hidden' : 'auto',
                }}
            >
                <div className="chat-room__messages-inner">
                    {loading ? <ChatMessagesSkeleton /> : (
                        items.map(({ m, isMine, dayBreak, shape }) => {
                            const isHighlighted = highlightId === m.id;
                            const dragX = dragState.id === m.id ? dragState.x : 0;
                            const dragActive = dragState.id === m.id ? dragState.active : false;
                            const showUnreadSeparator = Boolean(unreadAnchorId && unreadAnchorId === m.id);

                            const isMenuActive = Boolean(msgMenu && msgMenu.id === m.id);
                            const seenByCountForMessage = seenByUsersByMessage[m.id]?.length ?? 0;
                            const isSeenForUi = Boolean(
                                m.seen || (isGroupChat && isMine && seenByCountForMessage > 0)
                            );

                            // FIX: use optimistic reactions if available, fallback to server data
                            const effectiveReactions = optimisticReactions[m.id] ?? m.reactions;

                            return (
                                <div key={m.id}>
                                    {dayBreak && (
                                        <div className="chat-room__date-separator">
                                            <div className="chat-room__date-label">{formatDayLabel(m.timestamp)}</div>
                                        </div>
                                    )}

                                    {showUnreadSeparator && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', justifyContent: 'center' }}>
                                            <div style={{ height: 1, background: 'var(--border-primary)', flex: 1, opacity: 0.8 }} />
                                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 999, padding: '6px 10px', fontFamily: 'Vazir, sans-serif' }}>
                                                پیام‌های خوانده نشده{displayUnreadCount > 0 ? ` (${displayUnreadCount})` : ''}
                                            </div>
                                            <div style={{ height: 1, background: 'var(--border-primary)', flex: 1, opacity: 0.8 }} />
                                        </div>
                                    )}

                                    <div
                                        className={isMine ? 'message-row message-row--mine' : `message-row message-row--theirs${isGroupChat ? ' message-row--group' : ''}`}
                                        onPointerDown={(e) => {
                                            if (e.pointerType !== 'mouse' || e.button !== 0) return;
                                            swipeRef.current = { id: m.id, startX: e.clientX, startY: e.clientY, active: true, captured: false, pointerId: e.pointerId, blockClickUntil: swipeRef.current.blockClickUntil };
                                        }}
                                        onPointerMove={(e) => {
                                            if (e.pointerType !== 'mouse' || !swipeRef.current.active || swipeRef.current.id !== m.id) return;
                                            const dx = e.clientX - swipeRef.current.startX;
                                            const dy = e.clientY - swipeRef.current.startY;
                                            if (!swipeRef.current.captured) {
                                                // چپ به راست: dx باید مثبت باشد
                                                if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) || dx <= 0) return;
                                                swipeRef.current.captured = true;
                                                setReplySwipeLocked(true);
                                                try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
                                            }
                                            e.preventDefault();
                                            setDragState({ id: m.id, x: Math.max(0, Math.min(72, dx)), active: true });
                                        }}
                                        onPointerUp={(e) => {
                                            if (e.pointerType !== 'mouse' || !swipeRef.current.active || swipeRef.current.id !== m.id) return;
                                            const dx = e.clientX - swipeRef.current.startX;
                                            const dy = e.clientY - swipeRef.current.startY;
                                            if (swipeRef.current.captured) swipeRef.current.blockClickUntil = Date.now() + 280;
                                            if (dx > 60 && Math.abs(dx) > Math.abs(dy)) beginReply(m, true);
                                            resetDrag(m.id);
                                            swipeRef.current = { ...swipeRef.current, active: false, captured: false, pointerId: null };
                                        }}
                                        onPointerCancel={(e) => {
                                            if (e.pointerType !== 'mouse' || swipeRef.current.id !== m.id) return;
                                            resetDrag(m.id);
                                            swipeRef.current = { ...swipeRef.current, active: false, captured: false, pointerId: null };
                                        }}
                                        onTouchStart={(e) => {
                                            const t = e.touches[0];
                                            swipeRef.current = { id: m.id, startX: t.clientX, startY: t.clientY, active: true, captured: false, pointerId: null, blockClickUntil: swipeRef.current.blockClickUntil };
                                        }}
                                        onTouchMove={(e) => {
                                            if (!swipeRef.current.active || swipeRef.current.id !== m.id) return;
                                            const t = e.touches[0];
                                            const dx = t.clientX - swipeRef.current.startX;
                                            const dy = t.clientY - swipeRef.current.startY;
                                            if (!swipeRef.current.captured) {
                                                // چپ به راست: dx باید مثبت باشد
                                                if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) || dx <= 0) return;
                                                swipeRef.current.captured = true;
                                                setReplySwipeLocked(true);
                                            }
                                            e.preventDefault();
                                            setDragState({ id: m.id, x: Math.max(0, Math.min(72, dx)), active: true });
                                        }}
                                        onTouchEnd={(e) => {
                                            if (!swipeRef.current.active || swipeRef.current.id !== m.id) return;
                                            const t = e.changedTouches[0];
                                            const dx = t.clientX - swipeRef.current.startX;
                                            const dy = t.clientY - swipeRef.current.startY;
                                            if (swipeRef.current.captured) swipeRef.current.blockClickUntil = Date.now() + 280;
                                            if (dx > 60 && Math.abs(dx) > Math.abs(dy)) beginReply(m, true);
                                            resetDrag(m.id);
                                            swipeRef.current = { ...swipeRef.current, active: false, captured: false, pointerId: null };
                                        }}
                                        onTouchCancel={() => {
                                            if (swipeRef.current.id !== m.id) return;
                                            resetDrag(m.id);
                                            swipeRef.current = { ...swipeRef.current, active: false, captured: false, pointerId: null };
                                        }}
                                    >
                                        {isGroupChat && !isMine && (shape === 'msg-shape--single' || shape === 'msg-shape--last') && (() => {
                                            const sender = groupMembers[m.senderId];
                                            const senderName = sender?.name || m.senderId || 'ناشناس';
                                            return (
                                                <div style={{ position: 'absolute', left: 0, bottom: 0, cursor: 'pointer', zIndex: 1 }}
                                                    onClick={(e) => { e.stopPropagation(); openMember(m.senderId); }}>
                                                    <Avatar name={senderName} size="sm" src={sender?.avatar || ''} />
                                                </div>
                                            );
                                        })()}

                                        <div
                                            ref={(el) => { if (!el) { messageElsRef.current.delete(m.id); return; } messageElsRef.current.set(m.id, el); }}
                                            className={isMine ? `message-bubble message-bubble--mine ${shape}` : `message-bubble message-bubble--theirs ${shape}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (Date.now() < swipeRef.current.blockClickUntil) return;
                                                const ne = e.nativeEvent as MouseEvent;
                                                openMessageMenu(m.id, e.currentTarget, ne.clientX, ne.clientY);
                                            }}
                                            role="button" tabIndex={0}
                                            onKeyDown={(e) => { if (e.key === 'Enter') openMessageMenu(m.id, e.currentTarget as any); }}
                                            style={{
                                                cursor: 'pointer',
                                                transform: `translateX(${dragX}px)`,
                                                transition: dragActive ? 'none' : 'transform 140ms ease-out, box-shadow 180ms ease-out',
                                                touchAction: dragActive ? 'none' : 'auto',
                                                boxShadow: isHighlighted
                                                    ? '0 0 0 3px rgba(245, 158, 11, 0.4)'
                                                    : isMenuActive
                                                        ? '0 0 0 2px rgba(47, 128, 237, 0.35)'
                                                        : undefined,
                                            }}
                                        >
                                            {isGroupChat && !isMine && (shape === 'msg-shape--single' || shape === 'msg-shape--first') && (() => {
                                                const sender = groupMembers[m.senderId];
                                                const senderName = sender?.name || m.senderId || 'ناشناس';
                                                const colors = ['#E91E63', '#9C27B0', '#673AB7', '#3F51B5', '#2196F3', '#00BCD4', '#009688', '#4CAF50', '#FF5722', '#FF9800'];
                                                const colorIdx = m.senderId ? Math.abs(m.senderId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % colors.length : 0;
                                                return (
                                                    <div onClick={(e) => { e.stopPropagation(); openMember(m.senderId); }}
                                                        style={{ fontSize: 13, fontWeight: 700, color: colors[colorIdx], marginBottom: 3, cursor: 'pointer', fontFamily: 'Vazir, sans-serif', lineHeight: '1.2' }}>
                                                        {senderName}
                                                    </div>
                                                );
                                            })()}

                                            {m.forwardedFrom && (
                                                <button
                                                    type="button"
                                                    className="message-forwarded-label"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        openForwardSource(m);
                                                    }}
                                                >
                                                    فوروارد شده از: {m.forwardedFrom.name || m.forwardedFrom.username || 'ناشناس'}
                                                </button>
                                            )}

                                            {m.replyTo && (
                                                <div onClick={(e) => { e.stopPropagation(); scrollToMessage(m.replyTo!.id); }}
                                                    role="button" tabIndex={0}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') scrollToMessage(m.replyTo!.id); }}
                                                    className="message-reply-box"
                                                    style={{ marginBottom: 6, padding: '6px 10px', borderRadius: 12, cursor: 'pointer' }}>
                                                    <div className="message-reply-box__label">پاسخ</div>
                                                    <div className="message-reply-box__text">{getReplyPreviewText(m.replyTo)}</div>
                                                </div>
                                            )}

                                            {m.text && (
                                                <div className="message-text message-text--markdown">
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm]}
                                                        components={markdownComponents}
                                                    >
                                                        {m.text}
                                                    </ReactMarkdown>
                                                </div>
                                            )}
                                            {m.file && (
                                                <FileMessage
                                                    file={m.file}
                                                    token={token}
                                                    onMediaLoad={() => handleInitialMediaReady(m.id)}
                                                    onImageClick={(imageUrl, file) => setOpenedImage({ url: imageUrl, file })}
                                                />
                                            )}

                                            {effectiveReactions && effectiveReactions.length > 0 && (
                                                <div className="message-reactions">
                                                    {effectiveReactions.map((reaction: any, idx: number) => {
                                                        const userIds = reaction.userIds || [];
                                                        const isMyReaction = userIds.includes(currentUserId);
                                                        return (
                                                            <button key={idx}
                                                                className={isMyReaction ? 'message-reaction message-reaction--active' : 'message-reaction'}
                                                                onClick={(e) => { e.stopPropagation(); if (isMyReaction) handleDeleteReaction(m.id); else handleReact(m.id, reaction.emoji); }}
                                                                type="button"
                                                            >
                                                                <span className="message-reaction__emoji">{reaction.emoji}</span>
                                                                {reaction.count > 1 && <span className="message-reaction__count">{reaction.count}</span>}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            <div className={isMine ? 'message-meta message-meta--mine' : 'message-meta message-meta--theirs'}>
                                                <span className="message-time">{formatMessageTime(m.timestamp)}</span>
                                                {m.edited && <span style={{ fontSize: 10, opacity: isMine ? 0.9 : 0.7, marginLeft: 6 }}>ویرایش شده</span>}
                                                {isMine && (
                                                    <span className={isSeenForUi ? 'message-seen message-seen--double' : 'message-seen message-seen--single'}>
                                                        {isSeenForUi ? '✓✓' : '✓'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {msgMenu && (() => {
                const activeMsg = messages.find((mm) => mm.id === msgMenu.id);
                if (!activeMsg) return null;
                const activeMsgIsMine = activeMsg.senderId === currentUserId;
                const canDeleteActiveMsg = activeMsgIsMine || (isGroupChat && isVerifiedUser);
                const showSeenByAction = isGroupChat && activeMsgIsMine;

                return (
                    <div ref={msgMenuRef} className="popover popover--mini"
                        style={{ top: msgMenu.top, left: msgMenu.left, right: 'auto', position: 'absolute', zIndex: 50 }}
                        onClick={(e) => e.stopPropagation()}>
                        {showSeenByAction && (
                            <button className="popover__item" onClick={() => {
                                setSeenByMenu({ id: activeMsg.id, top: msgMenu.top, left: msgMenu.left });
                                setMsgMenu(null);
                            }} type="button">
                                <Eye size={16} />دیده شده توسط
                            </button>
                        )}
                        <button className="popover__item" onClick={() => { const el = messageElsRef.current.get(activeMsg.id); if (el) openReactionMenu(activeMsg.id, el, { top: msgMenu.top, left: msgMenu.left }); }} type="button">
                            <Smile size={16} />واکنش
                        </button>
                        <button className="popover__item" onClick={() => beginReply(activeMsg)} type="button"><Reply size={16} />پاسخ</button>
                        <button className="popover__item" onClick={() => openForwardModal(activeMsg.id)} type="button"><Forward size={16} />فوروارد</button>
                        {activeMsg.senderId === currentUserId && !activeMsg.forwardedFrom && (
                            <button className="popover__item" onClick={() => beginEdit(activeMsg)} type="button"><Pencil size={16} />ویرایش</button>
                        )}
                        <button className="popover__item" onClick={() => doCopyMessage(activeMsg)} type="button"><Copy size={16} />کپی</button>
                        {canDeleteActiveMsg && (
                            <button className="popover__item popover__item--danger" onClick={() => doDeleteMessage(activeMsg.id)} type="button">
                                <Trash2 size={16} />حذف
                            </button>
                        )}
                    </div>
                );
            })()}

            {seenByMenu && (() => {
                const rows = seenByUsersByMessage[seenByMenu.id] || [];

                return (
                    <div ref={seenByMenuRef} className="popover popover--mini"
                        style={{ top: seenByMenu.top, left: seenByMenu.left, right: 'auto', position: 'absolute', zIndex: 52 }}
                        onClick={(e) => e.stopPropagation()}>
                        <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                            دیده شده توسط ({rows.length})
                        </div>
                        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                            {rows.length === 0 ? (
                                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>
                                    هنوز کسی این پیام را ندیده است
                                </div>
                            ) : (
                                rows.map((u) => (
                                    <button key={u.chatId} className="popover__item" type="button"
                                        onClick={() => {
                                            setSeenByMenu(null);
                                            openMember(u.chatId);
                                        }}>
                                        <Avatar name={u.name || u.username || ''} src={u.avatar || ''} size="sm" />
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <span>{u.name || u.username || u.chatId}</span>
                                            {resolveVerified(u.verified) && <VerifiedBadge size={13} />}
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                );
            })()}

            {openedImage && (
                <ImageMediaViewer
                    imageUrl={openedImage.url}
                    downloadFile={openedImage.file}
                    token={token}
                    onClose={() => setOpenedImage(null)}
                />
            )}

            {reactionMenu && (() => {
                const reactionMsg = messages.find((mm) => mm.id === reactionMenu.id);
                if (!reactionMsg) return null;

                const reactionRows = optimisticReactions[reactionMsg.id] ?? reactionMsg.reactions ?? [];

                const myReaction = reactionRows.find((r: any) =>
                    r.userIds && Array.isArray(r.userIds) && r.userIds.includes(currentUserId)
                );

                const reactionUsersList: { userId: string; emoji: string; name: string; avatar: string; verified: boolean }[] = [];
                if (reactionRows.length > 0) {
                    reactionRows.forEach((r: any) => {
                        (r.userIds || []).forEach((uid: string) => {
                            const member = groupMembers[uid];
                            reactionUsersList.push({
                                userId: uid,
                                emoji: r.emoji,
                                name: member?.name || uid,
                                avatar: member?.avatar || '',
                                verified: resolveVerified(member?.verified),
                            });
                        });
                    });
                }

                return (
                    <div ref={reactionMenuRef}
                        style={{ top: reactionMenu.top, left: reactionMenu.left, right: 'auto', position: 'absolute', zIndex: 50 }}
                        onClick={(e) => e.stopPropagation()}>
                        <ReactionPicker
                            messageId={reactionMsg.id}
                            currentReaction={myReaction?.emoji}
                            onReact={(id, emoji) => handleReact(id, emoji)}
                            onDeleteReaction={(id) => handleDeleteReaction(id)}
                            onClose={() => setReactionMenu(null)}
                        />

                        {isGroupChat && reactionUsersList.length > 0 && (
                            <div style={{ marginTop: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 12, overflow: 'hidden', minWidth: 220, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                                <div style={{ padding: '7px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)', fontFamily: 'Vazir, sans-serif' }}>
                                    واکنش‌ها
                                    ({reactionUsersList.length})
                                </div>
                                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                                    {reactionUsersList.map((ru, i) => (
                                        <div key={i}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setReactionMenu(null);
                                                openMember(ru.userId);
                                            }}
                                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: i > 0 ? '1px solid var(--border-primary)' : 'none', cursor: 'pointer', transition: 'background 0.12s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-tertiary, rgba(0,0,0,0.04))')}
                                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                                                <Avatar name={ru.name} size="xs" src={ru.avatar} />
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
                                                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'Vazir, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {ru.name}
                                                </span>
                                                {ru.verified && <VerifiedBadge size={13} />}
                                            </div>
                                            <span style={{ fontSize: 18, flexShrink: 0 }}>{ru.emoji}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}

            {(newMsgCount > 0 || showScrollBtn) && (
                <button type="button" aria-label="Jump to latest messages"
                    onClick={() => { scrollToBottom(true); setNewMsgCount(0); setShowScrollBtn(false); }}
                    style={{ position: 'absolute', right: 16, bottom: 96, display: 'flex', alignItems: 'center', gap: 10, padding: newMsgCount > 0 ? '8px 10px' : '10px', borderRadius: 999, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', boxShadow: '0 6px 20px rgba(0,0,0,0.10)', cursor: 'pointer', fontSize: 12, lineHeight: '12px' }}>
                    <ArrowDown size={16} />
                    {newMsgCount > 0 && (
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{newMsgCount}</span>
                            <span style={{ width: 6, height: 6, borderRadius: 999, background: '#2F80ED', marginTop: 4 }} />
                        </span>
                    )}
                </button>
            )}

            <div className="chat-room__input-area">
                {(replyTo || editingId) && (
                    <div className="chat-room__reply-edit-box">
                        <div style={{ minWidth: 0 }}>
                            <div className="chat-room__reply-edit-box__title">{editingId ? 'در حال ویرایش' : 'در حال پاسخ'}</div>
                            {!editingId && replyTo && <div className="chat-room__reply-edit-box__text">{getReplyPreviewText(replyTo)}</div>}
                        </div>
                        <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => { setReplyTo(null); setEditingId(null); setText(''); }}>
                            <X size={18} />
                        </button>
                    </div>
                )}
                {uploadedFile && (
                    <div className="chat-room__reply-edit-box">
                        <div style={{ minWidth: 0 }}>
                            <div className="chat-room__reply-edit-box__title">فایل آپلود شده</div>
                            <div className="chat-room__reply-edit-box__text">{uploadedFile.fileName}</div>
                        </div>
                        <button type="button" className="icon-btn" aria-label="Remove file" onClick={() => {
                            if (uploadedFile) void cleanupUploadedFile(uploadedFile);
                            setUploadedFile(null);
                        }}><X size={18} /></button>
                    </div>
                )}
                {pendingForwardDraft && (
                    <div className="chat-room__reply-edit-box">
                        <div style={{ minWidth: 0 }}>
                            <div className="chat-room__reply-edit-box__title">در حال فوروارد پیام</div>
                            <div className="chat-room__reply-edit-box__text">{getForwardPreviewText(pendingForwardDraft)}</div>
                        </div>
                        <button
                            type="button"
                            className="icon-btn"
                            aria-label="Cancel forward"
                            onClick={() => onClearPendingForwardDraft?.(chatId)}
                        >
                            <X size={18} />
                        </button>
                    </div>
                )}
                <div className="chat-room__input-wrapper">
                    <FileUpload token={token} onFileUploaded={handleFileUploaded} />
                    <textarea ref={textareaRef} className="chat-room__text-input" placeholder="پیام..."
                        value={text} onChange={(e) => setText(e.target.value)}
                        onFocus={() => { setTimeout(() => { if (computeNearBottom()) scrollToBottom(false); }, 80); }}
                        onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            const isDesktop = typeof window !== 'undefined' && window.matchMedia('(pointer:fine)').matches;
                            if (!isDesktop) return;
                            if (e.shiftKey || e.ctrlKey || e.metaKey) return;
                            e.preventDefault();
                            submit();
                        }}
                        rows={1}
                    />
                    <button
                        className={text.trim() || uploadedFile || (pendingForwardDraft && !editingId) ? 'chat-room__send-btn chat-room__send-btn--active' : 'chat-room__send-btn chat-room__send-btn--disabled'}
                        onClick={submit} disabled={!text.trim() && !uploadedFile && (!pendingForwardDraft || Boolean(editingId))} aria-label="Send" type="button">
                        <SendHorizontal size={18} />
                    </button>
                </div>
            </div>

            <ForwardModal isOpen={forwardModalOpen} chats={chats} currentUserId={currentUserId}
                onClose={() => setForwardModalOpen(false)} onSelectTargetChat={handleForwardFromModal} onSelectChat={onSelectChat} />

            {confirmDeleteChat && (
                <div className="chat-room-modal-overlay" ref={confirmDeleteChatRef}>
                    <div className="chat-room-confirm-modal">
                        <h3 className="chat-room-confirm-modal__title">{isGroupChat ? 'گروه حذف شود؟' : 'گفتگو حذف شود؟'}</h3>
                        <p className="chat-room-confirm-modal__text">
                            {isGroupChat ? 'گروه و تمام پیام‌ها برای همه حذف خواهد شد.' : 'این عمل گفتگو و تمام پیام‌ها را برای هر دو کاربر حذف خواهد کرد.'}
                        </p>
                        <div className="chat-room-confirm-modal__actions">
                            <button className="chat-room-confirm-modal__btn" onClick={() => setConfirmDeleteChat(false)} type="button">لغو</button>
                            <button className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger" onClick={doDeleteChat} type="button">حذف</button>
                        </div>
                    </div>
                </div>
            )}

            {confirmLeaveGroup && (
                <div className="chat-room-modal-overlay" ref={confirmLeaveGroupRef}>
                    <div className="chat-room-confirm-modal">
                        <h3 className="chat-room-confirm-modal__title">خروج از گروه؟</h3>
                        <p className="chat-room-confirm-modal__text">آیا می‌خواهید از گروه خارج شوید؟ گروه برای شما حذف خواهد شد.</p>
                        <div className="chat-room-confirm-modal__actions">
                            <button className="chat-room-confirm-modal__btn" onClick={() => setConfirmLeaveGroup(false)} type="button">لغو</button>
                            <button className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger" onClick={doLeaveGroup} type="button">خروج</button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDeleteMsg && (
                <div className="chat-room-modal-overlay" ref={confirmDeleteMsgRef}>
                    <div className="chat-room-confirm-modal">
                        <h3 className="chat-room-confirm-modal__title">این پیام حذف شود؟</h3>
                        <p className="chat-room-confirm-modal__text">این عمل پیام را کامل حذف میکند.</p>
                        <div className="chat-room-confirm-modal__actions">
                            <button className="chat-room-confirm-modal__btn" onClick={() => setConfirmDeleteMsg(null)} type="button">لغو</button>
                            <button className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger" onClick={confirmDeleteMessage} type="button">حذف</button>
                        </div>
                    </div>
                </div>
            )}
        </motion.div>
    );
}
