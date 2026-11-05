export type PrivacyVisibility = 'everyone' | 'friends' | 'nobody';

export interface User {
    chatId: string;
    username: string;
    name: string;
    bio: string;
    avatar: string;
    online: boolean;
    lastSeen?: number | string | null;
    lastSeenCategory?: 'recently' | 'within_week' | 'within_month' | 'long_time_ago' | null;
    lastSeenVisibility?: PrivacyVisibility;
    avatarVisibility?: PrivacyVisibility;
    bioVisibility?: PrivacyVisibility;
    hideOnlineStatus?: boolean;
    verified?: boolean;
    registrationDate?: string;
    adminLevel?: 'admin0' | 'admin1' | null;
    createdBy?: string;
    deletionScheduledFor?: number | null;
}

export interface MessageReply {
    id: string;
    senderId: string;
    text: string;
}

export interface PinnedMessage {
    id: string;
    senderId: string;
    senderName?: string;
    text: string;
    timestamp: number;
    file?: FileMetadata;
    pinnedBy?: string;
    pinnedAt?: number;
}

export interface MessageReaction {
    userId: string;
    emoji: string;
}

export interface ForwardedFrom {
    originalSenderId: string;
    originalSenderName?: string;
    name?: string;
    username?: string;
}

export interface FileMetadata {
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    uploadedAt: string;
    title?: string;
    artist?: string;
    coverArtUrl?: string;
    coverArtFileId?: string;
    previewUrl?: string;
    previewFileId?: string;
    width?: number;
    height?: number;
    duration?: number;
    localUrl?: string;
}

export type PendingAttachment = {
    file: File;
    width: number;
    height: number;
    duration: number;
    isEdited: boolean;
    reEdit?: () => void;
};

export interface Message {
    id: string;
    clientId?: string;
    chatId: string;
    senderId: string;
    text: string;
    timestamp: number;
    seen: boolean;
    deliveryStatus?: 'sending' | 'sent';
    replyTo?: MessageReply;
    edited?: boolean;
    reactions?: MessageReaction[];
    forwardedFrom?: ForwardedFrom;
    file?: FileMetadata;
    reasoningContent?: string;
    reasoningEnabled?: boolean;
    isStreaming?: boolean;
    streamCompleted?: boolean;
    reasoningDurationSec?: number;
    aiModelKey?: AIModelKey;
    aiModelName?: string;
    searchEnabled?: boolean;
    searchStatus?: 'searching' | 'completed';
    searchSources?: AISearchSource[];
    analyzingAttachment?: boolean;
    aiAttachment?: AIAttachmentMeta;
    chessInvite?: ChessInvite;
    upload?: { phase: 'uploading' | 'encrypting'; progress: number };
    forwarding?: boolean;
}

export interface ChatLastMessage {
    id?: string;
    text: string;
    senderId: string;
    
    timestamp: number;
    file?: FileMetadata;
}

export type PendingForwardDraft = {
    sourceChatId: string;
    messageId: string;
    messageIds?: string[];
    sourceChatName?: string;
    previewText?: string;
    previewFile?: FileMetadata | null;
};

export interface Chat {
    otherUser: any;
    id: string;
    participantIds: string[];
    chatType?: 'direct' | 'group';
    lastMessage?: ChatLastMessage | null;
    pinnedMessage?: PinnedMessage | null;
    unreadCount: number;
}

export interface AIChatSummary {
    id: string;
    title: string;
    summary?: string;
    updatedAt: number;
}

export type AIModelKey = 'nova-flash' | 'nova-pro';

export interface AISearchSource {
    index: number;
    title: string;
    url: string;
    domain: string;
    snippet: string;
}

export interface AIAttachmentMeta {
    tempFileId?: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    isImage: boolean;
    previewUrl?: string;
}

export interface AIUsageStatus {
    dateKey: string;
    resetTimezone: string;
    aiEnabled?: boolean;
    aiDisabledMessage?: string;
    tokens: {
        used?: number;
        remaining?: number;
        limit?: number;
        usedPercent: number;
        remainingPercent: number;
        exhausted: boolean;
    };
    files: {
        used: number;
        remaining: number;
        limit: number;
    };
    search: {
        used: number;
        remaining: number;
        limit: number;
    };
}

export interface AIMemoryItem {
    id: string;
    content: string;
    updatedAt: number;
}


export type ChessColor = 'white' | 'black';

export type ChessEmote = 'cry' | 'laugh' | 'mad' | 'nice' | 'cunning' | 'trol';

export interface ChessPlayerInfo {
    chatId: string;
    name: string;
    avatar: string;
    elo?: number | null;
    verified?: boolean;
    isGuest?: boolean;
}

export interface ChessRatingChange {
    before: number;
    after: number;
    delta: number;
}

export interface ChessGameView {
    id: string;
    status: 'waiting' | 'active' | 'finished';
    creatorId: string;
    invitedChatId: string | null;
    inviteToken?: string | null;
    rated?: boolean;
    ratingChanges?: {
        white: ChessRatingChange;
        black: ChessRatingChange;
    } | null;
    players: { white: string | null; black: string | null };
    playerInfo?: Record<string, ChessPlayerInfo>;
    timeControl: string;
    baseMs: number;
    incMs: number;
    moves: { uci: string; san: string }[];
    fen: string;
    turn: ChessColor;
    clocks: { white: number; black: number } | null;
    lastMoveAt: number;
    firstMoveDeadline?: number | null;
    disconnectDeadline?: number | null;
    disconnectTarget?: ChessColor | 'double' | null;
    serverNow: number;
    ply: number;
    lastMove: { from: string; to: string } | null;
    result: string | null;
    reason: string | null;
    drawOfferedBy: ChessColor | null;
    inCheck: boolean;
    online: { white: boolean; black: boolean };
    createdAt?: number;
    finishedAt?: number | null;
}

export interface ChessLeaderboardStats {
    rank?: number | null;
    elo: number;
    wins: number;
    losses: number;
    draws: number;
    gamesPlayed: number;
}

export interface ChessLeaderboardEntry extends ChessLeaderboardStats {
    rank: number;
    user: User & { blockedByMe?: boolean; blockedByOther?: boolean };
}

export interface ChessEvent {
    kind: 'move' | 'game_over' | 'draw_offered' | 'draw_declined' | 'opponent_joined' | 'presence';
    by?: ChessColor;
    san?: string;
    uci?: string;
    capture?: boolean;
    castle?: boolean;
    promotion?: boolean;
    check?: boolean;
    result?: string;
    reason?: string;
}

export interface ChessInvite {
    gameId: string;
    timeControl: string;
    shared?: boolean;
}

export type View = 'chatList' | 'chatRoom' | 'newChat' | 'profile' | 'profileEdit' | 'settings' | 'settingsDevices' | 'settingsTheme' | 'settingsLogs' | 'settingsDataStorage' | 'settingsPrivacy' | 'settingsAdmin' | 'settingsAdminPanel' | 'settingsAdminLinks' | 'chess';
