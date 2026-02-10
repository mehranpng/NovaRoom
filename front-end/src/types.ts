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

export interface Chat {
    id: string;
    participantIds: string[];
    lastMessage?: {
        text: string;
        senderId: string;
        timestamp: Date;
    };
    unreadCount: number;
}

export type View = 'chatList' | 'chatRoom' | 'profile';
