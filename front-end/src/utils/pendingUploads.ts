import type { PendingAttachment } from '../types';

export const pendingUploadedFileByChat: Record<string, PendingAttachment | null> = {};
