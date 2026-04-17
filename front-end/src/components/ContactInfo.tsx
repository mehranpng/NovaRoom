import { ArrowLeft, Copy, Check, Calendar, Link2, MessageCircle, Pencil, X, Save, Image as ImageIcon, Trash2, RotateCcw, Ban } from 'lucide-react';
import { motion, type Variants } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { API_BASE_URL, apiFetch } from '../config/api';
import { ImageMediaViewer } from './ImageMediaViewer';
import { decryptAvatarBytesClientSide, decryptFileBytesClientSide, encryptFileBytesClientSide } from '../utils/e2ee';

interface ContactInfoProps {
    user: User;
    onBack: () => void;
    onOpenChat?: (user: User) => void;
    isBlocked?: boolean;
    hideOnlineStatus?: boolean;
    onToggleBlock?: (user: User) => void | Promise<void>;
    onOpenMembers?: () => void;
    autoOpenMembers?: boolean;
    startInEditMode?: boolean;
}

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function extractUploadedFileId(res: any): string {
    const file = res?.file || {};
    return String(file.fileId || file.id || file.file_id || file.path || '').trim();
}

function resolveVerified(val: any): boolean {
    if (val === null || val === undefined) return false;
    if (val === false || val === 0 || val === 'false' || val === '0') return false;
    return true;
}
function toPersianDigits(value: string | number): string {
    return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
}

function resolveAvatarUrl(rawAvatar: string): string {
    const avatar = String(rawAvatar || '').trim();
    if (!avatar) return '';
    if (avatar.startsWith('blob:') || avatar.startsWith('data:')) return avatar;
    if (avatar.startsWith('http://') || avatar.startsWith('https://')) return avatar;
    if (avatar.startsWith('/')) return `${API_BASE_URL}${avatar}`;
    return `${API_BASE_URL}/files/${avatar}`;
}

function extractFileIdFromAvatar(rawAvatar: string): string {
    const avatar = String(rawAvatar || '').trim();
    if (!avatar) return '';
    const withoutOrigin = avatar.startsWith(API_BASE_URL) ? avatar.slice(API_BASE_URL.length) : avatar;
    const match = withoutOrigin.match(/\/(?:files|avatars)\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
    if (!avatar.startsWith('http://') && !avatar.startsWith('https://') && !avatar.startsWith('/')) return avatar;
    return '';
}

export function ContactInfo({
    user,
    onBack,
    onOpenChat,
    isBlocked = false,
    hideOnlineStatus = false,
    onToggleBlock,
    onOpenMembers,
    autoOpenMembers = true,
    startInEditMode = false,
}: ContactInfoProps) {
    const [copied, setCopied] = useState(false);
    const [canEditGroup, setCanEditGroup] = useState(false);
    const [editingGroup, setEditingGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [groupAvatar, setGroupAvatar] = useState(''); // stores fileId (draft)
    const [avatarTouched, setAvatarTouched] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resolvedRegistrationDate, setResolvedRegistrationDate] = useState<string>(String(user.registrationDate ?? '').trim());
    const [registrationLoading, setRegistrationLoading] = useState(false);
    const [openedProfileImage, setOpenedProfileImage] = useState<{ url: string; fileId: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const openedImageObjectUrlRef = useRef<string | null>(null);

    useEffect(() => {
        setCopied(false);
    }, [user.chatId, user.username]);

    const bio = typeof user.bio === 'string' ? user.bio.trim() : '';

    const isInviteLink = (un: string) =>
        un.startsWith('senoroom://') || un.startsWith('novaroom://');

    const isGroup = useMemo(() => {
        const chatId = String((user as any)?.chatId ?? '');
        const un = String((user as any)?.username ?? '');
        return Boolean((user as any)?.isGroup) || chatId.startsWith('grp_') || (un ? isInviteLink(un) : false);
    }, [user]);

    const displayBio = bio === 'گروه' ? '' : bio;

    useEffect(() => {
        // Reset group edit state when user changes
        setEditingGroup(isGroup ? startInEditMode : false);
        setSaving(false);
        setError(null);
        setGroupName(String(user.name ?? ''));
        setGroupAvatar(String(user.avatar ?? ''));
        setAvatarTouched(false);
        setResolvedRegistrationDate(String(user.registrationDate ?? '').trim());
        setRegistrationLoading(false);
    }, [isGroup, startInEditMode, user.chatId, user.name, user.avatar]);

    useEffect(() => {
        if (isGroup) {
            setRegistrationLoading(false);
            return;
        }

        const existingDate = String(user.registrationDate ?? '').trim();
        if (existingDate) {
            setResolvedRegistrationDate(existingDate);
            setRegistrationLoading(false);
            return;
        }

        const username = String(user.username ?? '').trim().replace(/^@+/, '');
        const chatId = String(user.chatId ?? '').trim();
        if (!username && !chatId) {
            setRegistrationLoading(false);
            return;
        }

        let cancelled = false;
        setRegistrationLoading(true);

        const loadRegistrationDate = async () => {
            let resolved = '';

            try {
                if (username.length >= 2) {
                    const users = await apiFetch(`/users/search?query=${encodeURIComponent(username)}`);
                    if (Array.isArray(users)) {
                        const found = users.find((u: any) => {
                            const uUsername = String(u?.username ?? '').toLowerCase();
                            const uChatId = String(u?.chatId ?? '');
                            return (uUsername && uUsername === username.toLowerCase()) || (chatId && uChatId === chatId);
                        });
                        resolved = String(found?.registrationDate ?? '').trim();
                    }
                }

                if (!resolved && chatId) {
                    const chats = await apiFetch('/chats');
                    if (Array.isArray(chats)) {
                        const chatMatch = chats.find((c: any) => {
                            const other = c?.otherUser ?? {};
                            return String(other?.chatId ?? '') === chatId || String(other?.username ?? '').toLowerCase() === username.toLowerCase();
                        });
                        resolved = String(chatMatch?.otherUser?.registrationDate ?? '').trim();
                    }
                }
            } catch {
                resolved = '';
            } finally {
                if (!cancelled) {
                    setResolvedRegistrationDate(resolved);
                    setRegistrationLoading(false);
                }
            }
        };

        loadRegistrationDate();

        return () => {
            cancelled = true;
        };
    }, [isGroup, user.registrationDate, user.username, user.chatId]);

    useEffect(() => {
        let cancelled = false;
        if (!isGroup) {
            setCanEditGroup(false);
            return;
        }

        apiFetch('/profile/me')
            .then((me) => {
                if (cancelled) return;
                setCanEditGroup(resolveVerified(me?.verified ?? me?.user?.verified));
            })
            .catch(() => {
                if (cancelled) return;
                setCanEditGroup(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isGroup]);

    useEffect(() => {
        if (!isGroup || !onOpenMembers || !autoOpenMembers) return;
        onOpenMembers();
    }, [autoOpenMembers, isGroup, onOpenMembers, user.chatId]);

    const handleCopy = () => {
        const un = (user.username || '').trim();
        if (!un) return;
        const textToCopy = isInviteLink(un) ? un : `@${un}`;
        navigator.clipboard.writeText(textToCopy).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const canOpenChat = Boolean(onOpenChat) && !isGroup && Boolean(user.chatId) && user.chatId !== 'saved';

    const uploadGroupAvatar = async (file: File) => {
        if (!file) return;

        if (file.size > MAX_IMAGE_BYTES) {
            setError('حجم عکس نباید بیشتر از ۳ مگابایت باشد');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const token = localStorage.getItem('token') || '';
            const plainBytes = new Uint8Array(await file.arrayBuffer());
            const encryptedBytes = await encryptFileBytesClientSide(plainBytes, token, 'profile_avatar_shared');
            const encryptedFile = new window.File([new Uint8Array(encryptedBytes)], file.name, {
                type: 'application/octet-stream',
                lastModified: file.lastModified || Date.now(),
            });
            const form = new FormData();
            form.append('file', encryptedFile);
            const res = await apiFetch('/files/upload', { method: 'POST', body: form });

            if (res?.success !== true) throw new Error('Upload failed');
            const fileId = extractUploadedFileId(res);
            if (!fileId) throw new Error('Invalid upload response');

            setGroupAvatar(fileId);
            setAvatarTouched(true);
        } catch (e) {
            console.error(e);
            setError('آپلود عکس گروه با خطا مواجه شد');
        } finally {
            setSaving(false);
        }
    };

    const openAvatarViewer = async () => {
        const rawAvatar = String(user.avatar || '').trim();
        if (!rawAvatar) return;
        const fileId = extractFileIdFromAvatar(rawAvatar);
        const avatarUrl = resolveAvatarUrl(rawAvatar);
        const token = localStorage.getItem('token') || '';
        if (!avatarUrl || !token || !fileId) return;

        try {
            const response = await fetch(avatarUrl, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) throw new Error('Failed to load avatar');
            const encryptedBytes = new Uint8Array(await response.arrayBuffer());
            let plainBytes = await decryptFileBytesClientSide(encryptedBytes, token, 'profile_avatar_shared');
            if (plainBytes === encryptedBytes) {
                plainBytes = await decryptAvatarBytesClientSide(encryptedBytes, token);
            }
            const blob = new Blob([new Uint8Array(plainBytes)], { type: response.headers.get('content-type') || 'image/*' });
            if (openedImageObjectUrlRef.current) {
                URL.revokeObjectURL(openedImageObjectUrlRef.current);
            }
            const objectUrl = URL.createObjectURL(blob);
            openedImageObjectUrlRef.current = objectUrl;
            setOpenedProfileImage({ url: objectUrl, fileId });
        } catch (e) {
            console.error(e);
            // اگر تصویر پروفایل معتبر نبود یا قابل دریافت نبود، سکوت کن.
        }
    };

    useEffect(() => {
        return () => {
            if (openedImageObjectUrlRef.current) {
                URL.revokeObjectURL(openedImageObjectUrlRef.current);
                openedImageObjectUrlRef.current = null;
            }
        };
    }, []);

    const saveGroup = async () => {
        if (!user.chatId) return;

        setSaving(true);
        setError(null);

        try {
            await apiFetch(`/groups/${encodeURIComponent(user.chatId)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name: groupName,
                    avatar: groupAvatar,
                }),
            });

            // Ask App to refresh /chats so sidebar + header get updated.
            window.dispatchEvent(new Event('novaroom:refresh_chats'));
            setEditingGroup(false);
        } catch (e) {
            console.error(e);
            setError('ویرایش گروه با خطا مواجه شد');
        } finally {
            setSaving(false);
        }
    };

    const originalAvatar = String(user.avatar || '');
    const previewName = groupName || String(user.name || '');
    const previewAvatar = avatarTouched ? groupAvatar : originalAvatar;

    const canRemoveAvatar = Boolean(previewAvatar);
    const isAvatarRemoved = avatarTouched && !groupAvatar && Boolean(originalAvatar);

    const toastVariants: Variants = {
        hidden: { scale: 0.9, opacity: 0, },
        visible: { scale: 1, opacity: 1, transition: { duration: 0.2 } },
    };

    return (
        <motion.div
            className="contact-info"
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            <div className="contact-info__header">
                <button className="contact-info__back" onClick={onBack} aria-label="Back" type="button">
                    <ArrowLeft size={20} />
                </button>
                <div className="contact-info__title">{isGroup ? 'اطلاعات گروه' : 'مخاطب'}</div>
                <div className="contact-info__spacer" />

                {isGroup && canEditGroup && (
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label="Edit group"
                        onClick={() => setEditingGroup((v) => !v)}
                        title={editingGroup ? 'بستن ویرایش' : 'ویرایش'}
                    >
                        {editingGroup ? <X size={18} /> : <Pencil size={18} />}
                    </button>
                )}
            </div>

            <div className="contact-info__content">
                <div className="contact-info__avatar">
                    <button type="button" onClick={openAvatarViewer} style={{ background: 'none', border: 'none', padding: 0, cursor: user.avatar ? 'zoom-in' : 'default' }}>
                        <Avatar name={user.name} size="xl" online={(isBlocked || hideOnlineStatus) ? undefined : user.online} src={user.avatar} />
                    </button>
                    <div
                        className="contact-info__name"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                        {user.name}
                        {!isGroup && user.verified ? <VerifiedBadge size={16} /> : null}
                    </div>
                    {!isGroup && (
                        <div className={!(isBlocked || hideOnlineStatus) && user.online ? 'contact-info__status contact-info__status--online' : 'contact-info__status'}>
                            {(isBlocked || hideOnlineStatus) ? 'آخرین بازدید مدت‌ها پیش' : user.online ? 'آنلاین' : 'آفلاین'}
                        </div>
                    )}
                </div>

                {isGroup && canEditGroup && editingGroup && (
                    <div className="contact-info__card" style={{ borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', border: '1px solid var(--border-primary)' }}>
                        <div className="contact-info__label">ویرایش گروه</div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ fontSize: 12, opacity: 0.8, color: 'var(--text-primary, #fff)' }}>نام گروه</div>
                                <input
                                    value={groupName}
                                    onChange={(e) => setGroupName(e.target.value)}
                                    placeholder={String(user.name ?? '') || 'مثلاً تیم توسعه'}
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: 12,
                                        border: '1px solid var(--border-primary)',
                                        background: 'var(--bg-secondary)',
                                        color: 'var(--text-primary, #fff)',
                                        fontSize: 14,
                                        fontFamily: 'Vazir, sans-serif',
                                    }}
                                    disabled={saving}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ fontSize: 12, opacity: 0.8, color: 'var(--text-primary, #fff)' }}>عکس گروه</div>

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 12,
                                        padding: 10,
                                        borderRadius: 12,
                                        border: '1px solid var(--border-primary)',
                                        background: 'linear-gradient(180deg, var(--bg-secondary), color-mix(in srgb, var(--bg-secondary) 78%, transparent))',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                        <Avatar name={previewName} size="md" src={previewAvatar} />
                                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                            <div style={{ fontSize: 13, color: 'var(--text-primary, #fff)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {previewName || 'گروه'}
                                            </div>
                                            <div style={{ fontSize: 12, color: 'var(--text-secondary, #bbb)' }}>
                                                {isAvatarRemoved ? 'عکس برای حذف انتخاب شد (بعد از ذخیره کامل می‌شود)' : 'برای تغییر، عکس جدید انتخاب کن'}
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={saving}
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: 8,
                                                padding: '10px 12px',
                                                borderRadius: 12,
                                                border: '1px solid var(--border-primary)',
                                                background: 'transparent',
                                                color: 'var(--text-primary, #fff)',
                                                cursor: saving ? 'not-allowed' : 'pointer',
                                                fontSize: 13,
                                                fontWeight: 700,
                                                fontFamily: 'Vazir, sans-serif',
                                            }}
                                            title="انتخاب و آپلود عکس"
                                        >
                                            <ImageIcon size={18} />
                                            انتخاب عکس
                                        </button>

                                        {isAvatarRemoved ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setError(null);
                                                    setGroupAvatar(originalAvatar);
                                                    setAvatarTouched(false);
                                                }}
                                                disabled={saving}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 8,
                                                    padding: '10px 12px',
                                                    borderRadius: 12,
                                                    border: '1px solid var(--border-primary)',
                                                    background: 'transparent',
                                                    color: 'var(--text-primary, #fff)',
                                                    cursor: saving ? 'not-allowed' : 'pointer',
                                                    fontSize: 13,
                                                    fontWeight: 700,
                                                    fontFamily: 'Vazir, sans-serif',
                                                }}
                                                title="بازگردانی عکس"
                                            >
                                                <RotateCcw size={18} />
                                                بازگردانی
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!canRemoveAvatar) return;
                                                    setError(null);
                                                    setGroupAvatar('');
                                                    setAvatarTouched(true);
                                                }}
                                                disabled={saving || !canRemoveAvatar}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 8,
                                                    padding: '10px 12px',
                                                    borderRadius: 12,
                                                    border: '1px solid var(--border-primary)',
                                                    background: 'transparent',
                                                    color: !canRemoveAvatar ? 'var(--text-secondary, #999)' : 'var(--text-primary, #fff)',
                                                    cursor: saving || !canRemoveAvatar ? 'not-allowed' : 'pointer',
                                                    fontSize: 13,
                                                    fontWeight: 700,
                                                    fontFamily: 'Vazir, sans-serif',
                                                    opacity: canRemoveAvatar ? 1 : 0.7,
                                                }}
                                                title={canRemoveAvatar ? 'حذف عکس گروه' : 'عکسی برای حذف وجود ندارد'}
                                            >
                                                <Trash2 size={18} />
                                                حذف
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={async (e) => {
                                        const f = e.target.files?.[0];
                                        if (!f) return;
                                        await uploadGroupAvatar(f);
                                        // اجازه انتخاب دوباره همان فایل
                                        e.currentTarget.value = '';
                                    }}
                                />
                            </div>

                            {error && (
                                <div style={{ color: 'var(--danger, #ff4d4f)', fontSize: 12 }}>
                                    {error}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 10 }}>
                                <button
                                    type="button"
                                    onClick={saveGroup}
                                    disabled={saving}
                                    style={{
                                        flex: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 8,
                                        padding: '10px 12px',
                                        borderRadius: 12,
                                        border: '1px solid var(--border-primary)',
                                        background: 'var(--bg-secondary)',
                                        color: 'var(--text-primary, #fff)',
                                        cursor: saving ? 'not-allowed' : 'pointer',
                                        fontSize: 14,
                                        fontWeight: 700,
                                        fontFamily: 'Vazir, sans-serif',
                                    }}
                                >
                                    ذخیره
                                    <Save size={18} />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setError(null);
                                        setGroupName(String(user.name ?? ''));
                                        setGroupAvatar(String(user.avatar ?? ''));
                                        setAvatarTouched(false);
                                        setEditingGroup(false);
                                    }}
                                    disabled={saving}
                                    style={{
                                        flex: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 8,
                                        padding: '10px 12px',
                                        borderRadius: 12,
                                        border: '1px solid var(--border-primary)',
                                        background: 'transparent',
                                        color: 'var(--text-primary, #fff)',
                                        cursor: saving ? 'not-allowed' : 'pointer',
                                        fontSize: 14,
                                        fontWeight: 700,
                                        fontFamily: 'Vazir, sans-serif',
                                    }}
                                >
                                    انصراف
                                    <X size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {canOpenChat && (
                    <div className="contact-info__card" style={{ padding: 10 }}>
                        <div className="contact-info__actions-row">
                            <button
                                type="button"
                                onClick={() => onToggleBlock?.(user)}
                                className={isBlocked ? 'contact-info__action-btn contact-info__action-btn--danger contact-info__action-btn--danger-soft' : 'contact-info__action-btn contact-info__action-btn--danger'}
                                aria-label={isBlocked ? 'Unblock user' : 'Block user'}
                            >
                                {isBlocked ? 'آنبلاک' : 'بلاک'}
                                <Ban size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={() => onOpenChat?.(user)}
                                className="contact-info__action-btn"
                                aria-label="Open chat"
                            >
                                پیام
                                <MessageCircle size={18} />
                            </button>
                        </div>
                    </div>
                )}

                {(!isGroup || displayBio) && (
                    <div className="contact-info__card">
                        <div className="contact-info__label">بیوگرافی</div>
                        <div className={displayBio ? 'contact-info__bio' : 'contact-info__bio contact-info__bio--empty'}>
                            {displayBio || 'بدون بیوگرافی'}
                        </div>
                    </div>
                )}

                {/* لینک دعوت برای گروه / نام کاربری برای پرسونال */}
                {user.username && (
                    <div className="contact-info__card">
                        <div className="contact-info__label">
                            {isGroup ? 'لینک دعوت' : 'نام کاربری'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div
                                className="contact-info__mono"
                                style={isGroup ? { fontSize: 13, wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 6 } : undefined}
                            >
                                {isGroup ? (
                                    <>
                                        <Link2 size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
                                        {user.username}
                                    </>
                                ) : (
                                    `@${user.username}`
                                )}
                            </div>
                            <button
                                type="button"
                                className="icon-btn"
                                aria-label="Copy"
                                onClick={handleCopy}
                                disabled={!user.username}
                                style={{ flexShrink: 0 }}
                            >
                                {copied ? <Check size={18} /> : <Copy size={18} />}
                            </button>
                        </div>
                    </div>
                )}

                {!isGroup && (
                    <div className="contact-info__card">
                        <div className="contact-info__label">تاریخ عضویت</div>
                        <div className="contact-info__registration-date" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Calendar size={16} style={{ opacity: 0.7 }} />
                            {registrationLoading ? (
                                <span className="skeleton" style={{ display: 'inline-block', width: 110, height: 16, borderRadius: 8 }} />
                            ) : (resolvedRegistrationDate ? toPersianDigits(resolvedRegistrationDate) : 'نامشخص')}
                        </div>
                    </div>
                )}
            </div>
            {openedProfileImage && (
                <ImageMediaViewer
                    imageUrl={openedProfileImage.url}
                    token={localStorage.getItem('token') || ''}
                    downloadFile={{ fileId: openedProfileImage.fileId, fileName: `${user.name || 'profile'}.jpg` }}
                    onClose={() => {
                        setOpenedProfileImage(null);
                        if (openedImageObjectUrlRef.current) {
                            URL.revokeObjectURL(openedImageObjectUrlRef.current);
                            openedImageObjectUrlRef.current = null;
                        }
                    }}
                />
            )}
        </motion.div>
    );
}
