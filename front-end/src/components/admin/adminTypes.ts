export interface AdminAISettings {
    enabled: boolean;
    dailyTokenLimit: number;
    dailySearchLimit: number;
    dailyFileLimit: number;
    disabledMessage: string;
}

export interface AdminUserAILimits {
    mode: 'global' | 'custom';
    dailyTokenLimit: number;
    dailySearchLimit: number;
    dailyFileLimit: number;
    globalDefaults?: {
        dailyTokenLimit: number;
        dailySearchLimit: number;
        dailyFileLimit: number;
    };
}

export interface AdminUserAIUsage {
    tokensUsed: number;
    searchUsed: number;
    filesUsed: number;
}

export interface AdminUserItem {
    chatId: string;
    name: string;
    username: string;
    avatar: string;
    verified: boolean;
    adminLevel: 'admin0' | 'admin1' | null;
    online?: boolean;
    registrationDate?: string;
    sessionsCount?: number;
    deletionStatus?: 'scheduled' | 'purging' | null;
}

export interface AdminUserDetailData extends AdminUserItem {
    registrationDate?: string;
    createdAt?: number | null;
    online: boolean;
    lastSeen?: number | null;
    email?: string | null;
    sessionsCount: number;
    hasPassword: boolean;
    aiLimits?: AdminUserAILimits;
    aiUsage?: AdminUserAIUsage;
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
