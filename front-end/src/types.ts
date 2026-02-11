export interface User {
    chatId: string;
    username: string;
    name: string;
    bio: string;
    avatar: string;
    online: boolean;
}

export interface Message {
    id: string;
    chatId: string;
    senderId: string;
    text: string;
    timestamp: number;
    seen: boolean;
}

export interface ChatLastMessage {
    text: string;
    senderId: string;
    /** epoch ms */
    timestamp: number;
}

export interface Chat {
    otherUser: any;
    id: string;
    participantIds: string[];
    lastMessage?: ChatLastMessage;
    unreadCount: number;
}

export type View = 'chatList' | 'chatRoom' | 'profile';
