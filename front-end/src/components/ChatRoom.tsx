import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import TelegramIcon from './TelegramIcon';
import { ChevronLeft, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, type Variants } from "framer-motion";
import type { Message, MessageReply as MessageReplyType, User, Chat, FileMetadata, PendingAttachment, PendingForwardDraft, PinnedMessage, GroupPreview } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { API_BASE_URL, apiFetch, getMessageSeenBy } from '../config/api';
import { ContactInfo } from './ContactInfo';
import { GroupJoinSheet } from './GroupJoinSheet';
import { cx } from '../utils/cx';
import { isElementScrolled } from '../utils/scrollFade';
import { ChatMessagesSkeleton } from './ChatMessagesSkeleton';
import { ReactionPicker } from './ReactionPicker';
import { ForwardModal } from './ForwardModal';
import { ImageMediaViewer } from './ImageMediaViewer';
import { VideoMediaViewer } from './VideoMediaViewer';
import { decryptFileBytesClientSide } from '../utils/e2ee';
import { screenVariants } from '../utils/screenMotion';
import { deleteCachedBlob, getCachedBlob, getOrCacheBlob } from '../utils/mediaCache';
import { pendingUploadedFileByChat } from '../utils/pendingUploads';
import {
    clearChatDraft,
    getChatDraft,
    getChatScrollMemory,
    setChatDraft,
    setChatScrollMemory,
} from '../utils/chatDrafts';
import { formatDayLabel, formatLastSeen, formatMessageTime, messageDayKey, resolveVerified, toPersianDigits } from '../utils/format';
import { copyText } from '../utils/clipboard';
import { useCustomTextSelection } from '../utils/customTextSelection';
import { triggerHaptic } from '../utils/haptics';
import { updateSearchPillsFade } from '../utils/searchPillsFade';
import { getChatNotifyMode, setChatNotifyMode, useNotificationPrefs } from '../utils/pushNotifications';
import { ChatMessageItem, type ReactionEntry } from './ChatMessageItem';
import { ChatComposer, type ChatComposerSendPayload } from './ChatComposer';
import { fileUploadPicker } from './FileUpload';
import { GroupMembersView, type GroupMember } from './GroupMembersView';
import './FileComponents.css';

const EMPTY_REACTIONS: ReactionEntry[] = [];
const MAX_SELECTED_MESSAGES = 30;

const chatRoomScreenVariants: Variants = {
    ...screenVariants,
    hidden: { opacity: 1 },
    visible: { opacity: 1 },
};

// shortcut: group member cache skips payloads over 200KB; move it to IndexedDB when huge groups show up.
const groupMemberCacheKey = (chatId: string) => `novaroom:group-members:v1:${chatId}`;

type ChatStatsData = { totalMembers: number; onlineMembers: number; membershipClosed?: boolean };

const chatStatsCacheKey = (chatId: string) => `novaroom:chat-stats:v1:${chatId}`;

function readCachedChatStats(chatId: string): ChatStatsData | null {
    if (!chatId) return null;
    try {
        const raw = localStorage.getItem(chatStatsCacheKey(chatId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || typeof parsed.totalMembers !== 'number') return null;
        return {
            totalMembers: Math.max(0, Number(parsed.totalMembers) || 0),
            onlineMembers: Math.max(0, Number(parsed.onlineMembers) || 0),
            membershipClosed: Boolean(parsed.membershipClosed),
        };
    } catch {
        return null;
    }
}

function writeCachedChatStats(chatId: string, stats: ChatStatsData) {
    if (!chatId) return;
    try {
        localStorage.setItem(chatStatsCacheKey(chatId), JSON.stringify(stats));
    } catch {
        return;
    }
}

function readCachedGroupMembers(chatId: string): Record<string, GroupMember> {
    if (!chatId) return {};
    try {
        const raw = localStorage.getItem(groupMemberCacheKey(chatId));
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed as Record<string, GroupMember> : {};
    } catch {
        return {};
    }
}

function writeCachedGroupMembers(chatId: string, members: Record<string, GroupMember>) {
    if (!chatId) return;
    try {
        const raw = JSON.stringify(members);
        if (raw.length > 200_000) return;
        localStorage.setItem(groupMemberCacheKey(chatId), raw);
    } catch {
        return;
    }
}

interface ChatRoomProps {
    chatId: string;
    contact: User;
    messages: Message[];
    currentUserId: string;
    currentUser?: User | null;
    onSendMessage: (payload: { text: string; replyToId?: string; replyQuoteText?: string; replyIsQuote?: boolean; editMessageId?: string; attachment?: PendingAttachment }) => void;
    onDeleteMessage: (messageId: string) => void;
    onDeleteMessages?: (messageIds: string[]) => void | Promise<void>;
    onBack: () => void;
    onCloseChat: () => void;
    onChatDeleted?: (chatId: string) => void;
    loading?: boolean;
    chats: Chat[];
    onSelectChat?: (chatId: string) => void;
    onOpenDirectChat?: (user: User) => void;
    onOpenProfile?: () => void;
    onOpenAIChat?: () => void;
    onOpenSavedMessages?: () => void;
    onOpenContactInfo?: (chatId: string) => void;
    forceContactInfoOpen?: boolean;
    onCloseForcedContactInfo?: (chatId: string) => void;
    initialUnreadCount?: number;
    initialFirstUnreadId?: string | null;
    onMarkRead?: (maxMessageId: string, newlyReadCount: number) => void;
    onReaderStateChange?: (state: { atBottom: boolean }) => void;
    onReactMessage?: (chatId: string, messageId: string, emoji: string) => Promise<void>;
    onUnreactMessage?: (chatId: string, messageId: string) => Promise<void>;
    onForwardMessage?: (sourceChatId: string, messageIdOrIds: string | string[], targetChatId: string) => Promise<void>;
    pendingForwardDraft?: PendingForwardDraft | null;
    onSetPendingForwardDraft?: (targetChatId: string, draft: PendingForwardDraft) => void;
    onClearPendingForwardDraft?: (targetChatId: string) => void;
    typingUserIds?: string[];
    uploadingUserIds?: string[];
    onTypingChange?: (chatId: string, isTyping: boolean) => void;
    isUserBlocked?: (user: User) => boolean;
    onToggleBlockUser?: (user: User) => void | Promise<void>;
    hasOlderMessages?: boolean;
    hasNewerMessages?: boolean;
    loadingOlderMessages?: boolean;
    loadingNewerMessages?: boolean;
    onLoadOlderMessages?: (chatId: string) => void | Promise<void>;
    onLoadNewerMessages?: (chatId: string) => void | Promise<void>;
    onJumpToLatestMessages?: (chatId: string) => void | Promise<void>;
    pinnedMessage?: PinnedMessage | null;
    interactiveOnlineUsers?: Record<string, number>;
    onPinMessage?: (chatId: string, messageId: string) => void | Promise<void>;
    onUnpinMessage?: (chatId: string) => void | Promise<void>;
    onJumpToMessage?: (chatId: string, messageId: string) => void | Promise<void>;
    targetScrollMessage?: { chatId: string; messageId: string; timestamp: number } | null;
    jumpingToMessage?: boolean;
    onJumpToMessageSettled?: () => void;
    onCancelJumpToMessage?: () => void;
    unreadMentionIds?: string[];
    unreadReactionIds?: string[];
    onAckMention?: (chatId: string, messageId: string) => void | Promise<void>;
    onAckReaction?: (chatId: string, messageId: string) => void | Promise<void>;
    onJoinGroupByCode?: (inviteCode: string) => Promise<void>;
}

function bubbleShape(prevSameSender: boolean, nextSameSender: boolean) {
    if (!prevSameSender && !nextSameSender) return 'msg-shape--single';
    if (!prevSameSender && nextSameSender) return 'msg-shape--first';
    if (prevSameSender && nextSameSender) return 'msg-shape--middle';
    if (prevSameSender && !nextSameSender) return 'msg-shape--last';
    return 'msg-shape--single';
}

function ConfirmDialog({
    title,
    text,
    confirmLabel,
    onCancel,
    onConfirm,
    overlayRef,
}: {
    title: string;
    text: string;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
    overlayRef?: RefObject<HTMLDivElement | null>;
}) {
    return (
        <motion.div className="chat-room-modal-overlay" ref={overlayRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: 'easeOut' }}>
            <motion.div className="chat-room-confirm-modal" initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}>
                <h3 className="chat-room-confirm-modal__title">{title}</h3>
                <p className="chat-room-confirm-modal__text">{text}</p>
                <div className="chat-room-confirm-modal__actions">
                    <button className="chat-room-confirm-modal__btn" onClick={onCancel} type="button">لغو</button>
                    <button className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger" onClick={onConfirm} type="button">{confirmLabel}</button>
                </div>
            </motion.div>
        </motion.div>
    );
}

function getPureEmojiCount(input: string): number {
    const value = String(input || '').trim();
    if (!value) return 0;
    const emojiMatches = value.match(/\p{Extended_Pictographic}/gu) || [];
    if (!emojiMatches.length) return 0;
    const nonEmojiParts = value
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/[\u200D\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}\s]/gu, '');
    if (nonEmojiParts.length > 0) return 0;
    return emojiMatches.length;
}

type SeenByUser = {
    chatId: string;
    name: string;
    username?: string;
    avatar?: string;
    verified?: boolean;
};



function applyOptimisticReactions(
    reactions: ReactionEntry[] | undefined,
    userId: string,
    emoji?: string,
): ReactionEntry[] {
    const base: ReactionEntry[] = (reactions || []).map((r) => ({ ...r, userIds: [...r.userIds] }));
    base.forEach((r) => {
        const idx = r.userIds.indexOf(userId);
        if (idx !== -1) { r.userIds.splice(idx, 1); r.count = Math.max(0, r.count - 1); }
    });
    if (emoji) {
        const existing = base.find((r) => r.emoji === emoji);
        if (existing) { existing.userIds.push(userId); existing.count += 1; }
        else base.push({ emoji, count: 1, userIds: [userId] });
    }
    return base.filter((r) => r.count > 0);
}

function reactionsEqual(a: ReactionEntry[], b: ReactionEntry[]): boolean {
    if (a.length !== b.length) return false;
    const byEmoji = new Map(b.map((r) => [r.emoji, r]));
    return a.every((ra) => {
        const rb = byEmoji.get(ra.emoji);
        if (!rb || ra.count !== rb.count) return false;
        const aIds = Array.isArray(ra.userIds) ? ra.userIds : [];
        const bIds = Array.isArray(rb.userIds) ? rb.userIds : [];
        if (aIds.length !== bIds.length) return false;
        const ids = new Set(bIds);
        return aIds.every((id) => ids.has(id));
    });
}

function membersEqual(a: Record<string, GroupMember>, b: Record<string, GroupMember>): boolean {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every((key) => {
        const left = a[key];
        const right = b[key];
        return Boolean(right)
            && left.name === right.name
            && left.username === right.username
            && left.avatar === right.avatar
            && left.bio === right.bio
            && left.verified === right.verified
            && left.online === right.online
            && left.lastSeen === right.lastSeen
            && left.lastSeenCategory === right.lastSeenCategory
            && left.isMember === right.isMember
            && left.isBanned === right.isBanned;
    });
}


export function ChatRoom({
    chatId,
    contact,
    messages,
    currentUserId,
    currentUser,
    onSendMessage,
    onDeleteMessage,
    onDeleteMessages,
    onBack,
    onCloseChat,
    onChatDeleted,
    loading = false,
    chats,
    onSelectChat,
    onOpenDirectChat,
    onOpenProfile,
    onOpenAIChat,
    onOpenSavedMessages,
    onOpenContactInfo,
    forceContactInfoOpen = false,
    onCloseForcedContactInfo,
    initialUnreadCount = 0,
    initialFirstUnreadId = null,
    onMarkRead,
    onReaderStateChange,
    onReactMessage,
    onUnreactMessage,
    onForwardMessage,
    pendingForwardDraft = null,
    onSetPendingForwardDraft,
    onClearPendingForwardDraft,
    typingUserIds = [],
    uploadingUserIds = [],
    onTypingChange,
    isUserBlocked,
    onToggleBlockUser,
    hasOlderMessages = false,
    hasNewerMessages = false,
    loadingOlderMessages = false,
    loadingNewerMessages = false,
    onLoadOlderMessages,
    onLoadNewerMessages,
    onJumpToLatestMessages,
    pinnedMessage = null,
    interactiveOnlineUsers,
    onPinMessage,
    onUnpinMessage,
    onJumpToMessage,
    targetScrollMessage = null,
    jumpingToMessage = false,
    onJumpToMessageSettled,
    onCancelJumpToMessage,
    unreadMentionIds = [],
    unreadReactionIds = [],
    onAckMention,
    onAckReaction,
    onJoinGroupByCode,
}: ChatRoomProps) {
    const currentChat = useMemo(
        () => chats.find((c) => c.id === chatId) || null,
        [chats, chatId]
    );
    const isOfficialChannel = chatId === 'official-channel';
    const isGroupChat = isOfficialChannel || currentChat?.chatType === 'group';
    const isDirectChat = !isGroupChat;
    const isVerifiedUser = resolveVerified(currentUser?.verified);
    const isAdminUser = Boolean(currentUser?.adminLevel);
    const canManageGroup = Boolean(isGroupChat && !isOfficialChannel && (
        currentUser?.adminLevel || String(contact.createdBy || '') === currentUserId
    ));
    const canDeleteOthersMessages = canManageGroup || Boolean(isOfficialChannel && isAdminUser);
    const canSendInOfficialChannel = !isOfficialChannel || isAdminUser;
    const canSwipeToReply = !(isOfficialChannel && !isAdminUser);
    const blockedByOther = Boolean((contact as any)?.blockedByOther);
    const isContactBlocked = isDirectChat && !chatId.startsWith('saved_messages_') && (blockedByOther || Boolean(isUserBlocked?.(contact)));
    const notifyPrefs = useNotificationPrefs();
    const notifyMode = getChatNotifyMode(notifyPrefs, chatId);

    const [chatMenuOpen, setChatMenuOpen] = useState(false);
    const [chatMenuSubmenu, setChatMenuSubmenu] = useState<null | 'notifications'>(null);
    const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
    const [confirmLeaveGroup, setConfirmLeaveGroup] = useState(false);
    const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<string | null>(null);
    const [confirmPin, setConfirmPin] = useState<null | { action: 'pin' | 'unpin'; messageId?: string }>(null);
    const [showContactInfo, setShowContactInfo] = useState(false);
    const [forwardModalOpen, setForwardModalOpen] = useState(false);
    const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);
    const [forwardingMessageIds, setForwardingMessageIds] = useState<string[]>([]);
    const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
    const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
    const [copyToast, setCopyToast] = useState<string | null>(null);
    const [forwardSourceUser, setForwardSourceUser] = useState<User | null>(null);
    const forwardingInFlightRef = useRef(false);

    const [replyTo, setReplyTo] = useState<MessageReplyType | null>(() => getChatDraft(chatId)?.replyTo ?? null);
    const [messagesScrolled, setMessagesScrolled] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const prevDraftChatIdRef = useRef(chatId);
    useEffect(() => {
        if (prevDraftChatIdRef.current !== chatId) {
            prevDraftChatIdRef.current = chatId;
            setReplyTo(getChatDraft(chatId)?.replyTo ?? null);
            return;
        }
        if (!editingId) {
            setChatDraft(chatId, { replyTo });
        }
    }, [chatId, replyTo, editingId]);
    const idleDateTimerRef = useRef<number | null>(null);

    const [msgMenu, setMsgMenu] = useState<null | { id: string; top: number; left: number; isFileDownloaded?: boolean }>(null);
    const [reactionMenu, setReactionMenu] = useState<null | { id: string; top: number; left: number }>(null);
    const [seenByMenu, setSeenByMenu] = useState<null | { id: string; top: number; left: number }>(null);
    const [reactionListMenu, setReactionListMenu] = useState<null | { id: string; top: number; left: number }>(null);
    const [seenByUsersByMessage, setSeenByUsersByMessage] = useState<Record<string, SeenByUser[]>>({});
    const [seenByLoadingMessageId, setSeenByLoadingMessageId] = useState<string | null>(null);
    const [reasoningPanelByMessage, setReasoningPanelByMessage] = useState<Record<string, boolean>>({});
    const [composerHeight, setComposerHeight] = useState(0);
    const [selectionShake, setSelectionShake] = useState(0);
    const composerHostRef = useRef<HTMLDivElement | null>(null);

    
    const [optimisticReactions, setOptimisticReactions] = useState<Record<string, ReactionEntry[]>>({});

    const menuRef = useRef<HTMLDivElement | null>(null);
    const msgMenuRef = useRef<HTMLDivElement | null>(null);
    const reactionMenuRef = useRef<HTMLDivElement | null>(null);
    const seenByMenuRef = useRef<HTMLDivElement | null>(null);
    const reactionListMenuRef = useRef<HTMLDivElement | null>(null);
    const confirmDeleteChatRef = useRef<HTMLDivElement | null>(null);
    const confirmPinRef = useRef<HTMLDivElement | null>(null);
    const confirmDeleteMsgRef = useRef<HTMLDivElement | null>(null);
    const confirmLeaveGroupRef = useRef<HTMLDivElement | null>(null);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const roomRef = useRef<HTMLDivElement | null>(null);
    const topSentinelRef = useRef<HTMLDivElement | null>(null);

    const messageElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const unreadSeparatorRef = useRef<HTMLDivElement | null>(null);
    const [highlightId, setHighlightId] = useState<string | null>(null);
    const [arrivedMessageIds, setArrivedMessageIds] = useState<string[]>([]);
    const arrivedAnimationTimerRef = useRef<number | null>(null);
    const highlightTimeoutRef = useRef<number | null>(null);
    const quoteHighlightTimeoutRef = useRef<number | null>(null);
    const pendingJumpQuoteRef = useRef<{ messageId: string; quoteText: string } | null>(null);
    const highlightRafRef = useRef<number | null>(null);
    const missingJumpAttemptRef = useRef<{ id: string; at: number } | null>(null);
    const [resolvingMention, setResolvingMention] = useState(false);
    const mentionAbortRef = useRef<AbortController | null>(null);
    const mentionRequestIdRef = useRef(0);
    const shakeTimersRef = useRef<Record<string, number>>({});

    const [replySwipeLocked, setReplySwipeLocked] = useState(false);

    const [newMsgCount, setNewMsgCount] = useState(0);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [isJumpingToLatest, setIsJumpingToLatest] = useState(false);
    const [localLoadingOlder, setLocalLoadingOlder] = useState(false);
    const [localLoadingNewer, setLocalLoadingNewer] = useState(false);
    const [chatStats, setChatStats] = useState<ChatStatsData | null>(() => (
        isGroupChat ? readCachedChatStats(chatId) : null
    ));
    const [invitePreviewGroup, setInvitePreviewGroup] = useState<GroupPreview | null>(null);
    const [joiningPreviewGroup, setJoiningPreviewGroup] = useState(false);
    const [invitePreviewError, setInvitePreviewError] = useState('');
    const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember>>(() => (isGroupChat ? readCachedGroupMembers(chatId) : {}));
    const groupMembersSnapshotRef = useRef<Record<string, GroupMember> | null>(null);
    const [membersResolved, setMembersResolved] = useState<boolean>(() => !isGroupChat || Object.keys(readCachedGroupMembers(chatId)).length > 0);
    const [membersLoading, setMembersLoading] = useState(false);
    const [viewingMemberId, setViewingMemberId] = useState<string | null>(null);
    const [showMembersList, setShowMembersList] = useState(false);
    const [openGroupEditorFromMembers, setOpenGroupEditorFromMembers] = useState(false);
    const [externalFileUploadHandler, setExternalFileUploadHandler] = useState<((file: File) => void) | null>(null);
    const [dragUploadActive, setDragUploadActive] = useState(false);
    const [chatContentReady, setChatContentReady] = useState(true);
    const isAtBottomRef = useRef(getChatScrollMemory(chatId)?.atBottom ?? true);

    const prevLenRef = useRef(0);
    const prevFirstMessageIdRef = useRef<string | null>(null);
    const prevLastMessageIdRef = useRef<string | null>(null);
    const pendingOlderAdjustRef = useRef<{ prevHeight: number; prevTop: number } | null>(null);
    const pendingRangeLoadTypeRef = useRef<'older' | 'newer' | null>(null);
    const openedAtRef = useRef<number>(Date.now());
    const initialScrollDoneRef = useRef(false);
    const initialMediaPendingIdsRef = useRef<Set<string>>(new Set());
    const initialMediaFollowupDoneRef = useRef(false);
    const initialMediaReadyTimeoutRef = useRef<number | null>(null);
    const restoringFromInfoRef = useRef(false);
    const restoreTopAfterInfoRef = useRef<number | null>(null);
    const restoreBottomAfterInfoRef = useRef(false);
    const lastScrollTopRef = useRef(0);
    const userReadingOlderRef = useRef(false);
    const scrollRafRef = useRef<number | null>(null);

    
    
    const forceInfoRouteActiveRef = useRef(false);

    useEffect(() => {
        if (forceContactInfoOpen && !isOfficialChannel) {
            forceInfoRouteActiveRef.current = true;
            restoringFromInfoRef.current = true;
            setOpenGroupEditorFromMembers(false);
            setShowContactInfo(true);
            return;
        }
        if (forceInfoRouteActiveRef.current) {
            forceInfoRouteActiveRef.current = false;
            setShowContactInfo(false);
            setShowMembersList(false);
            setViewingMemberId(null);
            setOpenGroupEditorFromMembers(false);
        }
    }, [forceContactInfoOpen, chatId, isOfficialChannel]);

    const userHasScrolledRef = useRef(Boolean(getChatScrollMemory(chatId)?.userInteracted));
    const smoothBottomUntilRef = useRef(0);

    useEffect(() => {
        return () => {
            if (idleDateTimerRef.current) {
                window.clearTimeout(idleDateTimerRef.current);
            }
        };
    }, []);

    
    const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(initialFirstUnreadId);
    const lockedUnreadAnchorRef = useRef<string | null>(initialFirstUnreadId);
    const visibleIncomingRef = useRef<Set<string>>(new Set());
    const readFlushTimerRef = useRef<number | null>(null);
    const lastSentReadIdRef = useRef<Record<string, string>>({});
    const latestMessagesRef = useRef<Message[]>(messages);
    latestMessagesRef.current = messages;
    const onMarkReadRef = useRef(onMarkRead);
    onMarkReadRef.current = onMarkRead;
    const visibleMessageIdsRef = useRef<Set<string>>(new Set());
    const ackedIdsRef = useRef<Set<string>>(new Set());
    const ackTimerRef = useRef<number | null>(null);
    const mentionIdsRef = useRef<string[]>([]);
    const reactionIdsRef = useRef<string[]>([]);
    const lastAtBottomRef = useRef(true);
    const onReaderStateChangeRef = useRef(onReaderStateChange);
    onReaderStateChangeRef.current = onReaderStateChange;

    
    const [displayUnreadCount, setDisplayUnreadCount] = useState<number>(initialUnreadCount);
    const [openedImage, setOpenedImage] = useState<{ url: string; file: FileMetadata | null } | null>(null);
    const [openedVideo, setOpenedVideo] = useState<{ url: string; file: FileMetadata | null } | null>(null);
    const navigate = useNavigate();
    const location = useLocation();

    const openImageViewer = (imageUrl: string, file: FileMetadata | null) => {
        const params = new URLSearchParams(location.search);
        params.set('media', 'image');
        navigate({ pathname: location.pathname, search: `?${params.toString()}` });
        setOpenedVideo(null);
        setOpenedImage({ url: imageUrl, file });
    };

    const openVideoViewer = (videoUrl: string, file: FileMetadata | null) => {
        const params = new URLSearchParams(location.search);
        params.set('media', 'video');
        navigate({ pathname: location.pathname, search: `?${params.toString()}` });
        setOpenedImage(null);
        setOpenedVideo({ url: videoUrl, file });
    };

    const closeMediaViewer = () => {
        setOpenedImage(null);
        setOpenedVideo(null);
        const params = new URLSearchParams(location.search);
        if (params.has('media')) {
            navigate(-1);
            return;
        }
        params.delete('media');
        const nextSearch = params.toString();
        navigate({ pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
    };

    useEffect(() => {
        const mediaType = new URLSearchParams(location.search).get('media');
        if (mediaType === 'image' || mediaType === 'video') return;
        if (openedImage || openedVideo) {
            setOpenedImage(null);
            setOpenedVideo(null);
        }
    }, [location.search, openedImage, openedVideo]);
    
    const autoJumpedToUnreadRef = useRef(false);
    const userScrolledAfterAutoJumpRef = useRef(false);
    const programmaticScrollUntilRef = useRef(0);
    const rangeMediaPendingIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!isContactBlocked) return;
        pendingUploadedFileByChat[chatId] = null;
        setReplyTo(null);
        setEditingId(null);
    }, [isContactBlocked, chatId]);

    const markProgrammaticScroll = () => {
        programmaticScrollUntilRef.current = performance.now() + 90;
    };

    const collectMediaIds = (msgs: Message[]) => new Set(
        msgs
            .filter((m) => {
                const mt = (m.file?.mimeType || '').toLowerCase();
                if (!m.file || (!mt.startsWith('image/') && !mt.startsWith('video/'))) return false;
                if (m.senderId === currentUserId) return false;
                const hasPreview = Boolean(
                    (m.file as any).previewUrl
                    || (m.file as any).thumbUrl
                    || (m.file as any).imagePreviewUrl
                );
                return hasPreview;
            })
            .map((m) => m.id)
    );

    const collectInitialMediaPendingIds = () => collectMediaIds(messages.slice(-12));

    const handleInitialMediaReady = (messageId: string) => {
        if (rangeMediaPendingIdsRef.current.has(messageId)) {
            rangeMediaPendingIdsRef.current.delete(messageId);
            if (rangeMediaPendingIdsRef.current.size === 0) {
                setLocalLoadingOlder(false);
                setLocalLoadingNewer(false);
            }
        }

        if (restoringFromInfoRef.current && restoreTopAfterInfoRef.current !== null) {
            if (shouldPreserveExactScroll()) {
                restoreScroll(chatId);
            }
            return;
        }
        if (restoringFromInfoRef.current && restoreBottomAfterInfoRef.current) {
            scrollToBottom(false);
            restoreBottomAfterInfoRef.current = false;
            restoringFromInfoRef.current = false;
            return;
        }

        if (userHasScrolledRef.current || userReadingOlderRef.current || shouldPreserveExactScroll()) {
            initialMediaPendingIdsRef.current.delete(messageId);
            if (initialMediaPendingIdsRef.current.size === 0) {
                initialMediaFollowupDoneRef.current = true;
            }
            return;
        }

        if (isAtBottomRef.current && !autoJumpedToUnreadRef.current) {
            requestAnimationFrame(() => {
                if (!userHasScrolledRef.current && !userReadingOlderRef.current && isAtBottomRef.current) {
                    scrollToBottom(false);
                }
            });
        }

        if (initialMediaFollowupDoneRef.current) return;
        if (!initialMediaPendingIdsRef.current.has(messageId)) return;
        initialMediaPendingIdsRef.current.delete(messageId);
        if (initialMediaPendingIdsRef.current.size === 0) {
            initialMediaFollowupDoneRef.current = true;
            if (initialMediaReadyTimeoutRef.current != null) {
                window.clearTimeout(initialMediaReadyTimeoutRef.current);
                initialMediaReadyTimeoutRef.current = null;
            }
            setChatContentReady(true);
            requestAnimationFrame(() => {
                if (userHasScrolledRef.current || userReadingOlderRef.current || shouldPreserveExactScroll()) return;
                const anchor = resolveUnreadAnchor();
                if (anchor) {
                    scrollToUnreadAnchor(anchor);
                    return;
                }
                if (isAtBottomRef.current) {
                    scrollToBottom(false);
                }
            });
        }
    };

    const notifyReaderState = (atBottom: boolean) => {
        if (lastAtBottomRef.current === atBottom) return;
        lastAtBottomRef.current = atBottom;
        onReaderStateChangeRef.current?.({ atBottom });
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

    const pinToBottomSync = () => {
        const container = messagesContainerRef.current;
        if (!container) {
            scrollToBottom(false);
            return;
        }
        markProgrammaticScroll();
        container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        isAtBottomRef.current = true;
        notifyReaderState(true);
    };

    const computeNearBottom = () => {
        const container = messagesContainerRef.current;
        if (!container) return true;
        return container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    };

    useLayoutEffect(() => {
        if (!initialScrollDoneRef.current) return;
        if (!isAtBottomRef.current) return;
        if (unreadAnchorId) return;
        if (autoJumpedToUnreadRef.current && !userScrolledAfterAutoJumpRef.current) return;
        if (performance.now() < smoothBottomUntilRef.current) return;
        pinToBottomSync();
    }, [composerHeight]);

    const captureScrollAnchor = (container: HTMLDivElement): { anchorMessageId: string | null; anchorOffset: number } => {
        const containerRect = container.getBoundingClientRect();
        const stickyTop = pinnedMessage ? 122 : 68;
        const targetLine = containerRect.top + stickyTop;
        const messageNodes = container.querySelectorAll<HTMLElement>('[data-message-id]');
        let chosenEl: HTMLElement | null = null;

        for (let i = 0; i < messageNodes.length; i += 1) {
            const el = messageNodes[i];
            const rect = el.getBoundingClientRect();
            if (rect.bottom > targetLine) {
                chosenEl = el;
                break;
            }
        }

        if (!chosenEl && messageNodes.length > 0) {
            chosenEl = messageNodes[messageNodes.length - 1];
        }

        const anchorMessageId = chosenEl?.dataset.messageId || null;
        const anchorOffset = chosenEl ? chosenEl.getBoundingClientRect().top - containerRect.top : 0;
        return { anchorMessageId, anchorOffset };
    };

    const saveScroll = (id: string) => {
        const container = messagesContainerRef.current;
        if (!container || !id || id === 'pending') return;
        const nearBottom = computeNearBottom();
        const { anchorMessageId, anchorOffset } = captureScrollAnchor(container);
        setChatScrollMemory(id, {
            top: container.scrollTop,
            atBottom: nearBottom,
            userInteracted: Boolean(userHasScrolledRef.current) || !nearBottom,
            anchorMessageId,
            anchorOffset,
        });
    };

    const maybeSaveScroll = (id: string) => {
        if (autoJumpedToUnreadRef.current && !userScrolledAfterAutoJumpRef.current) return;
        saveScroll(id);
    };

    const restoreScroll = (id: string): boolean => {
        const container = messagesContainerRef.current;
        const mem = getChatScrollMemory(id);
        if (!container || !mem) return false;
        isAtBottomRef.current = Boolean(mem.atBottom);
        if (mem.atBottom) {
            pinToBottomSync();
            return true;
        }
        userHasScrolledRef.current = true;
        userReadingOlderRef.current = true;
        markProgrammaticScroll();
        if (mem.anchorMessageId) {
            const anchorEl = messageElsRef.current.get(mem.anchorMessageId)
                || container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(mem.anchorMessageId)}"]`);
            if (anchorEl) {
                const containerRect = container.getBoundingClientRect();
                const anchorRect = anchorEl.getBoundingClientRect();
                const delta = (anchorRect.top - containerRect.top) - mem.anchorOffset;
                container.scrollTop = Math.max(0, container.scrollTop + delta);
                lastScrollTopRef.current = container.scrollTop;
                setMessagesScrolled(isElementScrolled(container));
                const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                setShowScrollBtn(distanceToBottom > 180);
                notifyReaderState(false);
                return true;
            }
        }
        container.scrollTop = Math.max(0, mem.top);
        lastScrollTopRef.current = container.scrollTop;
        setMessagesScrolled(isElementScrolled(container));
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        setShowScrollBtn(distanceToBottom > 180);
        notifyReaderState(false);
        return true;
    };

    const scrollToUnreadAnchor = (messageId: string) => {
        const doScroll = () => {
            const container = messagesContainerRef.current;
            if (!container) return false;
            const separator = unreadSeparatorRef.current;
            const msgEl = messageElsRef.current.get(messageId);
            const targetEl = separator || msgEl;
            if (!targetEl) return false;
            const cr = container.getBoundingClientRect();
            const tr = targetEl.getBoundingClientRect();
            if (cr.height === 0) return false;
            const delta = tr.top - cr.top;
            markProgrammaticScroll();
            container.scrollTop = Math.max(0, container.scrollTop + delta - 12);
            isAtBottomRef.current = computeNearBottom();
            notifyReaderState(isAtBottomRef.current);
            return true;
        };

        if (!doScroll()) {
            requestAnimationFrame(() => {
                if (!doScroll()) {
                    window.setTimeout(doScroll, 60);
                }
            });
        }
    };

    const messagesById = useMemo(() => new Map(messages.map((msg) => [msg.id, msg])), [messages]);

    const isUnreadAnchorValid = (messageId: string | null): boolean => {
        if (!messageId) return false;
        const message = messagesById.get(messageId);
        if (!message) return false;
        if (message.senderId === currentUserId) return false;
        return true;
    };

    const resolveUnreadAnchor = (): string | null => {
        if (isUnreadAnchorValid(unreadAnchorId)) return unreadAnchorId;
        if (isUnreadAnchorValid(lockedUnreadAnchorRef.current)) return lockedUnreadAnchorRef.current;
        if (displayUnreadCount <= 0) return null;
        const fallback = messages.find((m) => m.senderId !== currentUserId && !m.seen)?.id || null;
        if (fallback) {
            lockedUnreadAnchorRef.current = fallback;
        }
        return fallback;
    };

    const applyInitialScroll = () => {
        const mem = getChatScrollMemory(chatId);

        if (mem && mem.userInteracted && !mem.atBottom) {
            restoreScroll(chatId);
            return;
        }

        const unreadAnchor = resolveUnreadAnchor();
        if (unreadAnchor) {
            lockedUnreadAnchorRef.current = unreadAnchor;
            if (unreadAnchorId !== unreadAnchor) {
                setUnreadAnchorId(unreadAnchor);
            }
            autoJumpedToUnreadRef.current = true;
            userScrolledAfterAutoJumpRef.current = false;
            scrollToUnreadAnchor(unreadAnchor);
            return;
        }

        if (mem && mem.atBottom) {
            restoreScroll(chatId);
            return;
        }

        pinToBottomSync();
    };

    const shouldPreserveExactScroll = () => {
        const mem = getChatScrollMemory(chatId);
        return Boolean(mem && mem.userInteracted && !mem.atBottom);
    };

    const settleToBottomIfNeeded = () => {
        const c = messagesContainerRef.current;
        if (!c) return;
        if (userHasScrolledRef.current) return;
        if (shouldPreserveExactScroll()) return;
        
        if (unreadAnchorId || autoJumpedToUnreadRef.current || displayUnreadCount > 0) return;

        pinToBottomSync();
    };

    const getReplySenderName = (reply: MessageReplyType | null | undefined) => {
        if (!reply) return 'کاربر';
        const repliedMessage = messagesById.get(reply.id);
        const senderId = String(repliedMessage?.senderId || reply.senderId || '').trim();

        if (!senderId) return 'کاربر';
        if (senderId === currentUserId) return 'شما';
        if (senderId === contact.chatId) return contact.name || contact.username || 'کاربر';

        const memberName = groupMembers[senderId]?.name;
        if (memberName) return memberName;

        return senderId;
    };

    const filePreviewLabel = (mimeType?: string) => {
        const fileMime = (mimeType || '').toLowerCase();
        if (fileMime.startsWith('image/')) return '🖼️ تصویر';
        if (fileMime.startsWith('video/')) return '🎥 ویدیو';
        if (fileMime.startsWith('audio/')) return '🎵 آهنگ';
        return '📎 فایل';
    };

    const getReplyPreviewText = (reply: MessageReplyType | null | undefined) => {
        if (!reply) return '';
        const repliedMessage = messagesById.get(reply.id);
        const fallbackText = (reply.text || '').trim();
        if (reply.isQuote && fallbackText) return fallbackText;
        if (repliedMessage?.chessInvite) {
            return repliedMessage.chessInvite.shared ? '♟️ بازی شطرنج' : '♟️ دعوت به بازی شطرنج';
        }
        if (!repliedMessage?.file) return fallbackText;
        const prefix = filePreviewLabel(repliedMessage.file.mimeType);
        return fallbackText ? `${prefix} • ${fallbackText}` : prefix;
    };

    const getForwardPreviewText = (draft: { previewText?: string; previewFile?: FileMetadata | null } | null | undefined) => {
        if (!draft) return '';
        const fallbackText = (draft.previewText || '').trim();
        if (!draft.previewFile) return fallbackText || 'پیام';
        const prefix = filePreviewLabel(draft.previewFile.mimeType);
        return fallbackText ? `${prefix} • ${fallbackText}` : prefix;
    };

    const forwardPreviewTitle = pendingForwardDraft && (pendingForwardDraft.messageIds?.length || 0) > 1
        ? `فوروارد ${toPersianDigits(pendingForwardDraft.messageIds!.length)} پیام از «${pendingForwardDraft.sourceChatName || 'چت'}»`
        : 'در حال فوروارد پیام';

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
        if (sourceId === 'official-channel') {
            maybeSaveScroll(chatId);
            onSelectChat?.('official-channel');
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
            setChatStats((prev) => (prev === null ? prev : null));
            return;
        }
        let cancelled = false;
        const cachedStats = readCachedChatStats(chatId);
        setChatStats((prev) => {
            if (!cachedStats) return null;
            if (prev && prev.totalMembers === cachedStats.totalMembers && prev.onlineMembers === cachedStats.onlineMembers && Boolean(prev.membershipClosed) === Boolean(cachedStats.membershipClosed)) {
                return prev;
            }
            return cachedStats;
        });
        const loadStats = async () => {
            try {
                const stats = await apiFetch(`/chats/${encodeURIComponent(chatId)}/stats`);
                if (!cancelled) {
                    const totalMembers = Number(stats?.totalMembers || 0);
                    const rawOnlineMembers = Number(stats?.onlineMembers || 0);
                    const onlineMembers = isOfficialChannel ? rawOnlineMembers : Math.max(1, rawOnlineMembers);
                    const membershipClosed = Boolean(stats?.membershipClosed);
                    const nextStats = { totalMembers, onlineMembers, membershipClosed };
                    writeCachedChatStats(chatId, nextStats);
                    setChatStats((prev) => (
                        prev && prev.totalMembers === totalMembers && prev.onlineMembers === onlineMembers && Boolean(prev.membershipClosed) === membershipClosed
                            ? prev
                            : nextStats
                    ));
                }
            } catch {
                if (!cancelled) setChatStats((prev) => prev);
            }
        };
        loadStats();
        const timer = window.setInterval(loadStats, 15000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [chatId, isGroupChat]);

    useEffect(() => {
        if (!isGroupChat) {
            setGroupMembers((prev) => (Object.keys(prev).length === 0 ? prev : {}));
            setMembersLoading((prev) => (prev ? false : prev));
            setMembersResolved(true);
            return;
        }
        const cached = readCachedGroupMembers(chatId);
        if (Object.keys(cached).length > 0) {
            groupMembersSnapshotRef.current = cached;
            setGroupMembers((prev) => (membersEqual(prev, cached) ? prev : cached));
            setMembersResolved(true);
        } else {
            setMembersResolved(false);
        }
        let cancelled = false;
        let initialLoad = true;
        const loadMembers = async () => {
            if (initialLoad) setMembersLoading(true);
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
                            online: id === currentUserId ? true : Boolean(m.online),
                            lastSeen: m.lastSeen ?? null,
                            lastSeenCategory: m.lastSeenCategory ?? null,
                            isMember: m.isMember !== false,
                            isBanned: Boolean(m.isBanned),
                        };
                    });
                    if (!membersEqual(groupMembersSnapshotRef.current ?? {}, map)) {
                        writeCachedGroupMembers(chatId, map);
                    }
                    groupMembersSnapshotRef.current = map;
                    setGroupMembers((prev) => (membersEqual(prev, map) ? prev : map));
                }
            } catch { }
            finally {
                initialLoad = false;
                if (!cancelled) {
                    setMembersLoading((prev) => (prev ? false : prev));
                    setMembersResolved(true);
                }
            }
        };
        loadMembers();

        const timer = window.setInterval(loadMembers, 15000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [chatId, isGroupChat]);


    const isSavedMessages = contact.chatId === 'saved';
    const canDeleteChat = chatId !== 'pending' && !isSavedMessages;
    const [token] = useState(() => localStorage.getItem('token') || '');

    useLayoutEffect(() => {
        const host = composerHostRef.current;
        const el = host?.firstElementChild;
        if (!(el instanceof HTMLElement)) return;
        const update = () => setComposerHeight(el.offsetHeight);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, [chatId, editingId, showContactInfo, forwardSourceUser, viewingMemberId, showMembersList]);


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
        
    }, [chatId]);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        let lastPadding = parseFloat(getComputedStyle(container).paddingTop) || 0;
        const observer = new MutationObserver(() => {
            const nextPadding = parseFloat(getComputedStyle(container).paddingTop) || 0;
            if (nextPadding === lastPadding) return;
            const delta = nextPadding - lastPadding;
            lastPadding = nextPadding;
            if (!delta) return;
            const wasAtBottom = computeNearBottom();
            markProgrammaticScroll();
            container.scrollTop = wasAtBottom
                ? Math.max(0, container.scrollHeight - container.clientHeight)
                : Math.max(0, container.scrollTop + delta);
            isAtBottomRef.current = computeNearBottom();
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-music-player'] });
        return () => observer.disconnect();
    }, [showContactInfo, forwardSourceUser, viewingMemberId, showMembersList]);


    const findQuoteDomRange = (messageEl: HTMLElement, quoteText?: string): Range | null => {
        const needle = (quoteText || '').trim();
        if (!needle) return null;
        const textRoot = messageEl.querySelector<HTMLElement>('.message-text');
        if (!textRoot) return null;
        const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
        const segments: { node: Text; start: number; end: number }[] = [];
        let full = '';
        let current = walker.nextNode();
        while (current) {
            const textNode = current as Text;
            const val = textNode.nodeValue || '';
            if (val.length > 0) {
                segments.push({ node: textNode, start: full.length, end: full.length + val.length });
                full += val;
            }
            current = walker.nextNode();
        }
        let matchIndex = full.indexOf(needle);
        let matchLength = needle.length;
        if (matchIndex === -1) {
            const pattern = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
            const m = new RegExp(pattern).exec(full);
            if (m) {
                matchIndex = m.index;
                matchLength = m[0].length;
            }
        }
        if (matchIndex === -1) return null;
        const matchEnd = matchIndex + matchLength;
        const startSeg = segments.find((s) => matchIndex >= s.start && matchIndex < s.end);
        const endSeg = segments.find((s) => matchEnd > s.start && matchEnd <= s.end);
        if (!startSeg || !endSeg) return null;
        const range = document.createRange();
        range.setStart(startSeg.node, matchIndex - startSeg.start);
        range.setEnd(endSeg.node, matchEnd - endSeg.start);
        return range;
    };

    const startQuoteRangeHighlight = (range: Range | null, isMine: boolean) => {
        if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
        const rootEl = document.documentElement;
        CSS.highlights.delete('nova-quote-jump');
        CSS.highlights.delete('nova-quote-jump-mine');
        rootEl.classList.remove('quote-jump-animating');
        if (quoteHighlightTimeoutRef.current) window.clearTimeout(quoteHighlightTimeoutRef.current);
        if (!range) return;
        void rootEl.offsetWidth;
        CSS.highlights.set(isMine ? 'nova-quote-jump-mine' : 'nova-quote-jump', new Highlight(range));
        rootEl.classList.add('quote-jump-animating');
        quoteHighlightTimeoutRef.current = window.setTimeout(() => {
            CSS.highlights.delete('nova-quote-jump');
            CSS.highlights.delete('nova-quote-jump-mine');
            rootEl.classList.remove('quote-jump-animating');
        }, 2000);
    };

    const startHighlight = (messageId: string) => {
        setHighlightId(messageId);
        if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = window.setTimeout(() => setHighlightId(null), 2000);
    };

    const scrollToMessage = (messageId: string, retry = 1, quoteText?: string) => {
        const el = messageElsRef.current.get(messageId);
        const container = messagesContainerRef.current;
        if (!el || !container) {
            const lastAttempt = missingJumpAttemptRef.current;
            if (!messagesById.has(messageId) && (!lastAttempt || lastAttempt.id !== messageId || performance.now() - lastAttempt.at > 2000)) {
                missingJumpAttemptRef.current = { id: messageId, at: performance.now() };
                if (quoteText) pendingJumpQuoteRef.current = { messageId, quoteText };
                void onJumpToMessage?.(chatId, messageId);
            }
            return;
        }
        if (highlightRafRef.current) cancelAnimationFrame(highlightRafRef.current);
        const topBarOffset = pinnedMessage ? 122 : 68;
        const cr = container.getBoundingClientRect();
        const quoteRange = findQuoteDomRange(el, quoteText);
        const quoteRect = quoteRange?.getBoundingClientRect();
        const hasQuoteRect = Boolean(quoteRect && (quoteRect.width > 0 || quoteRect.height > 0));
        const isMine = messagesById.get(messageId)?.senderId === currentUserId
            || Boolean(el.querySelector('.message-bubble--mine'));
        const tr = hasQuoteRect ? quoteRect! : el.getBoundingClientRect();
        const isFullyVisible = tr.top >= cr.top + topBarOffset && tr.bottom <= cr.bottom - 70;
        if (isFullyVisible) {
            startHighlight(messageId);
            if (quoteRange) startQuoteRangeHighlight(quoteRange, isMine);
            return;
        }

        markProgrammaticScroll();
        if (hasQuoteRect) {
            const targetTop = container.scrollTop + (tr.top - cr.top) - (cr.height / 2) + (tr.height / 2);
            container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        } else {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        let lastTop = container.scrollTop;
        let sameCount = 0;
        const startedAt = performance.now();
        const check = () => {
            const cont = messagesContainerRef.current;
            const target = messageElsRef.current.get(messageId);
            if (!cont || !target) return;
            const now = performance.now();
            if (cont.scrollTop === lastTop) {
                sameCount += 1;
            } else {
                sameCount = 0;
                lastTop = cont.scrollTop;
            }
            if (sameCount >= 4 || now - startedAt > 650) {
                const targetRect = hasQuoteRect ? quoteRange!.getBoundingClientRect() : target.getBoundingClientRect();
                const contRect = cont.getBoundingClientRect();
                const inView = targetRect.top >= contRect.top + topBarOffset - 20 && targetRect.bottom <= contRect.bottom - 50;
                if (!inView && retry > 0) {
                    scrollToMessage(messageId, retry - 1, quoteText);
                    return;
                }
                startHighlight(messageId);
                if (quoteRange) startQuoteRangeHighlight(quoteRange, isMine);
                highlightRafRef.current = null;
                return;
            }
            highlightRafRef.current = requestAnimationFrame(check);
        };
        highlightRafRef.current = requestAnimationFrame(check);
    };

    useEffect(() => {
        if (!targetScrollMessage?.messageId) return;
        if (targetScrollMessage.chatId !== chatId) return;
        const pendingQuote = pendingJumpQuoteRef.current?.messageId === targetScrollMessage.messageId
            ? pendingJumpQuoteRef.current.quoteText
            : undefined;
        pendingJumpQuoteRef.current = null;
        const timer = window.setTimeout(() => {
            scrollToMessage(targetScrollMessage.messageId, 1, pendingQuote);
            onJumpToMessageSettled?.();
        }, 120);
        return () => window.clearTimeout(timer);
    }, [targetScrollMessage?.messageId, targetScrollMessage?.timestamp, chatId]);

    useEffect(() => () => onJumpToMessageSettled?.(), []);

    const cancelMentionResolve = useCallback(() => {
        mentionRequestIdRef.current += 1;
        mentionAbortRef.current?.abort();
        mentionAbortRef.current = null;
        setResolvingMention(false);
    }, []);

    useEffect(() => () => {
        cancelMentionResolve();
        Object.values(shakeTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    }, [chatId, cancelMentionResolve]);

    const shakeMessageBubble = useCallback((messageId: string) => {
        const el = messageElsRef.current.get(messageId);
        if (el) {
            if (shakeTimersRef.current[messageId]) {
                window.clearTimeout(shakeTimersRef.current[messageId]);
            }
            el.classList.remove('message-bubble--shake');
            void el.offsetWidth;
            el.classList.add('message-bubble--shake');
            shakeTimersRef.current[messageId] = window.setTimeout(() => {
                el.classList.remove('message-bubble--shake');
                delete shakeTimersRef.current[messageId];
            }, 420);
        }
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([18, 40, 18]);
            } else {
                triggerHaptic();
            }
        } catch {
            triggerHaptic();
        }
    }, []);

    const openMention = useCallback(async (rawUsername: string, messageId: string) => {
        const cleanUsername = String(rawUsername || '').trim().replace(/^@+/, '');
        if (!cleanUsername) return;

        const selfUsername = String(currentUser?.username || '').trim();
        if (
            onOpenSavedMessages
            && selfUsername
            && selfUsername.toLowerCase() === cleanUsername.toLowerCase()
        ) {
            onOpenSavedMessages();
            return;
        }

        mentionAbortRef.current?.abort();
        const controller = new AbortController();
        mentionAbortRef.current = controller;
        const requestId = ++mentionRequestIdRef.current;
        setResolvingMention(true);

        try {
            if (!/^[A-Za-z0-9_]{3,32}$/.test(cleanUsername)) {
                await new Promise((resolve) => window.setTimeout(resolve, 180));
                if (requestId !== mentionRequestIdRef.current) return;
                setResolvingMention(false);
                shakeMessageBubble(messageId);
                return;
            }

            const resolvedUser = await apiFetch(
                `/users/by-username/${encodeURIComponent(cleanUsername)}`,
                { signal: controller.signal }
            );
            if (requestId !== mentionRequestIdRef.current) return;
            setResolvingMention(false);

            if (resolvedUser && resolvedUser.chatId) {
                if (onOpenSavedMessages && String(resolvedUser.chatId) === currentUserId) {
                    onOpenSavedMessages();
                    return;
                }
                maybeSaveScroll(chatId);
                restoringFromInfoRef.current = true;
                setForwardSourceUser({
                    chatId: String(resolvedUser.chatId),
                    username: String(resolvedUser.username || cleanUsername),
                    name: String(resolvedUser.name || resolvedUser.username || cleanUsername),
                    bio: String(resolvedUser.bio || ''),
                    avatar: String(resolvedUser.avatar || ''),
                    online: Boolean(resolvedUser.online),
                    lastSeen: resolvedUser.lastSeen,
                    lastSeenCategory: resolvedUser.lastSeenCategory,
                    verified: Boolean(resolvedUser.verified),
                    registrationDate: resolvedUser.registrationDate,
                    ...(typeof resolvedUser.blockedByMe !== 'undefined' ? { blockedByMe: Boolean(resolvedUser.blockedByMe) } : {}),
                    ...(typeof resolvedUser.blockedByOther !== 'undefined' ? { blockedByOther: Boolean(resolvedUser.blockedByOther) } : {}),
                } as User);
            } else {
                shakeMessageBubble(messageId);
            }
        } catch (err: any) {
            if (err?.name === 'AbortError' || requestId !== mentionRequestIdRef.current) return;
            setResolvingMention(false);
            shakeMessageBubble(messageId);
        } finally {
            if (mentionAbortRef.current === controller) {
                mentionAbortRef.current = null;
            }
        }
    }, [chatId, currentUser?.username, currentUserId, onOpenSavedMessages, shakeMessageBubble]);

    const triggerInvalidLinkFeedback = useCallback((messageId?: string) => {
        if (messageId) shakeMessageBubble(messageId);
    }, [shakeMessageBubble]);

    const openGroupInvite = useCallback(async (inviteCode: string, messageId?: string) => {
        const code = String(inviteCode || '').trim();
        if (!code || resolvingMention) return;
        setResolvingMention(true);
        setInvitePreviewError('');
        try {
            const preview = await apiFetch(`/groups/preview/${encodeURIComponent(code)}`);
            if (!preview?.chatId) {
                triggerInvalidLinkFeedback(messageId);
                return;
            }
            if (preview.alreadyMember && onJoinGroupByCode) {
                await onJoinGroupByCode(preview.inviteCode || code);
                return;
            }
            setInvitePreviewGroup(preview as GroupPreview);
        } catch {
            triggerInvalidLinkFeedback(messageId);
        } finally {
            setResolvingMention(false);
        }
    }, [resolvingMention, triggerInvalidLinkFeedback]);

    const handleConfirmJoinFromChat = async (group: GroupPreview) => {
        const code = group.inviteCode || '';
        if (!code || !onJoinGroupByCode) return;
        setJoiningPreviewGroup(true);
        setInvitePreviewError('');
        try {
            await onJoinGroupByCode(code);
            setInvitePreviewGroup(null);
        } catch (error) {
            setInvitePreviewError(error instanceof Error ? error.message : 'خطا در عضویت در گروه');
        } finally {
            setJoiningPreviewGroup(false);
        }
    };

    const handleBanMember = useCallback(async (targetChatId: string) => {
        if (!chatId || !targetChatId) return;
        try {
            await apiFetch(`/groups/${encodeURIComponent(chatId)}/ban/${encodeURIComponent(targetChatId)}`, {
                method: 'POST',
            });
        } catch {
            return;
        }
        setGroupMembers((prev) => {
            const existing = prev[targetChatId];
            if (!existing) return prev;
            return {
                ...prev,
                [targetChatId]: {
                    ...existing,
                    isMember: false,
                    isBanned: true,
                },
            };
        });
        setChatStats((prev) => (
            prev ? { ...prev, totalMembers: Math.max(1, prev.totalMembers - 1) } : prev
        ));
    }, [chatId]);

    const doDownloadMessageFile = async (m: Message) => {
        if (!m.file?.fileId) return;
        setMsgMenu(null);
        
        const mt = (m.file.mimeType || '').toLowerCase();
        const isImage = mt.startsWith('image/');
        const isVideo = mt.startsWith('video/');
        const isAudio = mt.startsWith('audio/');
        
        if (!isImage && !isVideo && !isAudio) {
            window.dispatchEvent(new CustomEvent('trigger-file-download', { detail: { fileId: m.file.fileId } }));
            return;
        }

        try {
            const blob = await getOrCacheBlob({
                cacheKey: `chat:${chatId}:file:${m.file.fileId}`,
                loadBlob: async () => {
                    const response = await fetch(`${API_BASE_URL}/files/${encodeURIComponent(m.file!.fileId)}`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (!response.ok) throw new Error('Download failed');
                    const downloadedBytes = new Uint8Array(await response.arrayBuffer());
                    const plainBytes = isAudio ? downloadedBytes : await decryptFileBytesClientSide(downloadedBytes, token, chatId, m.file?.encryptedFileKey);
                    return new Blob([plainBytes as BlobPart], { type: m.file?.mimeType || 'application/octet-stream' });
                },
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = m.file.fileName || 'file';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        } catch {
            alert('خطا در دانلود فایل');
        }
    };

    const doCopyMessage = async (m: Message) => {
        await copyText(m.text ?? '').catch(() => { });
        setMsgMenu(null);
    };

    
    const handleReact = async (messageId: string, emoji: string) => {
        setReactionMenu(null); setMsgMenu(null);
        
        const msg = messagesById.get(messageId);
        const currentReactions = optimisticReactions[messageId] ?? (msg?.reactions as ReactionEntry[] | undefined);
        
        const alreadyReacted = (currentReactions || []).some(
            (r) => r.emoji === emoji && r.userIds.includes(currentUserId)
        );
        
        setOptimisticReactions((prev) => ({
            ...prev,
            [messageId]: applyOptimisticReactions(currentReactions, currentUserId, emoji),
        }));
        
        if (!alreadyReacted) triggerHaptic();
        try {
            if (onReactMessage) {
                await onReactMessage(chatId, messageId, emoji);
            } else {
                await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'POST', body: JSON.stringify({ emoji }) });
            }
        } catch (e) {
            console.error('Failed to react:', e);
            
            setOptimisticReactions((prev) => {
                const next = { ...prev };
                delete next[messageId];
                return next;
            });
        }
    };

    const handleDeleteReaction = async (messageId: string) => {
        setReactionMenu(null); setMsgMenu(null);
        const msg = messagesById.get(messageId);
        const currentReactions = optimisticReactions[messageId] ?? (msg?.reactions as ReactionEntry[] | undefined);
        
        setOptimisticReactions((prev) => ({
            ...prev,
            [messageId]: applyOptimisticReactions(currentReactions, currentUserId),
        }));
        try {
            if (onUnreactMessage) {
                await onUnreactMessage(chatId, messageId);
            } else {
                await apiFetch(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'DELETE' });
            }
        } catch (e) {
            console.error('Failed to delete reaction:', e);
            
            setOptimisticReactions((prev) => {
                const next = { ...prev };
                delete next[messageId];
                return next;
            });
        }
    };
    

    
    useEffect(() => {
        setOptimisticReactions((prev) => {
            if (!Object.keys(prev).length) return prev;
            const next = { ...prev };
            let changed = false;
            Object.keys(prev).forEach((messageId) => {
                const msg = messagesById.get(messageId);
                if (!msg) {
                    delete next[messageId];
                    changed = true;
                    return;
                }
                const serverReactions = (msg.reactions as ReactionEntry[] | undefined) ?? [];
                const optimistic = prev[messageId] ?? [];
                if (reactionsEqual(serverReactions, optimistic)) {
                    delete next[messageId];
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [messages]);

    const forwardBatch = useCallback((sourceChatId: string, messageIds: string[], targetChatId: string) => {
        if (onForwardMessage) return onForwardMessage(sourceChatId, messageIds, targetChatId);
        return apiFetch('/messages/forward', {
            method: 'POST',
            body: JSON.stringify({
                sourceChatId,
                targetChatId,
                items: messageIds.map((messageId) => ({ messageId })),
            }),
        });
    }, [onForwardMessage]);

    const handleForwardDraft = useCallback(async () => {
        const draft = pendingForwardDraft;
        if (!draft) return;
        if (forwardingInFlightRef.current) return;
        forwardingInFlightRef.current = true;
        const ids = draft.messageIds?.length ? draft.messageIds : [draft.messageId];
        onClearPendingForwardDraft?.(chatId);
        try {
            await forwardBatch(draft.sourceChatId, ids, chatId);
        } catch {
            onSetPendingForwardDraft?.(chatId, draft);
            alert('فوروارد پیام با خطا مواجه شد');
        } finally {
            forwardingInFlightRef.current = false;
        }
    }, [pendingForwardDraft, chatId, onClearPendingForwardDraft, onSetPendingForwardDraft, forwardBatch]);

    const handleForwardFromModal = async (targetChatId: string) => {
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
            .sort((a, b) => a.timestamp - b.timestamp);
        const messageIds = sortedMsgs.map((m) => m.id);
        if (messageIds.length === 0) return;

        const firstMessage = sortedMsgs[0];
        onSetPendingForwardDraft?.(targetChatId, {
            sourceChatId: chatId,
            messageId: messageIds[0],
            messageIds: messageIds.length > 1 ? messageIds : undefined,
            sourceChatName: currentChat?.otherUser?.name || contact.name || '',
            previewText: firstMessage.text || '',
            previewFile: messageIds.length === 1 ? (firstMessage.file || null) : null,
        });
        onSelectChat?.(targetChatId);
    };

    const isSelectionModeActive = selectedMessageIds.length > 0;

    const customSelection = useCustomTextSelection({
        enabled: selectedMessageIds.length > 0,
        containerRef: roomRef,
    });
    const clearTextSelection = customSelection.clear;

    const toggleMessageSelection = useCallback((messageId: string) => {
        clearTextSelection();
        if (!selectedMessageIds.includes(messageId) && selectedMessageIds.length >= MAX_SELECTED_MESSAGES) {
            triggerHaptic();
            setSelectionShake((value) => value + 1);
            return;
        }
        setSelectedMessageIds((prev: string[]) => (
            prev.includes(messageId)
                ? prev.filter((id: string) => id !== messageId)
                : [...prev, messageId]
        ));
    }, [selectedMessageIds]);

    const handleCopySelected = async () => {
        if (selectedMessageIds.length === 0) return;
        const selectedMsgs = messages
            .filter((m) => selectedMessageIds.includes(m.id))
            .sort((a, b) => a.timestamp - b.timestamp);

        const textLines = selectedMsgs
            .map((m) => {
                const raw = m.text ?? '';
                if (raw.trim()) return raw.trim();
                if (m.file?.fileName) return `[فایل: ${m.file.fileName}]`;
                return '';
            })
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

    const deletableSelectedIds = useMemo(() => {
        return selectedMessageIds.filter((id: string) => {
            const msg = messagesById.get(id);
            if (!msg) return false;
            return msg.senderId === currentUserId || canDeleteOthersMessages;
        });
    }, [selectedMessageIds, messages, currentUserId, canDeleteOthersMessages]);

    const canDeleteAnySelected = selectedMessageIds.length > 0 && deletableSelectedIds.length === selectedMessageIds.length;

    const selectionHistoryPushedRef = useRef(false);
    const ignoreNextPopRef = useRef(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && selectedMessageIds.length > 0) {
                setSelectedMessageIds([]);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedMessageIds.length]);

    useEffect(() => {
        if (isSelectionModeActive && !selectionHistoryPushedRef.current) {
            window.history.pushState(window.history.state, '', window.location.href);
            selectionHistoryPushedRef.current = true;
            return;
        }
        if (!isSelectionModeActive && selectionHistoryPushedRef.current) {
            selectionHistoryPushedRef.current = false;
            ignoreNextPopRef.current = true;
            window.history.back();
        }
    }, [isSelectionModeActive]);

    useEffect(() => {
        const onPopState = () => {
            if (ignoreNextPopRef.current) {
                ignoreNextPopRef.current = false;
                return;
            }
            if (!selectionHistoryPushedRef.current) return;
            selectionHistoryPushedRef.current = false;
            setSelectedMessageIds([]);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    useEffect(() => {
        if (selectedMessageIds.length === 0) clearTextSelection();
    }, [selectedMessageIds]);

    const openForwardModal = (messageId: string) => {
        clearTextSelection();
        setForwardingMessageId(messageId);
        setForwardingMessageIds([]);
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

    const handleRegisterUploadFile = useCallback((handler: ((file: File) => void) | null) => {
        setExternalFileUploadHandler(() => handler);
    }, []);

    const resetUploadPickerIfOpen = () => {
        if (!externalFileUploadHandler) return;
        fileUploadPicker.open = false;
    };

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (menuRef.current?.contains(target)) return;
            if (msgMenuRef.current?.contains(target)) return;
            if (reactionMenuRef.current?.contains(target)) return;
            if (seenByMenuRef.current?.contains(target)) return;
            if (reactionListMenuRef.current?.contains(target)) return;
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
            if (confirmPinRef.current) {
                const modal = confirmPinRef.current.querySelector('.chat-room-confirm-modal');
                if (modal && !modal.contains(target)) { setConfirmPin(null); return; }
            }
            setChatMenuOpen(false);
            setMsgMenu(null);
            setReactionMenu(null);
            setSeenByMenu(null); setReactionListMenu(null);
        };
        document.addEventListener('click', onDocClick);
        return () => document.removeEventListener('click', onDocClick);
    }, []);

    useEffect(() => {
        if (!chatMenuOpen) return;
        const closeMenu = () => setChatMenuOpen(false);
        window.addEventListener('scroll', closeMenu, true);
        window.addEventListener('resize', closeMenu);
        return () => {
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('resize', closeMenu);
        };
    }, [chatMenuOpen]);

    useEffect(() => {
        if (!chatMenuOpen) return;
        const dismiss = (event: MouseEvent) => {
            const target = event.target as Node;
            if (menuRef.current?.contains(target)) return;
            event.preventDefault();
            event.stopPropagation();
            setChatMenuOpen(false);
            setMsgMenu(null);
            setReactionMenu(null);
            setSeenByMenu(null); setReactionListMenu(null);
        };
        document.addEventListener('click', dismiss, true);
        return () => document.removeEventListener('click', dismiss, true);
    }, [chatMenuOpen]);

    useEffect(() => {
        if (!chatMenuOpen) setChatMenuSubmenu(null);
    }, [chatMenuOpen]);

    useEffect(() => {
        return () => {
            if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
            if (arrivedAnimationTimerRef.current) window.clearTimeout(arrivedAnimationTimerRef.current);
            if (highlightRafRef.current) cancelAnimationFrame(highlightRafRef.current);
            if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
        };
    }, []);

    
    useEffect(() => {
        return () => {
            maybeSaveScroll(chatId);
        };
        
    }, [chatId]);

    useEffect(() => {
        const mem = getChatScrollMemory(chatId);
        const preserveExactScroll = Boolean(mem?.userInteracted && !mem?.atBottom);
        if (preserveExactScroll) {
            initialMediaFollowupDoneRef.current = true;
            initialMediaPendingIdsRef.current = new Set();
        } else {
            initialMediaFollowupDoneRef.current = false;
            initialMediaPendingIdsRef.current = collectInitialMediaPendingIds();
            if (initialMediaPendingIdsRef.current.size === 0) {
                initialMediaFollowupDoneRef.current = true;
            }
        }
        setChatContentReady(true);
        prevLenRef.current = messages.length;
        return () => {
            if (initialMediaReadyTimeoutRef.current != null) {
                window.clearTimeout(initialMediaReadyTimeoutRef.current);
                initialMediaReadyTimeoutRef.current = null;
            }
        };
    }, [chatId]);

    
    useEffect(() => {
        lockedUnreadAnchorRef.current = initialFirstUnreadId || null;
        setUnreadAnchorId(initialFirstUnreadId || null);
        setDisplayUnreadCount(initialUnreadCount);
    }, [chatId]);

    useEffect(() => {
        if (initialUnreadCount > 0) {
            setDisplayUnreadCount(initialUnreadCount);
        }
    }, [chatId, initialUnreadCount]);

    useEffect(() => {
        if (!initialFirstUnreadId) return;
        lockedUnreadAnchorRef.current = initialFirstUnreadId;
        setUnreadAnchorId(initialFirstUnreadId);
        if (!initialScrollDoneRef.current || userHasScrolledRef.current) return;
        if (!isUnreadAnchorValid(initialFirstUnreadId)) return;
        autoJumpedToUnreadRef.current = true;
        userScrolledAfterAutoJumpRef.current = false;
        scrollToUnreadAnchor(initialFirstUnreadId);
    }, [chatId, initialFirstUnreadId]);

    
    useLayoutEffect(() => {
        if (loading) return;
        if (!chatContentReady) return;
        if (messages.length === 0) return;
        settleToBottomIfNeeded();
        
    }, [chatId, loading, messages.length, displayUnreadCount, chatContentReady]);

    useEffect(() => {
        if (!chatContentReady || loading || messages.length === 0) return;
        if (userHasScrolledRef.current) return;
        if (displayUnreadCount > 0 || unreadAnchorId || autoJumpedToUnreadRef.current) return;
        if (performance.now() < smoothBottomUntilRef.current) return;
        const raf = requestAnimationFrame(() => {
            const container = messagesContainerRef.current;
            if (!container) return;
            if (performance.now() < smoothBottomUntilRef.current) return;
            const mem = getChatScrollMemory(chatId);
            if (userHasScrolledRef.current || (mem && mem.userInteracted && !mem.atBottom)) return;
            pinToBottomSync();
        });
        return () => cancelAnimationFrame(raf);
    }, [chatId, chatContentReady, loading, messages.length, displayUnreadCount, unreadAnchorId]);

    
    useEffect(() => {
        if (!restoringFromInfoRef.current) return;
        if (showContactInfo || forwardSourceUser || viewingMemberId || showMembersList) return;
        const mem = getChatScrollMemory(chatId);
        if (!mem) return;
        const shouldRestoreExact = Boolean(mem.userInteracted && !mem.atBottom);
        restoreTopAfterInfoRef.current = shouldRestoreExact ? mem.top : null;
        restoreBottomAfterInfoRef.current = !shouldRestoreExact;
        let raf = 0;
        let frames = 0;
        let lastHeight = -1;
        let stableFrames = 0;
        const settle = () => {
            const container = messagesContainerRef.current;
            if (!container) return;
            if (restoringFromInfoRef.current) {
                restoreScroll(chatId);
            } else if (!shouldPreserveExactScroll()) {
                scrollToBottom(false);
            }
            stableFrames = container.scrollHeight === lastHeight ? stableFrames + 1 : 0;
            lastHeight = container.scrollHeight;
            frames += 1;
            if (stableFrames >= 2 || frames >= 24) {
                if (restoreBottomAfterInfoRef.current) {
                    scrollToBottom(true);
                    restoreBottomAfterInfoRef.current = false;
                }
                restoringFromInfoRef.current = false;
                return;
            }
            raf = requestAnimationFrame(settle);
        };
        raf = requestAnimationFrame(settle);
        return () => cancelAnimationFrame(raf);
    }, [showContactInfo, forwardSourceUser, viewingMemberId, showMembersList, chatId]);

    useLayoutEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) {
            prevLenRef.current = messages.length;
            prevFirstMessageIdRef.current = messages[0]?.id || null;
            prevLastMessageIdRef.current = messages[messages.length - 1]?.id || null;
            return;
        }

        if (!initialScrollDoneRef.current) {
            if (messages.length > 0 && !loading) {
                if (initialMediaFollowupDoneRef.current && initialMediaPendingIdsRef.current.size === 0) {
                    const pendingIds = collectInitialMediaPendingIds();
                    if (pendingIds.size > 0) {
                        initialMediaPendingIdsRef.current = pendingIds;
                        initialMediaFollowupDoneRef.current = false;
                    }
                }
                applyInitialScroll();
                initialScrollDoneRef.current = true;
                setChatContentReady(true);
                prevLenRef.current = messages.length;
                prevFirstMessageIdRef.current = messages[0]?.id || null;
                prevLastMessageIdRef.current = messages[messages.length - 1]?.id || null;
                return;
            }
            if (!loading && messages.length === 0) {
                setChatContentReady(true);
            }
            prevLenRef.current = messages.length;
            prevFirstMessageIdRef.current = messages[0]?.id || null;
            prevLastMessageIdRef.current = messages[messages.length - 1]?.id || null;
            return;
        }

        if (autoJumpedToUnreadRef.current && !userScrolledAfterAutoJumpRef.current && !userHasScrolledRef.current) {
            const anchor = resolveUnreadAnchor();
            if (anchor) {
                scrollToUnreadAnchor(anchor);
            }
        }
    }, [chatId, loading, messages.length, displayUnreadCount, unreadAnchorId]);

    const activeTouchOrWheelRef = useRef(false);
    useEffect(() => {
        activeTouchOrWheelRef.current = false;
        const container = messagesContainerRef.current;
        if (!container) return;
        const markUserActive = () => {
            activeTouchOrWheelRef.current = true;
        };
        container.addEventListener('wheel', markUserActive, { passive: true });
        container.addEventListener('touchmove', markUserActive, { passive: true });
        container.addEventListener('pointerdown', markUserActive, { passive: true });
        return () => {
            container.removeEventListener('wheel', markUserActive);
            container.removeEventListener('touchmove', markUserActive);
            container.removeEventListener('pointerdown', markUserActive);
        };
    }, [chatId]);

    useEffect(() => {
        const container = messagesContainerRef.current;
        const inner = container?.querySelector('.chat-room__messages-inner');
        if (!container || !(inner instanceof HTMLElement)) return;
        const observer = new ResizeObserver(() => {
            if (!initialScrollDoneRef.current) return;
            if (activeTouchOrWheelRef.current) return;
            if (pendingRangeLoadTypeRef.current || loadingOlderMessages || localLoadingOlder) return;
            if (shouldPreserveExactScroll()) {
                restoreScroll(chatId);
            }
        });
        observer.observe(inner);
        return () => observer.disconnect();
    }, [chatId, loadingOlderMessages, localLoadingOlder]);

    useLayoutEffect(() => {
        if (!chatContentReady) return;
        if (!initialScrollDoneRef.current) return;
        const container = messagesContainerRef.current;
        if (!container) {
            prevLenRef.current = messages.length;
            prevFirstMessageIdRef.current = messages[0]?.id || null;
            prevLastMessageIdRef.current = messages[messages.length - 1]?.id || null;
            return;
        }

        const added = messages.length - prevLenRef.current;
        const prevFirstId = prevFirstMessageIdRef.current;
        const prevLastId = prevLastMessageIdRef.current;
        const nextFirstId = messages[0]?.id || null;
        const nextLastId = messages[messages.length - 1]?.id || null;

        const likelyPrependedOlder =
            added > 0
            && Boolean(prevFirstId)
            && nextFirstId !== prevFirstId
            && Boolean(prevLastId)
            && nextLastId === prevLastId;

        if ((pendingRangeLoadTypeRef.current === 'older' || likelyPrependedOlder) && !loadingOlderMessages) {
            const snap = pendingOlderAdjustRef.current;
            if (snap && added > 0) {
                const delta = container.scrollHeight - snap.prevHeight;
                markProgrammaticScroll();
                container.scrollTop = snap.prevTop + Math.max(0, delta);
            }

            if (added > 0) {
                const newMessages = messages.slice(0, Math.max(0, added));
                const mediaIds = collectMediaIds(newMessages);
                if (mediaIds.size > 0) {
                    mediaIds.forEach((id) => rangeMediaPendingIdsRef.current.add(id));
                } else {
                    setLocalLoadingOlder(false);
                }
            } else {
                setLocalLoadingOlder(false);
            }

            pendingOlderAdjustRef.current = null;
            pendingRangeLoadTypeRef.current = null;
            prevLenRef.current = messages.length;
            prevFirstMessageIdRef.current = nextFirstId;
            prevLastMessageIdRef.current = nextLastId;
            return;
        }

        if (pendingRangeLoadTypeRef.current === 'newer') {
            if (!loadingNewerMessages) {
                if (added > 0) {
                    const newMessages = messages.slice(Math.max(0, messages.length - added));
                    const mediaIds = collectMediaIds(newMessages);
                    if (mediaIds.size > 0) {
                        mediaIds.forEach((id) => rangeMediaPendingIdsRef.current.add(id));
                    } else {
                        setLocalLoadingNewer(false);
                    }
                } else {
                    setLocalLoadingNewer(false);
                }
                pendingRangeLoadTypeRef.current = null;
            }
            prevLenRef.current = messages.length;
            prevFirstMessageIdRef.current = nextFirstId;
            prevLastMessageIdRef.current = nextLastId;
            return;
        }

        const wasSnapshotReplaced =
            messages.length > 0 &&
            nextLastId !== prevLastId &&
            (!prevLastId || !messages.some((m) => m.id === prevLastId));

        if (wasSnapshotReplaced && !userHasScrolledRef.current) {
            const anchor = resolveUnreadAnchor();
            if (anchor) {
                autoJumpedToUnreadRef.current = true;
                userScrolledAfterAutoJumpRef.current = false;
                scrollToUnreadAnchor(anchor);
            } else if (!shouldPreserveExactScroll()) {
                pinToBottomSync();
            }
            prevLenRef.current = messages.length;
            prevFirstMessageIdRef.current = nextFirstId;
            prevLastMessageIdRef.current = nextLastId;
            return;
        }

        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;

        if (added > 0 && nextLastId !== prevLastId) {
            if (pendingRangeLoadTypeRef.current || loadingNewerMessages || localLoadingNewer) {
                prevLenRef.current = messages.length;
                prevFirstMessageIdRef.current = nextFirstId;
                prevLastMessageIdRef.current = nextLastId;
                return;
            }
            if (autoJumpedToUnreadRef.current && !userScrolledAfterAutoJumpRef.current && !userHasScrolledRef.current) {
                const anchor = resolveUnreadAnchor();
                if (anchor) {
                    scrollToUnreadAnchor(anchor);
                }
                prevLenRef.current = messages.length;
                prevFirstMessageIdRef.current = nextFirstId;
                prevLastMessageIdRef.current = nextLastId;
                return;
            }
            const addedMessages = messages.slice(-added);
            const isMyOwnNewMessage = addedMessages[addedMessages.length - 1]?.senderId === currentUserId;
            if (added <= 5 && addedMessages.length > 0) {
                setArrivedMessageIds(addedMessages.map((m) => m.id));
                if (arrivedAnimationTimerRef.current) window.clearTimeout(arrivedAnimationTimerRef.current);
                arrivedAnimationTimerRef.current = window.setTimeout(() => setArrivedMessageIds([]), 400);
            }
            if ((nearBottom || isMyOwnNewMessage) && (!autoJumpedToUnreadRef.current || userScrolledAfterAutoJumpRef.current || isMyOwnNewMessage)) {
                const openedRecently = Date.now() - openedAtRef.current < 1600;
                const shouldAnimate = isMyOwnNewMessage || (!openedRecently && added <= 2);
                const raf = requestAnimationFrame(() => scrollToBottom(shouldAnimate));
                prevLenRef.current = messages.length;
                prevFirstMessageIdRef.current = nextFirstId;
                prevLastMessageIdRef.current = nextLastId;
                return () => cancelAnimationFrame(raf);
            }
            if (!hasNewerMessages) {
                const prevLastIndex = prevLastId ? messages.findIndex((msg) => msg.id === prevLastId) : -1;
                const recentlyAddedMessages = prevLastIndex >= 0 ? messages.slice(prevLastIndex + 1) : [];
                const incomingCount = recentlyAddedMessages.filter((msg) => msg.senderId !== currentUserId && !msg.seen).length;
                if (incomingCount > 0) {
                    setNewMsgCount((c) => c + incomingCount);
                }
            }
        }

        prevLenRef.current = messages.length;
        prevFirstMessageIdRef.current = nextFirstId;
        prevLastMessageIdRef.current = nextLastId;
    }, [messages, messages.length, currentUserId, loadingOlderMessages, loadingNewerMessages, localLoadingNewer, hasNewerMessages, chatContentReady]);

    useEffect(() => {
        visibleIncomingRef.current.clear();
        visibleMessageIdsRef.current.clear();
        ackedIdsRef.current.clear();
        if (readFlushTimerRef.current !== null) {
            window.clearTimeout(readFlushTimerRef.current);
            readFlushTimerRef.current = null;
        }
        if (ackTimerRef.current !== null) {
            window.clearTimeout(ackTimerRef.current);
            ackTimerRef.current = null;
        }
    }, [chatId]);

    const flushVisibleReads = useCallback(() => {
        if (readFlushTimerRef.current !== null) {
            window.clearTimeout(readFlushTimerRef.current);
            readFlushTimerRef.current = null;
        }
        if (isSavedMessages || !onMarkReadRef.current) return;
        if (document.visibilityState !== 'visible') return;
        if (!initialScrollDoneRef.current) return;

        const list = latestMessagesRef.current;
        if (!list || list.length === 0) return;

        const indexById = new Map<string, number>();
        list.forEach((message, index) => {
            if (message.senderId !== currentUserId) indexById.set(message.id, index);
        });

        const candidates = Array.from(visibleIncomingRef.current)
            .map((id) => ({ id, index: indexById.get(id) }))
            .filter((entry): entry is { id: string; index: number } => (
                typeof entry.index === 'number' && !list[entry.index]?.seen
            ));

        if (isAtBottomRef.current && !hasNewerMessages) {
            for (let i = list.length - 1; i >= 0; i -= 1) {
                const msg = list[i];
                if (msg.senderId !== currentUserId && !msg.seen) {
                    candidates.push({ id: msg.id, index: i });
                    break;
                }
            }
        }

        if (candidates.length === 0) return;
        const { id: maxId, index: maxIndex } = candidates.reduce((best, entry) => (
            entry.index > best.index ? entry : best
        ));
        const lastSentId = lastSentReadIdRef.current[chatId];
        const lastSentIndex = lastSentId ? indexById.get(lastSentId) : undefined;
        if (typeof lastSentIndex === 'number' && lastSentIndex >= maxIndex) return;

        let newlyRead = 0;
        for (let index = 0; index <= maxIndex; index += 1) {
            const message = list[index];
            if (message.senderId !== currentUserId && !message.seen) newlyRead += 1;
        }
        lastSentReadIdRef.current[chatId] = maxId;
        onMarkReadRef.current?.(maxId, newlyRead);
    }, [chatId, currentUserId, hasNewerMessages, isSavedMessages]);

    useEffect(() => {
        if (isSavedMessages || !onMarkReadRef.current) return;
        const container = messagesContainerRef.current;
        if (!container || loading) return;

        const schedule = () => {
            if (document.visibilityState !== 'visible') return;
            if (!initialScrollDoneRef.current) return;
            if (readFlushTimerRef.current !== null) window.clearTimeout(readFlushTimerRef.current);
            readFlushTimerRef.current = window.setTimeout(flushVisibleReads, 180);
        };

        const observer = new IntersectionObserver((entries) => {
            const containerHeight = container.getBoundingClientRect().height;
            entries.forEach((entry) => {
                const target = entry.target as HTMLElement;
                const id = target.dataset.messageId;
                if (!id) return;
                const message = latestMessagesRef.current.find((m) => m.id === id);
                if (!message || message.senderId === currentUserId) return;
                const visible = entry.isIntersecting
                    && (entry.intersectionRatio >= 0.15 || entry.intersectionRect.height >= Math.min(48, containerHeight * 0.25));
                if (visible) visibleIncomingRef.current.add(id);
                else visibleIncomingRef.current.delete(id);
            });
            schedule();
        }, { root: container, threshold: [0, 0.15, 0.5, 1] });

        const observeIncoming = () => {
            container.querySelectorAll<HTMLElement>('[data-message-id]').forEach((el) => {
                const id = el.dataset.messageId;
                if (!id) return;
                const message = latestMessagesRef.current.find((m) => m.id === id);
                if (message && message.senderId !== currentUserId) observer.observe(el);
            });
        };

        observeIncoming();

        const onWake = () => {
            container.querySelectorAll<HTMLElement>('[data-message-id]').forEach((el) => observer.unobserve(el));
            observeIncoming();
            schedule();
        };
        window.addEventListener('focus', onWake);
        document.addEventListener('visibilitychange', onWake);
        schedule();

        return () => {
            flushVisibleReads();
            observer.disconnect();
            window.removeEventListener('focus', onWake);
            document.removeEventListener('visibilitychange', onWake);
            if (readFlushTimerRef.current !== null) {
                window.clearTimeout(readFlushTimerRef.current);
                readFlushTimerRef.current = null;
            }
        };
    }, [chatId, messages.length, loading, currentUserId, isSavedMessages, chatContentReady, flushVisibleReads]);

    useEffect(() => {
        const onResize = () => {
            roomRef.current?.querySelectorAll<HTMLElement>('.ai-search-pills').forEach(updateSearchPillsFade);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const onMessagesScroll = () => {
        if (scrollRafRef.current !== null) return;
        scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = null;
            handleMessagesScroll();
        });
    };

    const triggerLoadOlderMessages = () => {
        const container = messagesContainerRef.current;
        if (!container || !hasOlderMessages || loadingOlderMessages || localLoadingOlder) return;
        pendingRangeLoadTypeRef.current = 'older';
        pendingOlderAdjustRef.current = { prevHeight: container.scrollHeight, prevTop: container.scrollTop };
        setLocalLoadingOlder(true);
        Promise.resolve(onLoadOlderMessages?.(chatId)).finally(() => {
            const fallbackTimer = window.setTimeout(() => {
                rangeMediaPendingIdsRef.current.clear();
                setLocalLoadingOlder(false);
            }, 3500);
            window.setTimeout(() => {
                if (rangeMediaPendingIdsRef.current.size === 0) {
                    window.clearTimeout(fallbackTimer);
                    setLocalLoadingOlder(false);
                }
            }, 1000);
        });
    };

    useEffect(() => {
        const sentinel = topSentinelRef.current;
        const root = messagesContainerRef.current;
        if (!sentinel || !root) return;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            if (!initialScrollDoneRef.current || !userHasScrolledRef.current) return;
            triggerLoadOlderMessages();
        }, { root, threshold: 0 });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [chatId, hasOlderMessages, loadingOlderMessages, localLoadingOlder, onLoadOlderMessages]);

    const handleMessagesScroll = () => {
        const container = messagesContainerRef.current;
        if (!container) return;
        container.querySelectorAll('.chat-room__date-separator--idle').forEach((el) => el.classList.remove('chat-room__date-separator--idle'));
        if (idleDateTimerRef.current) window.clearTimeout(idleDateTimerRef.current);
        idleDateTimerRef.current = window.setTimeout(() => {
            const host = messagesContainerRef.current;
            if (!host) return;
            const hostTop = host.getBoundingClientRect().top;
            const stickyTop = parseFloat(getComputedStyle(host.closest('.chat-room') as Element).getPropertyValue('--date-sticky-top')) || 72;
            const stuck = Array.from(host.querySelectorAll<HTMLElement>('[data-date-separator]')).filter(
                (el) => el.getBoundingClientRect().top - hostTop <= stickyTop + 1 && el.parentElement!.getBoundingClientRect().top - hostTop < stickyTop
            );
            stuck[stuck.length - 1]?.classList.add('chat-room__date-separator--idle');
        }, 1000);
        const currentTop = container.scrollTop;
        setMessagesScrolled(isElementScrolled(container));
        const lastTop = lastScrollTopRef.current;
        const scrollingDown = currentTop > lastTop + 1;
        lastScrollTopRef.current = currentTop;

        if (msgMenu || reactionMenu || seenByMenu || reactionListMenu) {
            setMsgMenu(null);
            setReactionMenu(null);
            setSeenByMenu(null); setReactionListMenu(null);
        }

        const nearBottom = computeNearBottom();
        isAtBottomRef.current = nearBottom;
        notifyReaderState(nearBottom);

        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (nearBottom) {
            setNewMsgCount(0);
            setShowScrollBtn(false);
        } else {
            setShowScrollBtn(distanceToBottom > 180);
        }

        if (performance.now() < programmaticScrollUntilRef.current) {
            return;
        }

        if (nearBottom) {
            flushVisibleReads();
        }

        if (nearBottom || distanceToBottom <= 24) {
            userReadingOlderRef.current = false;
        } else if (!scrollingDown && distanceToBottom > 140) {
            userReadingOlderRef.current = true;
        }

        userHasScrolledRef.current = true;

        if (autoJumpedToUnreadRef.current) {
            userScrolledAfterAutoJumpRef.current = true;
        }

        saveScroll(chatId);

        if (
            distanceToBottom > 12
            && distanceToBottom <= 96
            && scrollingDown
            && hasNewerMessages
            && !loadingNewerMessages
            && !localLoadingNewer
            && !userReadingOlderRef.current
        ) {
            pendingRangeLoadTypeRef.current = 'newer';
            setLocalLoadingNewer(true);
            Promise.resolve(onLoadNewerMessages?.(chatId)).finally(() => {
                const fallbackTimer = window.setTimeout(() => {
                    rangeMediaPendingIdsRef.current.clear();
                    setLocalLoadingNewer(false);
                }, 3500);
                window.setTimeout(() => {
                    if (rangeMediaPendingIdsRef.current.size === 0) {
                        window.clearTimeout(fallbackTimer);
                        setLocalLoadingNewer(false);
                    }
                }, 1000);
            });
        }
    };

    const messageMetaCache = useMemo(() => new Map<string, { ts: unknown; text: string; time: string; dayKey: number; isBigEmojiOnly: boolean; emojiOnlyClass: string }>(), []);

    const items = useMemo(() => {
        const cache = messageMetaCache;
        if (cache.size > 4000) cache.clear();
        const readMeta = (msg: Message) => {
            const text = msg.text || '';
            const cached = cache.get(msg.id);
            if (cached && cached.ts === msg.timestamp && cached.text === text) return cached;
            const pureEmojiCount = text ? getPureEmojiCount(text) : 0;
            const hasEmojiOnlyStickerStyle = pureEmojiCount >= 1 && pureEmojiCount <= 5 && !msg.file;
            const next = {
                ts: msg.timestamp,
                text,
                time: formatMessageTime(msg.timestamp),
                dayKey: messageDayKey(msg.timestamp),
                isBigEmojiOnly: hasEmojiOnlyStickerStyle,
                emojiOnlyClass: hasEmojiOnlyStickerStyle ? `message-text--emoji-only-${Math.min(5, pureEmojiCount)}` : '',
            };
            cache.set(msg.id, next);
            return next;
        };

        return messages.map((m, idx) => {
            const prev = idx > 0 ? messages[idx - 1] : null;
            const next = idx < messages.length - 1 ? messages[idx + 1] : null;
            const meta = readMeta(m);
            const isMine = m.senderId === currentUserId;
            const dayBreak = !prev || readMeta(prev).dayKey !== meta.dayKey;
            const nextDayBreak = !next || readMeta(next).dayKey !== meta.dayKey;
            const prevSameSender = Boolean(prev) && !dayBreak && !prev!.systemType && !m.systemType && prev!.senderId === m.senderId;
            const nextSameSender = Boolean(next) && !nextDayBreak && !next!.systemType && !m.systemType && next!.senderId === m.senderId;
            const dayLabel = dayBreak ? formatDayLabel(m.timestamp) : '';
            return {
                m,
                isMine,
                dayBreak,
                dayKey: meta.dayKey,
                dayLabel,
                formattedTime: meta.time,
                shape: bubbleShape(prevSameSender, nextSameSender),
                isBigEmojiOnly: meta.isBigEmojiOnly,
                emojiOnlyClass: meta.emojiOnlyClass,
            };
        });
    }, [messages, currentUserId, messageMetaCache]);

    const unreadAnchorForUi = useMemo(
        () => resolveUnreadAnchor(),
        [unreadAnchorId, displayUnreadCount, messages, currentUserId]
    );

    const otherTypingUserIds = useMemo(
        () => (typingUserIds || []).filter((uid) => uid && uid !== currentUserId),
        [typingUserIds, currentUserId]
    );
    const otherUploadingUserIds = useMemo(
        () => (uploadingUserIds || []).filter((uid) => uid && uid !== currentUserId),
        [uploadingUserIds, currentUserId]
    );

    const typingStatusLabel = useMemo(() => {
        if (isContactBlocked || isOfficialChannel) return '';
        if (otherTypingUserIds.length === 0) return '';
        if (!isGroupChat) return 'درحال تایپ';
        if (otherTypingUserIds.length === 1) {
            const uid = otherTypingUserIds[0];
            const name = groupMembers[uid]?.name || 'یک کاربر';
            return `${name} درحال تایپ`;
        }
        return `${toPersianDigits(otherTypingUserIds.length)} کاربر درحال تایپ هستند`;
    }, [otherTypingUserIds, isGroupChat, groupMembers, isContactBlocked]);

    const uploadingStatusLabel = useMemo(() => {
        if (isContactBlocked || isOfficialChannel) return '';
        if (otherUploadingUserIds.length === 0) return '';
        if (!isGroupChat) return 'درحال آپلود فایل';
        if (otherUploadingUserIds.length === 1) {
            const uid = otherUploadingUserIds[0];
            const name = groupMembers[uid]?.name || 'یک کاربر';
            return `${name} درحال آپلود فایل`;
        }
        return `${toPersianDigits(otherUploadingUserIds.length)} کاربر درحال آپلود فایل هستند`;
    }, [otherUploadingUserIds, isGroupChat, groupMembers, isContactBlocked]);

    const headerActivityLabel = useMemo(() => {
        if (typingStatusLabel) return typingStatusLabel;
        return uploadingStatusLabel;
    }, [typingStatusLabel, uploadingStatusLabel]);

    const scrollButtonBottom = composerHeight + 22;

    const visibleUnreadMentionIds = useMemo(
        () => (isGroupChat && !isOfficialChannel && !isSavedMessages ? unreadMentionIds : []),
        [isGroupChat, isOfficialChannel, isSavedMessages, unreadMentionIds]
    );
    const visibleUnreadReactionIds = useMemo(
        () => (!isOfficialChannel && !isSavedMessages ? unreadReactionIds : []),
        [isOfficialChannel, isSavedMessages, unreadReactionIds]
    );

    const mentionCandidates = useMemo(() => {
        if (!isGroupChat || isOfficialChannel) return [];
        return Object.entries(groupMembers)
            .filter(([, m]) => m.isMember !== false)
            .map(([id, m]) => ({
                chatId: m.chatId || id,
                name: m.name || '',
                username: (m.username || '').trim(),
                avatar: m.avatar || '',
                verified: m.verified,
            }))
            .filter((m) => Boolean(m.username))
            .sort((a, b) => {
                if (a.chatId === currentUserId && b.chatId !== currentUserId) return 1;
                if (b.chatId === currentUserId && a.chatId !== currentUserId) return -1;
                return (a.name || a.username).localeCompare(b.name || b.username, 'fa');
            });
    }, [isGroupChat, isOfficialChannel, groupMembers, currentUserId]);

    const handleStepUnreadMention = () => {
        if (visibleUnreadMentionIds.length === 0) return;
        const targetMessageId = visibleUnreadMentionIds[0];
        void onAckMention?.(chatId, targetMessageId);
        if (messagesById.has(targetMessageId)) {
            scrollToMessage(targetMessageId);
        } else {
            void onJumpToMessage?.(chatId, targetMessageId);
        }
    };

    const handleStepUnreadReaction = () => {
        if (visibleUnreadReactionIds.length === 0) return;
        const targetMessageId = visibleUnreadReactionIds[0];
        void onAckReaction?.(chatId, targetMessageId);
        if (messagesById.has(targetMessageId)) {
            scrollToMessage(targetMessageId);
        } else {
            void onJumpToMessage?.(chatId, targetMessageId);
        }
    };

    mentionIdsRef.current = visibleUnreadMentionIds;
    reactionIdsRef.current = visibleUnreadReactionIds;

    const requestVisibleAck = useCallback(() => {
        if (isSavedMessages) return;
        if (!initialScrollDoneRef.current) return;
        if (document.visibilityState !== 'visible') return;
        if (ackTimerRef.current !== null) window.clearTimeout(ackTimerRef.current);
        ackTimerRef.current = window.setTimeout(() => {
            ackTimerRef.current = null;
            const visible = visibleMessageIdsRef.current;
            const mentionIds = mentionIdsRef.current.filter((id) => visible.has(id) && !ackedIdsRef.current.has(id));
            const reactionIds = reactionIdsRef.current.filter((id) => visible.has(id) && !ackedIdsRef.current.has(id));
            if (mentionIds.length === 0 && reactionIds.length === 0) return;
            mentionIds.forEach((id) => {
                ackedIdsRef.current.add(id);
                void onAckMention?.(chatId, id);
            });
            reactionIds.forEach((id) => {
                ackedIdsRef.current.add(id);
                void onAckReaction?.(chatId, id);
            });
        }, 300);
    }, [chatId, isSavedMessages, onAckMention, onAckReaction]);

    useEffect(() => {
        const pending = new Set([...visibleUnreadMentionIds, ...visibleUnreadReactionIds]);
        Array.from(ackedIdsRef.current).forEach((id) => {
            if (!pending.has(id)) ackedIdsRef.current.delete(id);
        });
        requestVisibleAck();
    }, [visibleUnreadMentionIds, visibleUnreadReactionIds, requestVisibleAck]);

    useEffect(() => {
        if (isSavedMessages) return;
        const container = messagesContainerRef.current;
        if (!container || loading) return;

        const observer = new IntersectionObserver((entries) => {
            const containerHeight = container.getBoundingClientRect().height;
            entries.forEach((entry) => {
                const id = (entry.target as HTMLElement).dataset.messageId;
                if (!id) return;
                const visible = entry.isIntersecting
                    && (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= containerHeight * 0.5);
                if (visible) visibleMessageIdsRef.current.add(id);
                else visibleMessageIdsRef.current.delete(id);
            });
            requestVisibleAck();
        }, { root: container, threshold: [0, 0.5, 1] });

        container.querySelectorAll<HTMLElement>('[data-message-id]').forEach((el) => observer.observe(el));

        const onWake = () => {
            container.querySelectorAll<HTMLElement>('[data-message-id]').forEach((el) => observer.unobserve(el));
            container.querySelectorAll<HTMLElement>('[data-message-id]').forEach((el) => observer.observe(el));
            requestVisibleAck();
        };
        window.addEventListener('focus', onWake);
        document.addEventListener('visibilitychange', onWake);
        requestVisibleAck();

        return () => {
            observer.disconnect();
            visibleMessageIdsRef.current.clear();
            window.removeEventListener('focus', onWake);
            document.removeEventListener('visibilitychange', onWake);
        };
    }, [chatId, messages.length, loading, isSavedMessages, requestVisibleAck]);

    const jumpToLatest = async () => {
        if (isJumpingToLatest) return;
        setNewMsgCount(0);
        if (hasNewerMessages) {
            setIsJumpingToLatest(true);
            try {
                if (onJumpToLatestMessages) {
                    await Promise.resolve(onJumpToLatestMessages(chatId));
                } else if (onSelectChat) {
                    await Promise.resolve(onSelectChat(chatId));
                } else if (onLoadNewerMessages) {
                    await Promise.resolve(onLoadNewerMessages(chatId));
                }
            } finally {
                setIsJumpingToLatest(false);
            }
        }
        scrollToBottom(true);
        window.setTimeout(() => {
            scrollToBottom(true);
            if (computeNearBottom()) setShowScrollBtn(false);
        }, 260);
    };

    const handleComposerSend = useCallback((payload: ChatComposerSendPayload) => {
        if (isContactBlocked || !canSendInOfficialChannel) return false;
        if (!payload.text.trim() && !payload.attachment && (!pendingForwardDraft || Boolean(editingId))) return false;
        if (payload.text || payload.attachment) {
            onSendMessage({
                text: payload.text,
                replyToId: payload.replyToId,
                replyQuoteText: payload.replyQuoteText,
                replyIsQuote: payload.replyIsQuote,
                editMessageId: payload.editMessageId,
                attachment: payload.attachment,
            });
        }
        if (pendingForwardDraft && !editingId) {
            void handleForwardDraft();
        }
        if (!editingId) {
            clearChatDraft(chatId);
        }
        lockedUnreadAnchorRef.current = null;
        setUnreadAnchorId(null);
        setDisplayUnreadCount(0);
        setReplyTo(null);
        setEditingId(null);
        userHasScrolledRef.current = false;
        userReadingOlderRef.current = false;
        smoothBottomUntilRef.current = performance.now() + 1500;
        requestAnimationFrame(() => scrollToBottom(true));
        window.setTimeout(() => {
            if (computeNearBottom()) pinToBottomSync();
            smoothBottomUntilRef.current = 0;
        }, 1500);
        return true;
    }, [isContactBlocked, canSendInOfficialChannel, pendingForwardDraft, editingId, onSendMessage, handleForwardDraft, chatId]);

    const handleInputFocus = useCallback(() => {
        window.setTimeout(() => {
            if (computeNearBottom()) scrollToBottom(false);
        }, 80);
    }, []);

    const handleCancelReplyEdit = useCallback(() => {
        setReplyTo(null);
        setEditingId(null);
    }, []);

    const handleCancelForward = useCallback(() => {
        onClearPendingForwardDraft?.(chatId);
    }, [onClearPendingForwardDraft, chatId]);

    const handleTypingChange = useCallback((targetChatId: string, isTyping: boolean) => {
        onTypingChange?.(targetChatId, isTyping);
    }, [onTypingChange]);

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

    const openDeleteChatConfirm = () => {
        setChatMenuOpen(false);
        window.setTimeout(() => setConfirmDeleteChat(true), 40);
    };

    const openLeaveGroupConfirm = () => {
        setChatMenuOpen(false);
        window.setTimeout(() => setConfirmLeaveGroup(true), 40);
    };

    const openMessageMenu = async (messageId: string, targetEl: HTMLElement, clientX?: number, clientY?: number) => {
        const room = roomRef.current;
        if (!room) return;

        if (window.matchMedia?.('(pointer: fine)').matches && customSelection.ui) return;

        if (chatMenuOpen) {
            setChatMenuOpen(false);
            return;
        }

        if (reactionMenu || seenByMenu || reactionListMenu) {
            setMsgMenu(null);
            setReactionMenu(null);
            setSeenByMenu(null); setReactionListMenu(null);
            return;
        }

        if (msgMenu) {
            setMsgMenu(null);
            setReactionMenu(null);
            setSeenByMenu(null); setReactionListMenu(null);
            return;
        }

        const roomRect = room.getBoundingClientRect();
        const r = targetEl.getBoundingClientRect();

        const x = typeof clientX === 'number' && Number.isFinite(clientX) ? clientX : (r.left + 12);
        const y = typeof clientY === 'number' && Number.isFinite(clientY) ? clientY : (r.top + 28);

        
        const relX = x - roomRect.left;
        const relY = y - roomRect.top;

        const message = messagesById.get(messageId);
        let isFileDownloaded = false;
        if (message?.file?.fileId) {
            const blob = await getCachedBlob(`chat:${chatId}:file:${message.file.fileId}`);
            if (blob) isFileDownloaded = true;
        }

        setMsgMenu({ id: messageId, top: relY + 8, left: relX - 12, isFileDownloaded });
        setReactionMenu(null);
        setSeenByMenu(null); setReactionListMenu(null);

        if (isGroupChat && message?.senderId === currentUserId) {
            loadSeenBy(messageId);
        }
    };

    
    useLayoutEffect(() => {
        const room = roomRef.current;
        if (!room) return;
        const rr = room.getBoundingClientRect();
        const clamp = <T extends { top: number; left: number }>(menu: T | null, el: HTMLDivElement | null): T | null => {
            if (!menu || !el) return menu;
            const mr = el.getBoundingClientRect();
            const padding = 12;
            const minTop = 64;
            const left = Math.min(Math.max(menu.left, padding), Math.max(padding, rr.width - mr.width - padding));
            const top = Math.min(Math.max(menu.top, minTop), Math.max(minTop, rr.height - mr.height - padding));
            return left === menu.left && top === menu.top ? menu : { ...menu, left, top };
        };
        setMsgMenu((menu) => clamp(menu, msgMenuRef.current));
        setReactionMenu((menu) => clamp(menu, reactionMenuRef.current));
        setSeenByMenu((menu) => clamp(menu, seenByMenuRef.current));
        setReactionListMenu((menu) => clamp(menu, reactionListMenuRef.current));
    }, [msgMenu?.id, msgMenu?.top, msgMenu?.left, msgMenu?.isFileDownloaded, reactionMenu?.id, reactionMenu?.top, reactionMenu?.left, seenByMenu?.id, seenByMenu?.top, seenByMenu?.left, reactionListMenu?.id, reactionListMenu?.top, reactionListMenu?.left]);

    const openReactionMenu = (messageId: string, targetEl: HTMLElement, anchor?: { top: number; left: number }) => {
        if (!anchor && window.matchMedia?.('(pointer: fine)').matches) {
            setReactionMenu(null);
            return;
        }
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
        setSeenByMenu(null); setReactionListMenu(null);
    };

    const beginReply = (m: Message, withHaptic = false) => {
        clearTextSelection();
        setReplyTo({ id: m.id, senderId: m.senderId, text: m.text });
        setEditingId(null); setMsgMenu(null); setReactionMenu(null); setSeenByMenu(null); setReactionListMenu(null);
        if (withHaptic) triggerHaptic();
    };

    const beginQuoteReply = (messageId: string, quotedText: string, withHaptic = false) => {
        const m = messagesById.get(messageId);
        const cleanQuote = quotedText.trim();
        if (!m || !cleanQuote) return;
        clearTextSelection();
        setSelectedMessageIds([]);
        setReplyTo({ id: m.id, senderId: m.senderId, text: cleanQuote, isQuote: true });
        setEditingId(null); setMsgMenu(null); setReactionMenu(null); setSeenByMenu(null); setReactionListMenu(null);
        if (withHaptic) triggerHaptic();
        requestAnimationFrame(() => {
            composerHostRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
        });
    };

    const beginEdit = (m: Message) => {
        clearTextSelection();
        setEditingId(m.id); setReplyTo(null);
        setMsgMenu(null); setReactionMenu(null); setSeenByMenu(null); setReactionListMenu(null);
    };

    const doDeleteMessage = (messageId: string) => {
        setMsgMenu(null); setReactionMenu(null); setSeenByMenu(null); setReactionListMenu(null);
        setConfirmDeleteMsg(messageId);
    };

    const cleanupMessageCache = (messageId: string) => {
        const msg = messagesById.get(messageId);
        if (msg?.file?.fileId) void deleteCachedBlob(`chat:${chatId}:file:${msg.file.fileId}`);
    };

    const confirmDeleteMessage = () => {
        if (!confirmDeleteMsg) return;
        const targetId = confirmDeleteMsg;
        setConfirmDeleteMsg(null);
        onDeleteMessage(targetId);
        cleanupMessageCache(targetId);
    };

    const toggleReasoning = (messageId: string) => {
        setReasoningPanelByMessage((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
    };

    const messageHandlerStateRef = useRef({
        openMessageMenu,
        openReactionMenu,
        handleReact,
        handleDeleteReaction,
        beginReply,
        toggleMessageSelection,
        scrollToMessage,
        openForwardSource,
        openMember,
        handleInitialMediaReady,
        openImageViewer,
        openVideoViewer,
        setReplySwipeLocked,
        toggleReasoning,
        openMention,
        openGroupInvite,
    });
    messageHandlerStateRef.current = {
        openMessageMenu,
        openReactionMenu,
        handleReact,
        handleDeleteReaction,
        beginReply,
        toggleMessageSelection,
        scrollToMessage,
        openForwardSource,
        openMember,
        handleInitialMediaReady,
        openImageViewer,
        openVideoViewer,
        setReplySwipeLocked,
        toggleReasoning,
        openMention,
        openGroupInvite,
    };

    const messageActions = useMemo(() => ({
        openMenu: (messageId: string, targetEl: HTMLElement, clientX?: number, clientY?: number) => {
            void messageHandlerStateRef.current.openMessageMenu(messageId, targetEl, clientX, clientY);
        },
        openReactionMenu: (messageId: string, targetEl: HTMLElement) => {
            messageHandlerStateRef.current.openReactionMenu(messageId, targetEl);
        },
        react: (messageId: string, emoji: string) => {
            void messageHandlerStateRef.current.handleReact(messageId, emoji);
        },
        deleteReaction: (messageId: string) => {
            void messageHandlerStateRef.current.handleDeleteReaction(messageId);
        },
        reply: (message: Message) => messageHandlerStateRef.current.beginReply(message, false),
        toggleSelect: (messageId: string) => messageHandlerStateRef.current.toggleMessageSelection(messageId),
        scrollToMessage: (messageId: string, quoteText?: string) => messageHandlerStateRef.current.scrollToMessage(messageId, 1, quoteText),
        openForwardSource: (message: Message) => messageHandlerStateRef.current.openForwardSource(message),
        openMember: (memberId: string) => messageHandlerStateRef.current.openMember(memberId),
        toggleReasoning: (messageId: string) => messageHandlerStateRef.current.toggleReasoning(messageId),
        mediaReady: (messageId: string) => messageHandlerStateRef.current.handleInitialMediaReady(messageId),
        openImage: (url: string, file: FileMetadata | null) => messageHandlerStateRef.current.openImageViewer(url, file),
        openVideo: (url: string, file: FileMetadata | null) => messageHandlerStateRef.current.openVideoViewer(url, file),
        swipeLock: (locked: boolean) => messageHandlerStateRef.current.setReplySwipeLocked(locked),
        openMention: (username: string, messageId: string) => {
            void messageHandlerStateRef.current.openMention(username, messageId);
        },
        openGroupInvite: (inviteCode: string, messageId?: string) => {
            void messageHandlerStateRef.current.openGroupInvite(inviteCode, messageId);
        },
        registerEl: (messageId: string, el: HTMLDivElement | null) => {
            if (!el) {
                messageElsRef.current.delete(messageId);
                return;
            }
            messageElsRef.current.set(messageId, el);
        },
    }), []);

    const reactionMembers = useMemo(() => {
        if (isGroupChat) return groupMembers;
        const members: Record<string, { name?: string; avatar?: string }> = {};
        if (currentUser?.chatId) members[currentUser.chatId] = { name: currentUser.name, avatar: currentUser.avatar };
        if (contact.chatId) members[contact.chatId] = { name: contact.name, avatar: contact.avatar };
        return members;
    }, [isGroupChat, groupMembers, currentUser, contact]);

    const renderedMessageItems = useMemo(() => {
        const groups: { key: number; label: string; items: ReactNode[] }[] = [];
        items.forEach(({ m, isMine, dayBreak, dayKey, dayLabel, formattedTime, shape, isBigEmojiOnly, emojiOnlyClass }) => {
            const showUnreadSeparator = Boolean(unreadAnchorForUi && unreadAnchorForUi === m.id && m.senderId !== currentUserId);
            const seenByCountForMessage = seenByUsersByMessage[m.id]?.length ?? 0;
            const isSeenForUi = Boolean(
                m.seen || (isGroupChat && isMine && seenByCountForMessage > 0) || (isOfficialChannel && isMine)
            );
            const messageSeenByRaw = Array.isArray((m as any).seenBy) ? (m as any).seenBy.length : 0;
            const messageSeenCountRaw = Number((m as any).seenCount || 0);
            const messageSeenCount = Math.max(1, seenByCountForMessage, messageSeenByRaw, messageSeenCountRaw);
            const sender = groupMembers[m.senderId];
            const senderPending = isGroupChat && !isMine && !sender && !membersResolved;
            const replySenderId = m.replyTo ? String(messagesById.get(m.replyTo.id)?.senderId || m.replyTo.senderId || '') : '';
            const replySenderPending = isGroupChat && !membersResolved && Boolean(replySenderId) && !groupMembers[replySenderId];
            const reactionsForMessage = (optimisticReactions[m.id] ?? m.reactions ?? EMPTY_REACTIONS) as unknown as ReactionEntry[];

            const item = (
                <ChatMessageItem
                    key={m.id}
                    message={m}
                    displayText={m.text}
                    isMine={isMine}
                    isGroupChat={isGroupChat}
                    isOfficialChannel={isOfficialChannel}
                    isSelectionModeActive={isSelectionModeActive}
                    canSwipeToReply={canSwipeToReply}
                    currentUserId={currentUserId}
                    token={token}
                    chatId={chatId}
                    formattedTime={formattedTime}
                    shape={shape}
                    isBigEmojiOnly={isBigEmojiOnly}
                    emojiOnlyClass={emojiOnlyClass}
                    senderName={sender?.name || m.senderId || 'ناشناس'}
                    senderAvatar={sender?.avatar || ''}
                    senderPending={senderPending}
                    replySenderName={m.replyTo ? getReplySenderName(m.replyTo) : ''}
                    replySenderPending={replySenderPending}
                    replyPreviewText={m.replyTo ? getReplyPreviewText(m.replyTo) : ''}
                    reactions={reactionsForMessage}
                    reactionMembers={reactionMembers}
                    isHighlighted={highlightId === m.id}
                    isSelected={selectedMessageIds.includes(m.id)}
                    isTextSelectable={selectedMessageIds.includes(m.id)}
                    isNewMessage={arrivedMessageIds.includes(m.id)}
                    showUnreadSeparator={showUnreadSeparator}
                    isMenuActive={msgMenu?.id === m.id}
                    isSeenForUi={isSeenForUi}
                    messageSeenCount={messageSeenCount}
                    reasoningOpen={Boolean(reasoningPanelByMessage[m.id])}
                    unreadSeparatorRef={unreadSeparatorRef}
                    actions={messageActions}
                />
            );

            if (dayBreak) {
                groups.push({ key: dayKey, label: dayLabel, items: [item] });
            } else if (groups.length > 0) {
                groups[groups.length - 1].items.push(item);
            }
        });
        return groups.map((group) => (
            <div className="chat-room__date-group" key={group.key}>
                <div className="chat-room__date-separator" data-date-separator>
                    <span className="chat-room__date-label">{group.label}</span>
                </div>
                {group.items}
            </div>
        ));
    }, [
        items,
        highlightId,
        arrivedMessageIds,
        unreadAnchorForUi,
        currentUserId,
        msgMenu?.id,
        seenByUsersByMessage,
        isGroupChat,
        isOfficialChannel,
        optimisticReactions,
        canSwipeToReply,
        groupMembers,
        reactionMembers,
        membersResolved,
        messagesById,
        token,
        chatId,
        reasoningPanelByMessage,
        selectedMessageIds,
        isSelectionModeActive,
        messageActions,
    ]);

    const contactView = (() => {
        if (showContactInfo && !isOfficialChannel) {
            const infoUser: any = isGroupChat ? { ...contact, chatId, isGroup: true } : contact;
            const blocked = Boolean(isUserBlocked?.(infoUser));
            return {
                user: infoUser,
                isBlocked: !isGroupChat && blocked,
                hideOnlineStatus: !isGroupChat && (Boolean(infoUser?.blockedByOther) || blocked),
                isInteractiveOnline: Boolean(interactiveOnlineUsers && infoUser?.chatId && interactiveOnlineUsers[infoUser.chatId]),
                membershipClosed: isGroupChat ? Boolean(chatStats?.membershipClosed || currentChat?.membershipClosed) : undefined,
                onToggleBlock: !isGroupChat ? onToggleBlockUser : undefined,
                onBack: () => {
                    setShowContactInfo(false);
                    if (forceContactInfoOpen && onCloseForcedContactInfo) {
                        onCloseForcedContactInfo(chatId);
                        return;
                    }
                    if (openGroupEditorFromMembers) {
                        setShowMembersList(true);
                        setOpenGroupEditorFromMembers(false);
                    }
                },
                onOpenMembers: isGroupChat ? () => {
                    setOpenGroupEditorFromMembers(false);
                    setShowContactInfo(false);
                    setShowMembersList(true);
                } : undefined,
                autoOpenMembers: !openGroupEditorFromMembers,
                startInEditMode: openGroupEditorFromMembers,
                onOpenChat: (u: User) => {
                    if (u.chatId === currentUserId) {
                        onOpenProfile?.();
                        setShowContactInfo(false);
                        return;
                    }
                    onOpenDirectChat?.(u);
                    setShowContactInfo(false);
                },
            };
        }
        if (forwardSourceUser) {
            const isSelf = forwardSourceUser.chatId === currentUserId;
            return {
                user: forwardSourceUser,
                isBlocked: !isSelf && Boolean(isUserBlocked?.(forwardSourceUser)),
                hideOnlineStatus: !isSelf && (Boolean((forwardSourceUser as any)?.blockedByOther) || Boolean(isUserBlocked?.(forwardSourceUser))),
                isInteractiveOnline: Boolean(interactiveOnlineUsers && forwardSourceUser?.chatId && interactiveOnlineUsers[forwardSourceUser.chatId]),
                onToggleBlock: isSelf ? undefined : onToggleBlockUser,
                onBack: () => setForwardSourceUser(null),
                onOpenMembers: undefined,
                autoOpenMembers: true,
                startInEditMode: false,
                onOpenChat: (u: User) => {
                    if (u.chatId === currentUserId) {
                        onOpenProfile?.();
                        setForwardSourceUser(null);
                        return;
                    }
                    onOpenDirectChat?.(u);
                    setForwardSourceUser(null);
                },
            };
        }
        if (viewingMemberId) {
            const memberData = groupMembers[viewingMemberId];
            const memberUser: any = memberData
                ? {
                    chatId: memberData.chatId || viewingMemberId,
                    name: memberData.name || viewingMemberId,
                    username: memberData.username || '',
                    avatar: memberData.avatar || '',
                    bio: memberData.bio || '',
                    online: memberData.online ?? false,
                    lastSeen: memberData.lastSeen,
                    lastSeenCategory: memberData.lastSeenCategory,
                    verified: memberData.verified || false,
                }
                : { chatId: viewingMemberId, name: viewingMemberId, username: '', avatar: '', bio: '', online: false };
            return {
                user: memberUser,
                isBlocked: Boolean(isUserBlocked?.(memberUser)),
                hideOnlineStatus: Boolean((memberUser as any)?.blockedByOther) || Boolean(isUserBlocked?.(memberUser)),
                isInteractiveOnline: Boolean(interactiveOnlineUsers && (memberUser.chatId || viewingMemberId) && interactiveOnlineUsers[memberUser.chatId || viewingMemberId]),
                onToggleBlock: onToggleBlockUser,
                onBack: () => setViewingMemberId(null),
                onOpenMembers: undefined,
                autoOpenMembers: true,
                startInEditMode: false,
                onOpenChat: (u: User) => {
                    if (u.chatId === currentUserId) {
                        onOpenProfile?.();
                        setViewingMemberId(null);
                        return;
                    }
                    onOpenDirectChat?.(u);
                    setViewingMemberId(null);
                },
            };
        }
        return null;
    })();

    if (contactView) return <ContactInfo {...contactView} />;

    if (showMembersList) {
        return (
            <GroupMembersView
                contact={contact}
                currentUserId={currentUserId}
                canManageGroup={canManageGroup}
                groupMembers={groupMembers}
                membersLoading={membersLoading}
                chatStats={chatStats}
                token={token}
                interactiveOnlineUsers={interactiveOnlineUsers}
                onBack={() => {
                    setShowMembersList(false);
                    if (onCloseForcedContactInfo) {
                        onCloseForcedContactInfo(chatId);
                    }
                }}
                onEditGroup={() => {
                    setOpenGroupEditorFromMembers(true);
                    setShowMembersList(false);
                    setShowContactInfo(true);
                }}
                onOpenProfile={() => {
                    setShowMembersList(false);
                    onOpenProfile?.();
                }}
                onViewMember={(memberId) => {
                    setShowMembersList(false);
                    restoringFromInfoRef.current = true;
                    setViewingMemberId(memberId);
                }}
                onBanMember={handleBanMember}
            />
        );
    }

    return (
        <motion.div
            className="chat-room chat-room--fade-safe" style={{ position: 'relative' }} ref={roomRef}
            variants={chatRoomScreenVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onDragOver={(e) => {
                if (isContactBlocked || !externalFileUploadHandler) return;
                e.preventDefault();
                setDragUploadActive(true);
            }}
            onDragEnter={(e) => {
                if (isContactBlocked || !externalFileUploadHandler) return;
                e.preventDefault();
                setDragUploadActive(true);
            }}
            onDragLeave={(e) => {
                if (!dragUploadActive) return;
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragUploadActive(false);
                }
            }}
            onDrop={(e) => {
                if (isContactBlocked || !externalFileUploadHandler) return;
                e.preventDefault();
                setDragUploadActive(false);
                const file = e.dataTransfer?.files?.[0];
                if (file) externalFileUploadHandler(file);
            }}
            onPasteCapture={(e) => {
                if (isContactBlocked || !externalFileUploadHandler) return;
                const items = Array.from(e.clipboardData?.items || []);
                const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
                const pastedFile = imageItem?.getAsFile();
                if (pastedFile) {
                    e.preventDefault();
                    externalFileUploadHandler(pastedFile);
                }
            }}
        >
            <motion.div
                className="chat-room__enter-fade"
                initial={{ opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
            />
            {isSelectionModeActive ? (
                <div className="chat-room__header chat-room__header--selection" onPointerDownCapture={resetUploadPickerIfOpen}>
                    <div className="chat-room__selection-left">
                        <button
                            className="icon-btn chat-room__selection-close-btn"
                            onClick={() => setSelectedMessageIds([])}
                            aria-label="Cancel selection"
                            title="لغو انتخاب"
                            type="button"
                        >
                            <TelegramIcon name="close" size={20} />
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
                            <TelegramIcon name="copy" size={19} />
                        </button>
                        <button
                            type="button"
                            className="icon-btn"
                            onClick={handleOpenForwardSelected}
                            title="فوروارد پیام‌های انتخاب‌شده"
                            aria-label="Forward selected messages"
                        >
                            <TelegramIcon name="forward" size={19} />
                        </button>
                        {canDeleteAnySelected && (
                            <button
                                type="button"
                                className="icon-btn icon-btn--danger"
                                onClick={() => setConfirmDeleteSelected(true)}
                                title="حذف پیام‌های انتخاب‌شده"
                                aria-label="Delete selected messages"
                            >
                                <TelegramIcon name="delete" size={19} />
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="chat-room__header" onPointerDownCapture={resetUploadPickerIfOpen}>
                    <button className={cx('chat-room__back-btn', 'back-icon-btn', messagesScrolled && 'chat-room__back-btn--scrolled')} onClick={() => { maybeSaveScroll(chatId); onBack(); }} aria-label="Back" type="button"><ChevronLeft size={22} /></button>
                    <button className="icon-btn chat-room__close-btn" onClick={() => { maybeSaveScroll(chatId); onCloseChat(); }} aria-label="Back to empty" type="button"><ChevronLeft size={22} /></button>

                    <button
                        className="chat-room__header-clickable chat-room__header-clickable--full"
                        onClick={() => {
                            if (isSavedMessages || isOfficialChannel) return;
                            maybeSaveScroll(chatId);
                            if (onOpenContactInfo && chatId !== 'pending') {
                                onOpenContactInfo(chatId);
                            }
                            restoringFromInfoRef.current = true;
                            setOpenGroupEditorFromMembers(false);
                            setShowContactInfo(true);
                        }}
                        aria-label={isSavedMessages || isOfficialChannel ? '' : 'Open contact info'}
                        type="button"
                        style={isSavedMessages || isOfficialChannel ? { cursor: 'default' } : undefined}
                    >
                        <Avatar
                            name={contact.name}
                            size="sm"
                            online={isGroupChat || isSavedMessages || isContactBlocked ? undefined : Boolean((interactiveOnlineUsers && contact.chatId && interactiveOnlineUsers[contact.chatId]) || contact.online)}
                            savedMessages={isSavedMessages}
                            src={contact.avatar}
                        />
                        <div className="chat-room__header-info">
                            <div className="chat-room__contact-name" style={{ alignItems: 'center', gap: 6 }}>
                                <p className='chat-room__contact-name-2 emoji-font'>{contact.name}</p>
                                {!isSavedMessages && resolveVerified(contact.verified) ? <VerifiedBadge size={14} /> : null}
                            </div>
                            {!isSavedMessages && (
                                <div className={(!isGroupChat && !isContactBlocked && Boolean((interactiveOnlineUsers && contact.chatId && interactiveOnlineUsers[contact.chatId]) || contact.online)) ? 'chat-room__contact-status chat-room__contact-status--online' : 'chat-room__contact-status'}>
                                    {isOfficialChannel ? (
                                        <span style={{ color: 'var(--text-secondary)' }}>{toPersianDigits(chatStats?.totalMembers ?? 0)} عضو</span>
                                    ) : headerActivityLabel ? (
                                        <span className="status-online-text chat-header-typing" dir="rtl">
                                            <span>{headerActivityLabel}</span>
                                            <span className="chat-header-typing__dots" aria-hidden="true">
                                                <span className="chat-header-typing__dot" />
                                                <span className="chat-header-typing__dot" />
                                                <span className="chat-header-typing__dot" />
                                            </span>
                                        </span>
                                    ) : (isGroupChat ? (
                                        <span style={{ direction: 'rtl', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            <span className="status-online-text">{toPersianDigits(Math.max(1, chatStats?.onlineMembers ?? 1))} آنلاین</span>
                                            <span style={{ color: 'var(--text-muted)' }}>•</span>
                                            <span style={{ color: 'var(--text-secondary)' }}>{toPersianDigits(chatStats?.totalMembers ?? currentChat?.participantIds?.length ?? 0)} عضو</span>
                                        </span>
                                    ) : formatLastSeen(contact, { isContactBlocked, isInteractiveOnline: Boolean(interactiveOnlineUsers && contact.chatId && interactiveOnlineUsers[contact.chatId]) }))}
                                </div>
                            )}
                        </div>
                    </button>

                    {!isSavedMessages && !isOfficialChannel && chatId !== 'pending' && (
                        <div className="chat-room__header-actions" ref={menuRef}>
                            <button
                                className="icon-btn"
                                onClick={() => setChatMenuOpen((v) => !v)}
                                aria-label="More"
                                type="button"
                            >
                                <TelegramIcon name="more" size={20} />
                            </button>

                            {chatMenuOpen && (
                                <div
                                    className="popover popover--mini popover--right"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                >
                                    {isGroupChat && chatMenuSubmenu !== 'notifications' ? (
                                        <button
                                            className="popover__item"
                                            onClick={() => setChatMenuSubmenu('notifications')}
                                            type="button"
                                        >
                                            <TelegramIcon name="unmute" size={16} />
                                            اعلان‌ها
                                            <TelegramIcon name="next" size={16} style={{ marginInlineStart: 'auto', opacity: 0.5 }} />
                                        </button>
                                    ) : chatMenuSubmenu === 'notifications' ? (
                                        <>
                                            <button
                                                type="button"
                                                className="popover__item"
                                                onClick={() => setChatMenuSubmenu(null)}
                                                style={{ direction: 'rtl', justifyContent: 'flex-end', gap: 6, padding: '4px 10px 8px', fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}
                                            >
                                                <span>اعلان‌ها</span>
                                                <TelegramIcon name="previous" size={16} />
                                            </button>
                                            <button
                                                className="popover__item"
                                                onClick={() => {
                                                    setChatMenuOpen(false);
                                                    void setChatNotifyMode(chatId, 'all');
                                                }}
                                                type="button"
                                            >
                                                <TelegramIcon name="unmute" size={16} />
                                                همه پیام‌ها
                                                {notifyMode === 'all' && <TelegramIcon name="check" size={16} style={{ marginInlineStart: 'auto' }} />}
                                            </button>
                                            <button
                                                className="popover__item"
                                                onClick={() => {
                                                    setChatMenuOpen(false);
                                                    void setChatNotifyMode(chatId, 'mentions');
                                                }}
                                                type="button"
                                            >
                                                <TelegramIcon name="mention" size={16} />
                                                فقط منشن و پاسخ
                                                {notifyMode === 'mentions' && <TelegramIcon name="check" size={16} style={{ marginInlineStart: 'auto' }} />}
                                            </button>
                                            <button
                                                className="popover__item"
                                                onClick={() => {
                                                    setChatMenuOpen(false);
                                                    void setChatNotifyMode(chatId, 'muted');
                                                }}
                                                type="button"
                                            >
                                                <TelegramIcon name="mute" size={16} />
                                                بی‌صدا
                                                {notifyMode === 'muted' && <TelegramIcon name="check" size={16} style={{ marginInlineStart: 'auto' }} />}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className="popover__item"
                                            onClick={() => {
                                                setChatMenuOpen(false);
                                                void setChatNotifyMode(chatId, notifyMode === 'muted' ? 'all' : 'muted');
                                            }}
                                            type="button"
                                        >
                                            {notifyMode === 'muted' ? <TelegramIcon name="unmute" size={16} /> : <TelegramIcon name="mute" size={16} />}
                                            {notifyMode === 'muted' ? 'باصدا کردن' : 'بی‌صدا کردن'}
                                        </button>
                                    )}

                                    {canDeleteChat && chatMenuSubmenu !== 'notifications' && (
                                        <>
                                            <div style={{ height: 1, background: 'var(--glass-border)', margin: '4px 6px' }} />
                                            {isGroupChat ? (
                                                <>
                                                    <button
                                                        className="popover__item popover__item--danger"
                                                        onClick={openLeaveGroupConfirm}
                                                        type="button"
                                                    >
                                                        <TelegramIcon name="logout" size={16} />
                                                        خروج از گروه
                                                    </button>
                                                    {canManageGroup && (
                                                        <button
                                                            className="popover__item popover__item--danger"
                                                            onClick={openDeleteChatConfirm}
                                                            type="button"
                                                        >
                                                            <TelegramIcon name="delete" size={16} />
                                                            حذف گروه
                                                        </button>
                                                    )}
                                                </>
                                            ) : (
                                                <button
                                                    className="popover__item popover__item--danger"
                                                    onClick={openDeleteChatConfirm}
                                                    type="button"
                                                >
                                                    <TelegramIcon name="delete" size={16} />
                                                    حذف گفتگو
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {pinnedMessage && (
                <div
                    className="chat-room__pinned-bar"
                    onClick={() => {
                        if (messagesById.has(pinnedMessage.id)) {
                            scrollToMessage(pinnedMessage.id);
                        } else {
                            onJumpToMessage?.(chatId, pinnedMessage.id);
                        }
                    }}
                    role="button"
                    tabIndex={0}
                >
                    <div className="chat-room__pinned-bar__indicator" />
                    <TelegramIcon name="pin" size={16} className="chat-room__pinned-bar__icon" />
                    <div className="chat-room__pinned-bar__content">
                        <div className="chat-room__pinned-bar__title">
                            پیام سنجاق شده{pinnedMessage.senderName ? ` • ${pinnedMessage.senderName}` : ''}
                        </div>
                        <div className="chat-room__pinned-bar__text">
                            {(() => {
                                const pinnedFull = messagesById.get(pinnedMessage.id);
                                if (pinnedFull?.chessInvite) {
                                    return pinnedFull.chessInvite.shared ? '♟️ بازی شطرنج' : '♟️ دعوت به بازی شطرنج';
                                }
                                return pinnedMessage.text || (pinnedMessage.file ? `[فایل: ${pinnedMessage.file.fileName || 'پیوست'}]` : 'پیام');
                            })()}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="chat-room__pinned-bar__unpin"
                        title="برداشتن سنجاق"
                        aria-label="Unpin message"
                        onClick={(e) => {
                            e.stopPropagation();
                            setConfirmPin({ action: 'unpin' });
                        }}
                    >
                        <TelegramIcon name="close" size={16} />
                    </button>
                </div>
            )}

            <div className="chat-room__messages-Viewport" onPointerDownCapture={resetUploadPickerIfOpen}>
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
                        overflowX: 'hidden',
                        overflowY: replySwipeLocked ? 'hidden' : 'auto',
                        paddingBottom: composerHeight + 26,
                    }}
                >
                    <div className="chat-room__messages-inner">
                        <div ref={topSentinelRef} />
                        {!loading && (
                            <div className="messages-list-visible-wrap" style={{ display: 'contents', visibility: chatContentReady ? 'visible' : 'hidden' }}>
                                {(loadingOlderMessages || localLoadingOlder) && (
                                    <div className="chat-range-loader-wrap chat-range-loader-wrap--top">
                                        <span className="chat-range-loader chat-range-loader--active" />
                                    </div>
                                )}
                                {renderedMessageItems}
                                {(loadingNewerMessages || localLoadingNewer) && (
                                    <div className="chat-range-loader-wrap chat-range-loader-wrap--bottom">
                                        <span className="chat-range-loader chat-range-loader--active" />
                                    </div>
                                )}
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                </div>
            </div>

            {loading && (
                <div className="chat-room__skeleton-layer">
                    <ChatMessagesSkeleton />
                </div>
            )}

            {(jumpingToMessage || resolvingMention) && (
                <div
                    className="chat-room__jump-overlay"
                    onClick={() => {
                        onCancelJumpToMessage?.();
                        cancelMentionResolve();
                    }}
                >
                    <div className="chat-room__jump-dim" aria-hidden="true" />
                    <div className="chat-room__jump-box" onClick={(e) => e.stopPropagation()}>
                        <span className="chat-range-loader chat-range-loader--active chat-room__jump-spinner" />
                    </div>
                </div>
            )}

            {msgMenu && (() => {
                const activeMsg = messagesById.get(msgMenu.id);
                if (!activeMsg) return null;
                const activeMsgIsMine = activeMsg.senderId === currentUserId;
                const canDeleteActiveMsg = activeMsgIsMine || canDeleteOthersMessages;
                const showSeenByAction = isGroupChat && activeMsgIsMine && !isOfficialChannel;
                const canReplyInMessageMenu = !(isOfficialChannel && !isAdminUser);
                const hasCaption = Boolean((activeMsg.text || '').trim());
                const isChessMsg = Boolean(activeMsg.chessInvite);
                const showCopyAction = !isChessMsg && (!activeMsg.file || hasCaption);
                const showDownloadAction = Boolean(activeMsg.file?.fileId && msgMenu.isFileDownloaded);
                const canTogglePin = pinnedMessage?.id === activeMsg.id
                    || (isOfficialChannel ? isVerifiedUser : !isGroupChat || canManageGroup);
                const seenRows = seenByUsersByMessage[activeMsg.id] || [];
                const seenLoaded = Array.isArray(seenByUsersByMessage[activeMsg.id]);
                const seenByRawCount = Array.isArray((activeMsg as any).seenBy) ? (activeMsg as any).seenBy.length : 0;
                const activeIsSeen = Boolean(activeMsg.seen || seenRows.length > 0 || seenByRawCount > 0 || Number((activeMsg as any).seenCount || 0) > 0);
                const menuReactions = (optimisticReactions[activeMsg.id] ?? activeMsg.reactions ?? []) as unknown as ReactionEntry[];
                const myMenuReaction = menuReactions.find((r) => (r.userIds || []).includes(currentUserId));
                const roomWidth = roomRef.current?.getBoundingClientRect().width ?? window.innerWidth;
                const pickerOverflow = Math.max(0, msgMenu.left + 274 - (roomWidth - 8));

                return (
                    <div ref={msgMenuRef} className="msg-menu-anchor"
                        style={{ top: msgMenu.top, left: msgMenu.left }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}>
                        <div className="msg-menu-picker" style={{ left: -pickerOverflow }}>
                            <ReactionPicker
                                messageId={activeMsg.id}
                                currentReaction={myMenuReaction?.emoji}
                                onReact={(id, emoji) => { void handleReact(id, emoji); }}
                                onDeleteReaction={(id) => { void handleDeleteReaction(id); }}
                                onClose={() => setMsgMenu(null)}
                            />
                        </div>
                        <div className="popover popover--mini msg-menu__panel">
                            {showSeenByAction && (
                                <button className="popover__item popover__item--seen" onClick={() => {
                                    loadSeenBy(activeMsg.id);
                                    setSeenByMenu({ id: activeMsg.id, top: msgMenu.top, left: msgMenu.left });
                                    setMsgMenu(null);
                                }} type="button">
                                    <span className="popover__seen-label">
                                        <TelegramIcon name="eye-outline" size={16} />
                                        <span>بازدیدها</span>
                                    </span>
                                    {(seenRows.length > 0 || (!seenLoaded && activeIsSeen)) && (
                                        <span className="popover__seen-avatars">
                                            {seenRows.length > 0
                                                ? seenRows.slice(0, 3).map((u) => (
                                                    <Avatar key={u.chatId} name={u.name || u.username || ''} src={u.avatar || ''} size="xxs" />
                                                ))
                                                : [0, 1, 2].map((i) => (
                                                    <span key={i} className="popover__seen-skeleton" aria-hidden />
                                                ))}
                                        </span>
                                    )}
                                </button>
                            )}
                            {isGroupChat && !isOfficialChannel && !activeMsgIsMine && menuReactions.length > 0 && (
                                <button className="popover__item popover__item--seen" onClick={() => {
                                    setReactionListMenu({ id: activeMsg.id, top: msgMenu.top, left: msgMenu.left });
                                    setMsgMenu(null);
                                }} type="button">
                                    <span className="popover__seen-label">
                                        <TelegramIcon name="heart-outline" size={16} />
                                        <span>واکنش‌ها</span>
                                    </span>
                                    <span className="popover__seen-emojis">
                                        {menuReactions.slice(0, 3).map((r, index) => (
                                            <span key={`${r.emoji}-${index}`}>{r.emoji}</span>
                                        ))}
                                    </span>
                                </button>
                            )}
                            {canReplyInMessageMenu && (() => {
                                const activeQuote = customSelection.ui?.messageId === activeMsg.id
                                    ? customSelection.getQuoteSelection()
                                    : null;
                                return (
                                    <button className="popover__item" onClick={() => {
                                        if (activeQuote) beginQuoteReply(activeQuote.messageId, activeQuote.text);
                                        else beginReply(activeMsg);
                                    }} type="button"><TelegramIcon name={activeQuote ? 'quote' : 'reply'} size={16} />{activeQuote ? 'نقل‌قول و پاسخ' : 'پاسخ'}</button>
                                );
                            })()}
                            {canTogglePin && (
                                <button
                                    className="popover__item"
                                    onClick={() => {
                                        const targetId = activeMsg.id;
                                        setMsgMenu(null);
                                        setConfirmPin({
                                            action: pinnedMessage?.id === targetId ? 'unpin' : 'pin',
                                            messageId: targetId,
                                        });
                                    }}
                                    type="button"
                                >
                                    {pinnedMessage?.id === activeMsg.id ? <TelegramIcon name="unpin" size={16} /> : <TelegramIcon name="pin" size={16} />}
                                    {pinnedMessage?.id === activeMsg.id ? 'برداشتن سنجاق' : 'سنجاق کردن'}
                                </button>
                            )}
                            <button className="popover__item" onClick={() => openForwardModal(activeMsg.id)} type="button"><TelegramIcon name="forward" size={16} />فوروارد</button>
                            <button
                                className="popover__item"
                                onClick={() => {
                                    clearTextSelection();
                                    setMsgMenu(null);
                                    setSelectedMessageIds([activeMsg.id]);
                                }}
                                type="button"
                            >
                                <TelegramIcon name="select" size={16} />
                                انتخاب
                            </button>
                            {activeMsg.senderId === currentUserId && !activeMsg.forwardedFrom && !isChessMsg && (
                                <button className="popover__item" onClick={() => beginEdit(activeMsg)} type="button"><TelegramIcon name="edit" size={16} />ویرایش</button>
                            )}
                            {showCopyAction && (<button className="popover__item" onClick={() => doCopyMessage(activeMsg)} type="button"><TelegramIcon name="copy" size={16} />کپی</button>)}
                            {showDownloadAction && (<button className="popover__item" onClick={() => doDownloadMessageFile(activeMsg)} type="button"><TelegramIcon name="download" size={16} />دانلود</button>)}
                            {canDeleteActiveMsg && (
                                <button className="popover__item popover__item--danger" onClick={() => doDeleteMessage(activeMsg.id)} type="button">
                                    <TelegramIcon name="delete" size={16} />حذف
                                </button>
                            )}
                        </div>
                    </div>
                );
            })()}

            {seenByMenu && (() => {
                const seenMsg = messagesById.get(seenByMenu.id);
                const rows = seenByUsersByMessage[seenByMenu.id] || [];
                const menuReactions = (optimisticReactions[seenByMenu.id] ?? seenMsg?.reactions ?? []) as unknown as ReactionEntry[];
                const emojiForUser = (userId: string) =>
                    menuReactions.find((r) => (r.userIds || []).includes(userId))?.emoji || '';
                const selfReaction = emojiForUser(currentUserId);
                const displayRows: SeenByUser[] = selfReaction && currentUser
                    ? [
                        {
                            chatId: currentUserId,
                            name: currentUser.name || currentUser.username || '',
                            username: currentUser.username,
                            avatar: currentUser.avatar,
                            verified: resolveVerified(currentUser.verified),
                        },
                        ...rows.filter((u) => u.chatId !== currentUserId),
                    ]
                    : rows;
                const seenRank = (userId: string) => {
                    if (!emojiForUser(userId)) return 0;
                    return userId === currentUserId ? 2 : 1;
                };
                const sortedRows = [...displayRows].sort((a, b) => seenRank(b.chatId) - seenRank(a.chatId));

                return (
                    <div ref={seenByMenuRef} className="popover popover--mini seen-by-menu"
                        style={{ top: seenByMenu.top, left: seenByMenu.left, right: 'auto', position: 'absolute', zIndex: 52 }}
                        onClick={(e) => e.stopPropagation()}>
                        <div className="seen-by-menu__header">
                            دیده شده توسط {toPersianDigits(rows.length)} نفر
                        </div>
                        <div className="seen-by-menu__body">
                            {displayRows.length === 0 ? (
                                <div className="seen-by-menu__empty">
                                    هنوز کسی این پیام را ندیده است
                                </div>
                            ) : (
                                sortedRows.map((u) => {
                                    const emoji = emojiForUser(u.chatId);
                                    return (
                                        <button key={u.chatId} className="seen-by-menu__row" type="button"
                                            onClick={() => {
                                                setSeenByMenu(null); setReactionListMenu(null);
                                                openMember(u.chatId);
                                            }}>
                                            <Avatar name={u.name || u.username || ''} src={u.avatar || ''} size="xs" />
                                            <span className="seen-by-menu__name">
                                                <span>{u.name || u.username || u.chatId}</span>
                                                {resolveVerified(u.verified) && <VerifiedBadge size={13} />}
                                            </span>
                                            {emoji && <span className="seen-by-menu__emoji">{emoji}</span>}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                );
            })()}

            {reactionListMenu && (() => {
                const listMsg = messagesById.get(reactionListMenu.id);
                const listReactions = (optimisticReactions[reactionListMenu.id] ?? listMsg?.reactions ?? []) as unknown as ReactionEntry[];
                const reactorRows = listReactions.flatMap((reaction) => (reaction.userIds || []).map((userId) => {
                    const member = groupMembers[userId];
                    return {
                        userId,
                        emoji: reaction.emoji,
                        name: member?.name || userId,
                        avatar: member?.avatar || '',
                        verified: resolveVerified(member?.verified),
                    };
                }));

                return (
                    <div ref={reactionListMenuRef} className="popover popover--mini seen-by-menu"
                        style={{ top: reactionListMenu.top, left: reactionListMenu.left, right: 'auto', position: 'absolute', zIndex: 52 }}
                        onClick={(e) => e.stopPropagation()}>
                        <div className="seen-by-menu__header">
                            واکنش‌ها · {toPersianDigits(reactorRows.length)} نفر
                        </div>
                        <div className="seen-by-menu__body">
                            {reactorRows.length === 0 ? (
                                <div className="seen-by-menu__empty">هنوز واکنشی ثبت نشده است</div>
                            ) : (
                                reactorRows.map((row) => (
                                    <button key={`${row.userId}-${row.emoji}`} className="seen-by-menu__row" type="button"
                                        onClick={() => {
                                            setReactionListMenu(null);
                                            openMember(row.userId);
                                        }}>
                                        <Avatar name={row.name} src={row.avatar} size="xs" />
                                        <span className="seen-by-menu__name">
                                            <span>{row.name}</span>
                                            {row.verified && <VerifiedBadge size={13} />}
                                        </span>
                                        <span className="seen-by-menu__emoji">{row.emoji}</span>
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
                    chatId={chatId}
                    onClose={closeMediaViewer}
                />
            )}
            {openedVideo && (
                <VideoMediaViewer
                    videoUrl={openedVideo.url}
                    downloadFile={openedVideo.file}
                    token={token}
                    chatId={chatId}
                    onClose={closeMediaViewer}
                />
            )}

            {reactionMenu && (() => {
                const reactionMsg = messagesById.get(reactionMenu.id);
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
                    <div ref={reactionMenuRef} className="reaction-menu-anchor"
                        style={{ top: reactionMenu.top, left: reactionMenu.left }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}>
                        <ReactionPicker
                            messageId={reactionMsg.id}
                            currentReaction={myReaction?.emoji}
                            onReact={(id, emoji) => handleReact(id, emoji)}
                            onDeleteReaction={(id) => handleDeleteReaction(id)}
                            onClose={() => setReactionMenu(null)}
                        />

                        {isGroupChat && !isOfficialChannel && reactionUsersList.length > 0 && (
                            <div className="popover popover--mini reaction-menu__list">
                                <div className="reaction-menu__header">
                                    واکنش‌ها
                                    ({toPersianDigits(reactionUsersList.length)})
                                </div>
                                <div className="reaction-menu__body">
                                    {reactionUsersList.map((ru, i) => (
                                        <button key={i}
                                            className="reaction-menu__row"
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setReactionMenu(null);
                                                openMember(ru.userId);
                                            }}
                                        >
                                            <Avatar name={ru.name} size="xs" src={ru.avatar} />
                                            <span className="reaction-menu__name">
                                                <span>{ru.name}</span>
                                                {ru.verified && <VerifiedBadge size={13} />}
                                            </span>
                                            <span className="reaction-menu__emoji">{ru.emoji}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })()}

            <div
                className="chat-room__floating-actions"
                style={{ position: 'absolute', right: 12, bottom: scrollButtonBottom, zIndex: 12 }}
            >
                <AnimatePresence>
                    {visibleUnreadReactionIds.length > 0 && (
                        <motion.button
                            key="floating-reaction-btn"
                            type="button"
                            aria-label="مشاهده واکنش‌های جدید"
                            onClick={handleStepUnreadReaction}
                            className="chat-room__send-btn chat-room__send-btn--disabled chat-room__floating-btn chat-room__floating-btn--reaction"
                            animate={{ opacity: 1, y: 0 }}
                            initial={{ opacity: 0, y: 8 }}
                            exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: 0.14, ease: 'easeOut' }}
                        >
                            <TelegramIcon name="heart-outline" size={19} />
                            <span className="chat-room__scroll-badge">
                                {toPersianDigits(visibleUnreadReactionIds.length)}
                            </span>
                        </motion.button>
                    )}

                    {visibleUnreadMentionIds.length > 0 && (
                        <motion.button
                            key="floating-mention-btn"
                            type="button"
                            aria-label="مشاهده منشن‌ها و پاسخ‌های جدید"
                            onClick={handleStepUnreadMention}
                            className="chat-room__send-btn chat-room__send-btn--disabled chat-room__floating-btn"
                            animate={{ opacity: 1, y: 0 }}
                            initial={{ opacity: 0, y: 8 }}
                            exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: 0.14, ease: 'easeOut' }}
                        >
                            <TelegramIcon name="mention" size={19} />
                            <span className="chat-room__scroll-badge">
                                {toPersianDigits(visibleUnreadMentionIds.length)}
                            </span>
                        </motion.button>
                    )}

                    {(newMsgCount > 0 || showScrollBtn || isJumpingToLatest) && (
                        <motion.button
                            key="floating-scroll-btn"
                            type="button"
                            aria-label="Jump to latest messages"
                            onClick={jumpToLatest}
                            disabled={isJumpingToLatest}
                            className="chat-room__send-btn chat-room__send-btn--disabled chat-room__floating-btn"
                            animate={{ opacity: 1, y: 0 }}
                            initial={{ opacity: 0, y: 8 }}
                            exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: 0.14, ease: 'easeOut' }}
                        >
                            {isJumpingToLatest ? (
                                <span className="chat-room__scroll-btn-spinner" aria-hidden="true" />
                            ) : (
                                <ChevronDown size={20} />
                            )}
                            {newMsgCount > 0 && (
                                <span className="chat-room__scroll-badge">{toPersianDigits(newMsgCount)}</span>
                            )}
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>

            <div className="chat-room__composer-host" ref={composerHostRef}>
                <ChatComposer
                    key={`${chatId}:${editingId ?? 'compose'}`}
                    chatId={chatId}
                    isContactBlocked={isContactBlocked}
                    canSend={canSendInOfficialChannel}
                    blockedMessage={isUserBlocked?.(contact) ? 'شما این کاربر را بلاک کرده‌اید.' : 'این کاربر شما را بلاک کرده است.'}
                    replyTo={replyTo}
                    editingId={editingId}
                    editDraft={editingId ? (messagesById.get(editingId)?.text ?? '') : ''}
                    replyPreviewText={replyTo ? getReplyPreviewText(replyTo) : ''}
                    pendingForwardDraft={pendingForwardDraft}
                    forwardPreviewText={getForwardPreviewText(pendingForwardDraft)}
                    forwardPreviewTitle={forwardPreviewTitle}
                    uploadFile={externalFileUploadHandler}
                    mentionCandidates={mentionCandidates}
                    onSend={handleComposerSend}
                    onCancelReplyEdit={handleCancelReplyEdit}
                    onCancelForward={handleCancelForward}
                    onTypingChange={handleTypingChange}
                    onRegisterUploadFile={handleRegisterUploadFile}
                    onInputFocus={handleInputFocus}
                    notificationsMuted={notifyMode === 'muted'}
                    onToggleNotifications={isOfficialChannel && !isAdminUser ? () => void setChatNotifyMode(chatId, notifyMode === 'muted' ? 'all' : 'muted') : undefined}
                />
            </div>

            <ForwardModal
                isOpen={forwardModalOpen}
                chats={chats}
                currentUserId={currentUserId}
                currentUserIsAdmin={isAdminUser}
                forwardCount={forwardingMessageIds.length || (forwardingMessageId ? 1 : 0)}
                onClose={() => {
                    setForwardModalOpen(false);
                    setForwardingMessageIds([]);
                    setForwardingMessageId(null);
                }}
                onSelectTargetChat={handleForwardFromModal}
                onSelectChat={onSelectChat}
            />

            <GroupJoinSheet
                open={Boolean(invitePreviewGroup)}
                group={invitePreviewGroup}
                joining={joiningPreviewGroup}
                error={invitePreviewError}
                onClose={() => {
                    if (joiningPreviewGroup) return;
                    setInvitePreviewGroup(null);
                    setInvitePreviewError('');
                }}
                onConfirmJoin={handleConfirmJoinFromChat}
            />

            {customSelection.ui && (
                <>
                    <div
                        className={`cs-handle cs-handle--dir-${customSelection.ui.startDir}${customSelection.ui.isMine ? ' cs-handle--mine' : ''}`}
                        style={{
                            left: customSelection.ui.start.x,
                            top: customSelection.ui.start.y,
                        }}
                        {...customSelection.handleProps('start')}
                    />
                    <div
                        className={`cs-handle cs-handle--dir-${customSelection.ui.endDir}${customSelection.ui.isMine ? ' cs-handle--mine' : ''}`}
                        style={{
                            left: customSelection.ui.end.x,
                            top: customSelection.ui.end.y,
                        }}
                        {...customSelection.handleProps('end')}
                    />
                    <div
                        className="selection-bar"
                        style={{ top: customSelection.ui.bar.top, left: customSelection.ui.bar.left }}
                        onPointerDown={(e) => e.preventDefault()}
                    >
                        {customSelection.ui.messageId && canSwipeToReply && !isContactBlocked && (
                            <button
                                type="button"
                                className="selection-bar__btn"
                                onClick={() => {
                                    const quote = customSelection.getQuoteSelection();
                                    if (!quote) return;
                                    beginQuoteReply(quote.messageId, quote.text, true);
                                }}
                            >
                                <TelegramIcon name="quote" size={16} />
                                نقل‌قول
                            </button>
                        )}
                        <button
                            type="button"
                            className="selection-bar__btn"
                            onClick={async () => {
                                const copied = await customSelection.copySelection();
                                if (!copied) return;
                                setCopyToast('متن کپی شد');
                                window.setTimeout(() => setCopyToast(null), 2000);
                            }}
                        >
                            <TelegramIcon name="copy" size={16} />
                            کپی
                        </button>
                        <button type="button" className="selection-bar__btn" onClick={customSelection.selectAll}>
                            انتخاب همه
                        </button>
                    </div>
                </>
            )}

            {copyToast && (
                <div className="chat-room__toast">
                    {copyToast}
                </div>
            )}

            <AnimatePresence>
                {confirmDeleteSelected && (
                    <ConfirmDialog
                        title={`حذف ${toPersianDigits(deletableSelectedIds.length)} پیام؟`}
                        text={`آیا از حذف ${toPersianDigits(deletableSelectedIds.length)} پیام انتخاب‌شده اطمینان دارید؟ پیام‌ها برای همه حذف خواهند شد.`}
                        confirmLabel="حذف"
                        onCancel={() => setConfirmDeleteSelected(false)}
                        onConfirm={() => {
                            setConfirmDeleteSelected(false);
                            const idsToDelete = [...deletableSelectedIds];
                            setSelectedMessageIds([]);
                            for (const id of idsToDelete) {
                                cleanupMessageCache(id);
                            }
                            if (onDeleteMessages) {
                                void onDeleteMessages(idsToDelete);
                            } else {
                                for (const id of idsToDelete) {
                                    onDeleteMessage(id);
                                }
                            }
                        }}
                    />
                )}
            </AnimatePresence>

            {dragUploadActive && (
                <div className="chat-room__drag-upload-overlay">
                    <div className="chat-room__drag-upload-overlay-content">
                        <TelegramIcon name="cloud-download" size={30} />
                        <span>فایل را برای آپلود رها کنید</span>
                    </div>
                </div>
            )}

            <AnimatePresence>
                {confirmDeleteChat && (
                    <ConfirmDialog
                        overlayRef={confirmDeleteChatRef}
                        title={isGroupChat ? 'گروه حذف شود؟' : 'گفتگو حذف شود؟'}
                        text={isGroupChat ? 'گروه و تمام پیام‌ها برای همه حذف خواهد شد.' : 'این عمل گفتگو و تمام پیام‌ها را برای هر دو کاربر حذف خواهد کرد.'}
                        confirmLabel="حذف"
                        onCancel={() => setConfirmDeleteChat(false)}
                        onConfirm={doDeleteChat}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {confirmLeaveGroup && (
                    <ConfirmDialog
                        overlayRef={confirmLeaveGroupRef}
                        title="خروج از گروه؟"
                        text="آیا می‌خواهید از گروه خارج شوید؟ گروه برای شما حذف خواهد شد."
                        confirmLabel="خروج"
                        onCancel={() => setConfirmLeaveGroup(false)}
                        onConfirm={doLeaveGroup}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {confirmDeleteMsg && (
                    <ConfirmDialog
                        overlayRef={confirmDeleteMsgRef}
                        title="این پیام حذف شود؟"
                        text="این عمل پیام را کامل حذف میکند."
                        confirmLabel="حذف"
                        onCancel={() => setConfirmDeleteMsg(null)}
                        onConfirm={confirmDeleteMessage}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {confirmPin && (
                    <ConfirmDialog
                        overlayRef={confirmPinRef}
                        title={confirmPin.action === 'pin' ? 'پیام سنجاق شود؟' : 'سنجاق برداشته شود؟'}
                        text={confirmPin.action === 'pin'
                            ? 'این پیام در بالای گفتگو سنجاق میشود.'
                            : 'پیام سنجاق‌شده از بالای گفتگو برداشته میشود.'}
                        confirmLabel={confirmPin.action === 'pin' ? 'سنجاق' : 'برداشتن'}
                        onCancel={() => setConfirmPin(null)}
                        onConfirm={() => {
                            const action = confirmPin;
                            setConfirmPin(null);
                            if (action.action === 'pin' && action.messageId) {
                                void onPinMessage?.(chatId, action.messageId);
                            } else {
                                void onUnpinMessage?.(chatId);
                            }
                        }}
                    />
                )}
            </AnimatePresence>

        </motion.div>
    );
}
