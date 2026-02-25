import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, Copy, MoreVertical, Pencil, Reply, SendHorizontal, Smile, Trash2, X, Forward, Users, Search, LogOut, Save, Image as ImageIcon } from 'lucide-react';
import type { Message, MessageReply as MessageReplyType, User, Chat, FileMetadata } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { apiFetch, API_BASE_URL } from '../config/api';
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

    const uploadGroupAvatar = async (file: File) => {
        if (!file) return;

        if (file.size > 3 * 1024 * 1024) {
            setGroupEditError('حجم فایل نباید بیشتر از ۳ مگابایت باشد');
            return;
        }

        const token = localStorage.getItem('token') || '';
        if (!token) {
            setGroupEditError('توکن یافت نشد');
            return;
        }

        setSavingGroup(true);
        setGroupEditError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch(`${API_BASE_URL}/files/upload`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'ngrok-skip-browser-warning': 'true',
                },
                body: formData,
            });

            if (!res.ok) throw new Error('upload failed');
            const json = await res.json();

            const fileId = json?.file?.fileId || json?.file?.id || json?.file?.file_id || json?.file?.path || '';
            if (!fileId) throw new Error('invalid upload response');

            setGroupAvatar(String(fileId));
        } catch (e) {
            console.error(e);
            setGroupEditError('آپلود عکس گروه با خطا مواجه شد');
        } finally {
            setSavingGroup(false);
        }
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
        if (!isGroupChat) { setGroupMembers({}); return; }
        let cancelled = false;
        const loadMembers = async () => {
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    const resetDrag = (messageId: string) => {
        setDragState({ id: messageId, x: 0, active: false });
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

    const handleReact = async (messageId: string, emoji: string) => {
        setReactionMenu(null); setMsgMenu(null);
        try {
            await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
        } catch (e) { console.error('Failed to react:', e); }
    };

    const handleDeleteReaction = async (messageId: string) => {
        setReactionMenu(null); setMsgMenu(null);
        try {
            await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'DELETE' });
        } catch (e) { console.error('Failed to delete reaction:', e); }
    };

    const handleForwardMessage = async (targetChatId: string) => {
        if (!forwardingMessageId) return;
        try {
            await apiFetch('/messages/forward', { method: 'POST', body: JSON.stringify({ sourceChatId: chatId, messageId: forwardingMessageId, targetChatId }) });
            setForwardingMessageId(null);
        } catch (e) {
            console.error('Failed to forward:', e);
            alert('فوروارد پیام با خطا مواجه شد');
        }
    };

    const openForwardModal = (messageId: string) => {
        setForwardingMessageId(messageId);
        setForwardModalOpen(true);
        setMsgMenu(null);
    };

    const handleFileUploaded = (file: FileMetadata) => setUploadedFile(file);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (menuRef.current?.contains(target)) return;
            if (msgMenuRef.current?.contains(target)) return;
            if (reactionMenuRef.current?.contains(target)) return;
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
        setReplyTo(null); setEditingId(null);
        setMsgMenu(null); setReactionMenu(null);
        setText(''); setUploadedFile(null);
        setUnreadAnchorId(null);

        setDisplayUnreadCount(initialUnreadCount);
        autoJumpedToUnreadRef.current = false;
        userScrolledAfterAutoJumpRef.current = false;
        programmaticScrollEventsRef.current = 0;
        consumedInitialUnreadRef.current = false;
        userHasScrolledRef.current = false;

        // reset group edit state when switching chats
        setEditingGroup(false);
        setSavingGroup(false);
        setGroupEditError(null);
        setGroupName('');
        setGroupAvatar('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chatId]);

    // ... (rest of file unchanged)
