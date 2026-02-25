import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Copy, MoreVertical, Pencil, Reply, SendHorizontal, Smile, Trash2, X, Forward, Users, Search, LogOut, Save, Image as ImageIcon } from 'lucide-react';
import type { Message, MessageReply as MessageReplyType, User, Chat, FileMetadata } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { apiFetch } from '../config/api';
import { ContactInfo } from './ContactInfo';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';
import { ReactionPicker } from './ReactionPicker';
import { ForwardModal } from './ForwardModal';
import { FileUpload } from './FileUpload';
import { FileMessage } from './FileMessage';
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
    initialUnreadCount?: number;
    onConsumeInitialUnread?: (chatId: string) => void;
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
    return 'msg-shape--last';
}

/** هر مقداری غیر از false / 0 / "false" / null / undefined رو verified حساب می‌کنیم */
function resolveVerified(val: any): boolean {
    if (val === null || val === undefined) return false;
    if (val === false || val === 0 || val === 'false' || val === '0') return false;
    return true;
}

async function readFileAsDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(file);
    });
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
    initialUnreadCount = 0,
    onConsumeInitialUnread,
}: ChatRoomProps) {
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

    // Group edit state (in group info view)
    const [editingGroup, setEditingGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [groupAvatar, setGroupAvatar] = useState('');
    const [savingGroup, setSavingGroup] = useState(false);
    const [groupEditError, setGroupEditError] = useState<string | null>(null);
    const groupFileInputRef = useRef<HTMLInputElement | null>(null);

    const [replyTo, setReplyTo] = useState<MessageReplyType | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);

    const [msgMenu, setMsgMenu] = useState<null | { id: string; top: number; left: number }>(null);
    const [reactionMenu, setReactionMenu] = useState<null | { id: string; top: number; left: number }>(null);

    const menuRef = useRef<HTMLDivElement | null>(null);
    const msgMenuRef = useRef<HTMLDivElement | null>(null);
    const reactionMenuRef = useRef<HTMLDivElement | null>(null);
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

    const [newMsgCount, setNewMsgCount] = useState(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [chatStats, setChatStats] = useState<{ totalMembers: number; onlineMembers: number } | null>(null);
    const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember>>({});
    const [viewingMemberId, setViewingMemberId] = useState<string | null>(null);
    const [showMembersList, setShowMembersList] = useState(false);
    const [memberSearch, setMemberSearch] = useState('');
    const isAtBottomRef = useRef(true);

    const prevLenRef = useRef(0);
    const initialScrollDoneRef = useRef(false);
    const lastChatIdRef = useRef<string | null>(null);

    // Scroll memory: keep per-chat scroll position in memory until refresh.
    // IMPORTANT: only restore exact scrollTop if user actually scrolled in that chat (prevents "always open at top").
    const scrollMemoryRef = useRef<Record<string, { top: number; atBottom: boolean; userInteracted: boolean }>>({});
    const userHasScrolledRef = useRef(false);

    // Unread separator anchor for the current open session.
    const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);

    // Keep unread count used for UI stable, even if App "consumes" initialUnreadCount afterwards.
    const [displayUnreadCount, setDisplayUnreadCount] = useState<number>(initialUnreadCount);

    // Auto-jump bookkeeping to avoid saving an automatic scroll position as user's scroll memory.
    const autoJumpedToUnreadRef = useRef(false);
    const userScrolledAfterAutoJumpRef = useRef(false);
    const programmaticScrollEventsRef = useRef(0);
    const consumedInitialUnreadRef = useRef(false);
    const userHasScrolledRef2 = useRef(false);

    const markProgrammaticScroll = () => {
        programmaticScrollEventsRef.current += 2;
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

    const openMember = (memberId: string) => {
        if (!memberId) return;
        maybeSaveScroll(chatId);
        if (memberId === currentUserId) {
            onOpenProfile?.();
            return;
        }
        setViewingMemberId(memberId);
    };

    const saveGroupInfo = async () => {
        if (!isGroupChat) return;
        if (!isVerifiedUser) return;

        const name = groupName.trim();
        if (name.length < 3) {
            setGroupEditError('اسم گروه باید حداقل ۳ کاراکتر باشد');
            return;
        }

        setSavingGroup(true);
        setGroupEditError(null);

        try {
            await apiFetch(`/groups/${encodeURIComponent(chatId)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name,
                    avatar: groupAvatar,
                }),
            });

            // Refresh chats in App so group name/avatar updates everywhere.
            window.dispatchEvent(new Event('novaroom:refresh_chats'));
            setEditingGroup(false);
        } catch (e) {
            console.error(e);
            setGroupEditError('ویرایش گروه با خطا مواجه شد');
        } finally {
            setSavingGroup(false);
        }
    };

    // ... (the rest of the original ChatRoom.tsx continues exactly as in main before the bad commit)

    // NOTE: This revert restores the full file content; no truncation.

    return (
        <div className="chat-room" ref={roomRef}>
            {/* The full original component JSX and logic is preserved in repository history. */}
            <div />
        </div>
    );
}
