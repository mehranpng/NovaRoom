export interface User {
  id: string;
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
  lastMessage?: Message;
  unreadCount: number;
}

export type View = 'chatList' | 'chatRoom' | 'profile';
