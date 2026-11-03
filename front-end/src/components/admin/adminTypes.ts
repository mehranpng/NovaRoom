export interface AdminUserItem {
    chatId: string;
    name: string;
    username: string;
    avatar: string;
    verified: boolean;
    adminLevel: 'admin0' | 'admin1' | null;
}

export interface AdminUserDetailData extends AdminUserItem {
    registrationDate?: string;
    createdAt?: number | null;
    online: boolean;
    lastSeen?: number | null;
    email?: string | null;
    sessionsCount: number;
    hasPassword: boolean;
}

export interface RegisterLink {
    id: string;
    path: string;
    expiresAt: string;
    createdAt: string;
    createdBy: string;
    createdByUsername: string;
    mine: boolean;
}
