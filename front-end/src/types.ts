export interface User {
    chatId: string;
    username: string;
    name: string;
    bio: string;
    avatar: string;
    online: boolean;
    verified?: boolean;
    registrationDate?: string;
}

export interface MessageReply {
    id: string;
    senderId: string;
    text: string;
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
}

export interface Message {
    id: string;
    chatId: string;
    senderId: string;
    text: string;
    timestamp: number;
    seen: boolean;
    replyTo?: MessageReply;
    edited?: boolean;
    reactions?: MessageReaction[];
    forwardedFrom?: ForwardedFrom;
    file?: FileMetadata;
}

export interface ChatLastMessage {
    id?: string;
    text: string;
    senderId: string;
    /** epoch ms */
    timestamp: number;
    file?: FileMetadata;
}

export interface Chat {
    otherUser: any;
    id: string;
    participantIds: string[];
    chatType?: 'direct' | 'group';
    lastMessage?: ChatLastMessage | null;
    unreadCount: number;
}

export interface AIChatSummary {
    id: string;
    title: string;
    summary?: string;
    updatedAt: number;
}

export type View = 'chatList' | 'chatRoom' | 'profile';
