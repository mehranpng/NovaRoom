export interface User {
    chatId: string;
    username: string;
    name: string;
    bio: string;
    avatar: string;
    online: boolean;
    verified?: boolean;
    createdAt?: string | number;
    birthDate?: string;
}

export interface MessageReply {
    id: string;
    senderId: string;
    text: string;
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
    sourceChatId?: string;
}

export interface ChatLastMessage {
    id?: string;
    text: string;
    senderId: string;
    /** epoch ms */
    timestamp: number;
}

export interface Chat {
    otherUser: any;
    id: string;
    participantIds: string[];
    lastMessage?: ChatLastMessage | null;
    unreadCount: number;
}

export type View = 'chatList' | 'chatRoom' | 'profile';
