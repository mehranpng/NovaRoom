import { ChevronLeft, Copy, Check, Calendar, Link2, MessageCircle, Save, Image as ImageIcon, Trash2, RotateCcw, Ban, FileText, AtSign, UserRound, Hash, Settings, Loader2, Lock, UserX } from 'lucide-react';
import { motion } from "framer-motion";
import { screenVariants } from '../utils/screenMotion';
import { useScrollFade } from '../hooks/useScrollFade';
import { syncThemeColor } from '../hooks/useDarkMode';
import { cx } from '../utils/cx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { User } from '../types';
import { Avatar, extractFileIdFromAvatar, getAvatarDisplayUrl } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { apiFetch } from '../config/api';
import { ImageMediaViewer } from './ImageMediaViewer';
import { ImageEditorModal } from './ImageEditorModal';
import { encryptAvatarBytesClientSide } from '../utils/e2ee';
import { copyText } from '../utils/clipboard';
import { formatLastSeen, toPersianDigits } from '../utils/format';

interface ContactInfoProps {
    user: User;
    onBack: () => void;
    onOpenChat?: (user: User) => void;
    isBlocked?: boolean;
    hideOnlineStatus?: boolean;
    isInteractiveOnline?: boolean;
    onToggleBlock?: (user: User) => void | Promise<void>;
    onOpenMembers?: () => void;
    autoOpenMembers?: boolean;
    startInEditMode?: boolean;
    membershipClosed?: boolean;
}

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function extractUploadedFileId(res: any): string {
    const file = res?.file || {};
    return String(file.fileId || file.id || file.file_id || file.path || '').trim();
}

export function ContactInfo({
    user,
    onBack,
    onOpenChat,
    isBlocked = false,
    hideOnlineStatus = false,
    isInteractiveOnline = false,
    onToggleBlock,
    onOpenMembers,
    autoOpenMembers = true,
    startInEditMode = false,
    membershipClosed = false,
}: ContactInfoProps) {
    const { scrolled, handleScroll } = useScrollFade();
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [canEditGroup, setCanEditGroup] = useState(false);
    const [editingGroup, setEditingGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [groupAvatar, setGroupAvatar] = useState(''); 
    const [avatarTouched, setAvatarTouched] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resolvedRegistrationDate, setResolvedRegistrationDate] = useState<string>(String(user.registrationDate ?? '').trim());
    const [registrationLoading, setRegistrationLoading] = useState(false);
    const [openedProfileImage, setOpenedProfileImage] = useState<{ url: string; fileId: string } | null>(null);
    const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
    const [groupMembershipClosed, setGroupMembershipClosed] = useState(Boolean(membershipClosed));
    const [bannedUsers, setBannedUsers] = useState<User[]>([]);
    const [loadingBans, setLoadingBans] = useState(false);
    const [bansLoaded, setBansLoaded] = useState(false);
    const [unbanningId, setUnbanningId] = useState<string | null>(null);
    const navigate = useNavigate();
    const location = useLocation();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        syncThemeColor('--bg-primary');
        return () => syncThemeColor();
    }, []);

    useEffect(() => {
        setCopiedField(null);
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
    const bioIsLatin = displayBio !== '' && !/[\u0600-\u06FF]/.test(displayBio);

    useEffect(() => {
        
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
                const isAdmin = Boolean(me?.adminLevel);
                const isCreator = String(user.createdBy || '') === String(me?.chatId || '');
                setCanEditGroup(isAdmin || isCreator);
            })
            .catch(() => {
                if (cancelled) return;
                setCanEditGroup(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isGroup, user.chatId, user.createdBy]);

    useEffect(() => {
        setGroupMembershipClosed(Boolean(membershipClosed));
    }, [membershipClosed]);

    useEffect(() => {
        if (!isGroup || !editingGroup || !user.chatId || !canEditGroup) return;
        let cancelled = false;
        setLoadingBans(true);
        apiFetch(`/groups/${encodeURIComponent(user.chatId)}/bans`)
            .then((res) => {
                if (cancelled) return;
                setBannedUsers(Array.isArray(res?.bannedUsers) ? res.bannedUsers : []);
            })
            .catch(() => {
                if (!cancelled) setBannedUsers([]);
            })
            .finally(() => {
                if (cancelled) return;
                setLoadingBans(false);
                setBansLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, [isGroup, editingGroup, user.chatId, canEditGroup]);

    useEffect(() => {
        if (!editingGroup) setBansLoaded(false);
    }, [editingGroup]);

    useEffect(() => {
        if (!isGroup || !onOpenMembers || !autoOpenMembers) return;
        onOpenMembers();
    }, [autoOpenMembers, isGroup, onOpenMembers, user.chatId]);

    const handleCopy = (text: string, field: string) => {
        if (!text) return;
        copyText(text)
            .then(() => {
                setCopiedField(field);
                setTimeout(() => setCopiedField((curr) => (curr === field ? null : curr)), 1500);
            })
            .catch(() => alert('کپی انجام نشد'));
    };

    const canOpenChat = Boolean(onOpenChat) && !isGroup && Boolean(user.chatId) && user.chatId !== 'saved';

    const uploadGroupAvatar = async (file: File) => {
        if (!file) return;

        if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
            setError('فرمت GIF برای عکس گروه پشتیبانی نمی‌شود. لطفاً یک تصویر ثابت انتخاب کنید.');
            return;
        }

        if (file.size > MAX_IMAGE_BYTES) {
            setError('حجم عکس نباید بیشتر از ۳ مگابایت باشد');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const token = localStorage.getItem('token') || '';
            const plainBytes = new Uint8Array(await file.arrayBuffer());
            const encryptedBytes = await encryptAvatarBytesClientSide(plainBytes, token);
            const encryptedFile = new window.File([encryptedBytes as BlobPart], file.name, {
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
        if (!fileId) return;

        try {
            const cachedUrl = await getAvatarDisplayUrl(rawAvatar);
            if (!cachedUrl) return;
            setOpenedProfileImage({ url: cachedUrl, fileId });
            const params = new URLSearchParams(location.search);
            params.set('avatar', '1');
            navigate({ pathname: location.pathname, search: `?${params.toString()}` });
        } catch (e) {
            console.error(e);
            
        }
    };

    useEffect(() => {
        const hasAvatarRoute = new URLSearchParams(location.search).get('avatar') === '1';
        if (hasAvatarRoute || !openedProfileImage) return;
        setOpenedProfileImage(null);
    }, [location.search, openedProfileImage]);

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

            
            window.dispatchEvent(new Event('novaroom:refresh_chats'));
            if (onOpenMembers) onOpenMembers();
            else setEditingGroup(false);
        } catch (e) {
            console.error(e);
            setError('ویرایش گروه با خطا مواجه شد');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleMembershipClosed = async () => {
        if (!user.chatId || saving) return;
        const next = !groupMembershipClosed;
        setGroupMembershipClosed(next);
        setSaving(true);
        setError(null);
        try {
            await apiFetch(`/groups/${encodeURIComponent(user.chatId)}`, {
                method: 'PUT',
                body: JSON.stringify({ membershipClosed: next }),
            });
            window.dispatchEvent(new Event('novaroom:refresh_chats'));
        } catch {
            setGroupMembershipClosed(!next);
            setError('تغییر وضعیت عضویت گروه با خطا مواجه شد');
        } finally {
            setSaving(false);
        }
    };

    const handleUnbanUser = async (targetChatId: string) => {
        if (!user.chatId || unbanningId) return;
        setUnbanningId(targetChatId);
        setError(null);
        try {
            await apiFetch(`/groups/${encodeURIComponent(user.chatId)}/ban/${encodeURIComponent(targetChatId)}`, {
                method: 'DELETE',
            });
            setBannedUsers((prev) => prev.filter((u) => u.chatId !== targetChatId));
        } catch {
            setError('رفع مسدودیت با خطا مواجه شد');
        } finally {
            setUnbanningId(null);
        }
    };

    const originalAvatar = String(user.avatar || '');
    const previewAvatar = avatarTouched ? groupAvatar : originalAvatar;

    const canRemoveAvatar = Boolean(previewAvatar);
    const isAvatarRemoved = avatarTouched && !groupAvatar && Boolean(originalAvatar);

    return (
        <motion.div
            key={isGroup && editingGroup ? 'group-settings' : 'contact-info-main'}
            className="contact-info"
            variants={screenVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
            <div className="profile__header">
                <div className="profile__header-side">
                    <button
                        className="profile__header-back back-icon-btn"
                        onClick={() => {
                            if (isGroup && editingGroup && onOpenMembers) {
                                onOpenMembers();
                                return;
                            }
                            onBack();
                        }}
                        aria-label="بازگشت"
                        type="button"
                    >
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">{isGroup ? (editingGroup ? 'تنظیمات گروه' : 'اطلاعات گروه') : 'اطلاعات مخاطب'}</h1>
                {isGroup && canEditGroup && (
                    <div className="profile__header-actions">
                        {editingGroup ? (
                            <button
                                type="button"
                                className="profile__save-btn"
                                onClick={saveGroup}
                                disabled={saving}
                            >
                                <Save size={15} />
                                <span className="profile__btn-label">{saving ? 'در حال ذخیره' : 'ذخیره'}</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="profile__edit-btn"
                                onClick={() => setEditingGroup(true)}
                            >
                                <Settings size={15} />
                                تنظیمات
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div className="contact-info__content">
                <div className="profile__hero">
                    <span className="profile__hero-orb profile__hero-orb--one" aria-hidden="true" />
                    <span className="profile__hero-orb profile__hero-orb--two" aria-hidden="true" />

                    <button
                        type="button"
                        className="profile__avatar-wrap"
                        onClick={openAvatarViewer}
                        aria-label="مشاهده تصویر"
                        style={{ cursor: user.avatar ? 'zoom-in' : 'default' }}
                    >
                        <Avatar
                            name={user.name}
                            size="xl"
                            src={user.avatar}
                            userId={isGroup ? undefined : user.chatId}
                            isChessChampion={isGroup ? false : (user as any).isChessChampion}
                        />
                    </button>

                    <h2 className="profile__name">
                        {user.name}
                        {!isGroup && user.verified ? <VerifiedBadge size={20} /> : null}
                    </h2>

                    {isGroup ? (
                        <p className="profile__username-display">
                            {editingGroup ? 'در حال ویرایش اطلاعات گروه' : 'گروه'}
                        </p>
                    ) : (
                        <span className={(!(isBlocked || hideOnlineStatus) && (isInteractiveOnline || user.online)) ? 'contact-info__status contact-info__status--online' : 'contact-info__status'}>
                            {formatLastSeen(user, { isContactBlocked: isBlocked || hideOnlineStatus, isInteractiveOnline })}
                        </span>
                    )}

                    {isGroup && canEditGroup && editingGroup && (
                        <div className="profile__avatar-actions">
                            <button
                                type="button"
                                className="profile__avatar-btn profile__avatar-btn--upload"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={saving}
                            >
                                <ImageIcon size={14} />
                                انتخاب عکس
                            </button>
                            {isAvatarRemoved ? (
                                <button
                                    type="button"
                                    className="profile__avatar-btn"
                                    disabled={saving}
                                    onClick={() => {
                                        setError(null);
                                        setGroupAvatar(originalAvatar);
                                        setAvatarTouched(false);
                                    }}
                                >
                                    <RotateCcw size={14} />
                                    بازگردانی
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="profile__avatar-btn profile__avatar-btn--danger"
                                    disabled={saving || !canRemoveAvatar}
                                    onClick={() => {
                                        if (!canRemoveAvatar) return;
                                        setError(null);
                                        setGroupAvatar('');
                                        setAvatarTouched(true);
                                    }}
                                >
                                    <Trash2 size={14} />
                                    حذف تصویر
                                </button>
                            )}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) {
                                        if (f.type === 'image/gif' || /\.gif$/i.test(f.name)) {
                                            setError('فرمت GIF برای عکس گروه پشتیبانی نمی\u200cشود. لطفاً یک تصویر ثابت انتخاب کنید.');
                                        } else {
                                            setError(null);
                                            setPendingAvatarFile(f);
                                        }
                                        e.currentTarget.value = '';
                                    }
                                }}
                            />
                        </div>
                    )}
                </div>

                <div className="profile__fields" onScroll={handleScroll}>
                    {isGroup && canEditGroup && editingGroup && (
                        <>
                            {loadingBans || !bansLoaded ? (
                                <>
                                    <div className="profile__card">
                                        <div className="skeleton" style={{ height: 16, width: '42%', borderRadius: 8, marginBottom: 14 }} />
                                        <div className="skeleton" style={{ height: 44, width: '100%', borderRadius: 14 }} />
                                    </div>
                                    <div className="profile__card">
                                        <div className="skeleton" style={{ height: 16, width: '55%', borderRadius: 8, marginBottom: 12 }} />
                                        <div className="skeleton" style={{ height: 12, width: '80%', borderRadius: 8 }} />
                                    </div>
                                    <div className="profile__card">
                                        <div className="skeleton" style={{ height: 16, width: '35%', borderRadius: 8, marginBottom: 14 }} />
                                        {Array.from({ length: 3 }).map((_, i) => (
                                            <div key={`ban-skeleton-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                                <span className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
                                                <span className="skeleton" style={{ height: 13, flex: 1, borderRadius: 8 }} />
                                            </div>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="profile__card">
                                        <div className="profile__section-title">
                                            <span className="profile__section-icon"><Settings size={15} /></span>
                                            تنظیمات گروه
                                        </div>

                                        <div className="profile__field-group" style={{ marginBottom: 0 }}>
                                            <label className="profile__field-label">نام گروه</label>
                                            <input
                                                value={groupName}
                                                onChange={(e) => setGroupName(e.target.value)}
                                                placeholder={String(user.name ?? '') || 'مثلاً تیم توسعه'}
                                                className="profile__field-input"
                                                style={{ borderRadius: 9999 }}
                                                disabled={saving}
                                            />
                                        </div>

                                        {error && <p className="contact-info__error">{error}</p>}
                                    </div>

                                    <div className="profile__card">
                                        <div className="group-settings-toggle-row" onClick={handleToggleMembershipClosed}>
                                            <div className="group-settings-toggle-info">
                                                <div className="group-settings-toggle-title">
                                                    <Lock size={16} />
                                                    <span>بستن عضویت گروه</span>
                                                </div>
                                                <p className="group-settings-toggle-desc">
                                                    در صورت فعال بودن، کاربران جدید نمی‌توانند از طریق لینک دعوت وارد گروه شوند.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={groupMembershipClosed}
                                                disabled={saving}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleToggleMembershipClosed();
                                                }}
                                                className={`group-settings-switch${groupMembershipClosed ? ' is-on' : ''}`}
                                            >
                                                <span className="group-settings-switch__thumb" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="profile__card">
                                        <div className="group-settings-section-head">
                                            <div className="profile__section-title">
                                                <span className="profile__section-icon"><UserX size={15} /></span>
                                                لیست حذف‌شده‌ها
                                            </div>
                                        </div>

                                        {bannedUsers.length === 0 ? (
                                            <div className="group-settings-empty">
                                                <span>کاربری در لیست مسدودشده‌ها وجود ندارد.</span>
                                            </div>
                                        ) : (
                                            <div className="group-settings-ban-list">
                                                {bannedUsers.map((bu) => (
                                                    <div key={bu.chatId} className="group-settings-ban-item">
                                                        <Avatar name={bu.name} size="sm" src={bu.avatar} userId={bu.chatId} />
                                                        <div className="group-settings-ban-info">
                                                            <div className="group-settings-ban-name">
                                                                <span className="truncate">{bu.name}</span>
                                                                {bu.verified && <VerifiedBadge size={14} />}
                                                            </div>
                                                            {bu.username && (
                                                                <div className="group-settings-ban-username" dir="ltr">
                                                                    @{bu.username}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={unbanningId === bu.chatId}
                                                            onClick={() => bu.chatId && void handleUnbanUser(bu.chatId)}
                                                            className="group-settings-unban-btn"
                                                        >
                                                            {unbanningId === bu.chatId ? (
                                                                <Loader2 size={14} className="animate-spin" />
                                                            ) : (
                                                                <span>رفع مسدودیت</span>
                                                            )}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {canOpenChat && (
                        <>
                            <button
                                type="button"
                                onClick={() => onOpenChat?.(user)}
                                className="profile__edit-action"
                                aria-label="ارسال پیام"
                            >
                                <MessageCircle size={17} />
                                ارسال پیام
                            </button>
                            {onToggleBlock && (
                                <button
                                    type="button"
                                    onClick={() => onToggleBlock(user)}
                                    className="contact-info__block-btn"
                                    aria-label={isBlocked ? 'آنبلاک کردن' : 'بلاک کردن'}
                                >
                                    <Ban size={17} />
                                    {isBlocked ? 'آنبلاک کردن' : 'بلاک کردن'}
                                </button>
                            )}
                        </>
                    )}

                    {!isGroup ? (
                        <>
                            {displayBio && (
                                <div className="profile__card">
                                    <div className="profile__section-title">
                                        <span className="profile__section-icon"><FileText size={15} /></span>
                                        بیوگرافی
                                    </div>
                                    <p
                                        className="profile__bio-text"
                                        style={bioIsLatin ? { direction: 'ltr', textAlign: 'left' } : undefined}
                                    >
                                        {displayBio}
                                    </p>
                                </div>
                            )}

                            <div className="profile__card">
                                <div className="profile__section-title">
                                    <span className="profile__section-icon"><UserRound size={15} /></span>
                                    اطلاعات حساب
                                </div>

                                {user.username && (
                                    <div className="profile__info-row">
                                        <span className="profile__info-icon"><AtSign size={16} /></span>
                                        <div className="profile__info-body">
                                            <span className="profile__info-label">نام کاربری</span>
                                            <span className="profile__info-value" style={{ direction: 'ltr', textAlign: 'right' }}>@{user.username}</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={cx('profile__copy-btn', copiedField === 'username' && 'profile__copy-btn--copied')}
                                            aria-label="کپی نام کاربری"
                                            onClick={() => handleCopy(`@${user.username}`, 'username')}
                                        >
                                            {copiedField === 'username' ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                )}

                                {user.chatId && (
                                    <div className="profile__info-row">
                                        <span className="profile__info-icon"><Hash size={16} /></span>
                                        <div className="profile__info-body">
                                            <span className="profile__info-label">شناسه چت</span>
                                            <span className="profile__info-value profile__info-value--mono">{user.chatId}</span>
                                        </div>
                                        <button
                                            type="button"
                                            className={cx('profile__copy-btn', copiedField === 'chatId' && 'profile__copy-btn--copied')}
                                            aria-label="کپی شناسه چت"
                                            onClick={() => handleCopy(user.chatId, 'chatId')}
                                        >
                                            {copiedField === 'chatId' ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                )}

                                {(resolvedRegistrationDate || registrationLoading) && (
                                    <div className="profile__info-row">
                                        <span className="profile__info-icon"><Calendar size={16} /></span>
                                        <div className="profile__info-body">
                                            <span className="profile__info-label">تاریخ عضویت</span>
                                            <span className="profile__info-value">
                                                {registrationLoading ? (
                                                    <span className="skeleton" style={{ display: 'inline-block', width: 110, height: 16, borderRadius: 8 }} />
                                                ) : (resolvedRegistrationDate ? toPersianDigits(resolvedRegistrationDate) : 'نامشخص')}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            {displayBio && (
                                <div className="profile__card">
                                    <div className="profile__section-title">
                                        <span className="profile__section-icon"><FileText size={15} /></span>
                                        بیوگرافی
                                    </div>
                                    <p
                                        className="profile__bio-text"
                                        style={bioIsLatin ? { direction: 'ltr', textAlign: 'left' } : undefined}
                                    >
                                        {displayBio}
                                    </p>
                                </div>
                            )}

                            {user.username && !editingGroup && (
                                <div className="profile__card">
                                    <div className="profile__section-title">
                                        <span className="profile__section-icon"><Link2 size={15} /></span>
                                        لینک دعوت
                                    </div>
                                    <div className="profile__info-row">
                                        <span className="profile__info-icon"><Link2 size={16} /></span>
                                        <div className="profile__info-body">
                                            <span className="profile__info-label">لینک دعوت گروه</span>
                                            <span className="profile__info-value profile__info-value--mono contact-info__invite-value">
                                                {user.username}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            className={cx('profile__copy-btn', copiedField === 'invite' && 'profile__copy-btn--copied')}
                                            aria-label="کپی لینک دعوت"
                                            onClick={() => handleCopy(user.username, 'invite')}
                                        >
                                            {copiedField === 'invite' ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {openedProfileImage && (
                <ImageMediaViewer
                    imageUrl={openedProfileImage.url}
                    token={localStorage.getItem('token') || ''}
                    downloadFile={{ fileId: openedProfileImage.fileId, fileName: `${user.name || 'profile'}.jpg` }}
                    onClose={() => {
                        const params = new URLSearchParams(location.search);
                        if (params.has('avatar')) return void navigate(-1);
                        setOpenedProfileImage(null);
                    }}
                />
            )}

            {pendingAvatarFile && (
                <ImageEditorModal
                    imageFile={pendingAvatarFile}
                    squareCrop
                    onSend={(file) => {
                        setPendingAvatarFile(null);
                        void uploadGroupAvatar(file);
                    }}
                    onCancel={() => setPendingAvatarFile(null)}
                />
            )}
        </motion.div>
    );
}
