import { ArrowLeft, Copy, Check, Pencil, X, Save, Calendar, Upload, Trash2, Link2, Users } from 'lucide-react';
import { motion, type Variants } from "framer-motion";
import { useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { Avatar, getAvatarDisplayUrl } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { cx } from '../utils/cx';
import { apiFetch } from '../config/api';
import { ImageMediaViewer } from './ImageMediaViewer';
import { encryptFileBytesClientSide } from '../utils/e2ee';

interface ProfileProps {
    user: User;
    onBack: () => void;
    onUpdateProfile: (updates: Partial<Pick<User, 'name' | 'username' | 'bio' | 'avatar'>>) => Promise<void> | void;
}

interface OwnedGroup {
    chatId: string;
    name: string;
    inviteCode: string;
    inviteLink: string;
}

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
const toPersianDigits = (value: string | number): string => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);

export function Profile({ user, onBack, onUpdateProfile }: ProfileProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [name, setName] = useState(user.name);
    const [username, setUsername] = useState(user.username);
    const [bio, setBio] = useState(user.bio);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [updatingAvatar, setUpdatingAvatar] = useState(false);
    const [ownedGroups, setOwnedGroups] = useState<OwnedGroup[]>([]);
    const [openedProfileImage, setOpenedProfileImage] = useState<{ url: string; fileId: string } | null>(null);

    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
    const [usernameHint, setUsernameHint] = useState<string>('');
    const checkTimerRef = useRef<number | null>(null);

    const nameRef = useRef<HTMLInputElement | null>(null);
    const usernameRef = useRef<HTMLInputElement | null>(null);
    const bioRef = useRef<HTMLTextAreaElement | null>(null);

    const scrollIntoViewOnMobile = (el: HTMLElement | null) => {
        if (!el) return;
        setTimeout(() => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
    };

    const handleCopy = (text: string, field: string) => {
        navigator.clipboard.writeText(text).catch(() => { });
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    useEffect(() => {
        if (!isEditing) {
            setUsernameStatus('idle');
            setUsernameHint('');
            return;
        }

        const trimmed = username.trim();

        if (!trimmed) {
            setUsernameStatus('invalid');
            setUsernameHint('نام کاربری الزامی است.');
            return;
        }

        if (trimmed.length > 32) {
            setUsernameStatus('invalid');
            setUsernameHint('حداکثر 32 کاراکتر.');
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            setUsernameStatus('invalid');
            setUsernameHint('فقط حروف لاتین، اعداد و آندرلاین.');
            return;
        }

        // If user keeps their current username, it is always allowed.
        if (trimmed.toLowerCase() === user.username.toLowerCase()) {
            setUsernameStatus('available');
            setUsernameHint('');
            return;
        }

        setUsernameStatus('checking');
        setUsernameHint('در حال بررسی...');

        if (checkTimerRef.current) window.clearTimeout(checkTimerRef.current);
        checkTimerRef.current = window.setTimeout(async () => {
            try {
                const res = await apiFetch(
                    `/users/username-available?username=${encodeURIComponent(trimmed)}`
                );
                if (res?.available) {
                    setUsernameStatus('available');
                    setUsernameHint('نام کاربری قابل استفاده است.');
                } else {
                    setUsernameStatus('taken');
                    setUsernameHint('این نام کاربری قبلاً گرفته شده.');
                }
            } catch {
                setUsernameStatus('invalid');
                setUsernameHint('بررسی نام کاربری ممکن نشد.');
            }
        }, 350);

        return () => {
            if (checkTimerRef.current) window.clearTimeout(checkTimerRef.current);
        };
    }, [username, isEditing, user.username]);

    const handleSave = () => {
        const trimmedName = name.trim();
        const trimmedUsername = username.trim();
        if (!trimmedName || !trimmedUsername) return;
        if (usernameStatus !== 'available') return;

        onUpdateProfile({
            name: trimmedName,
            username: trimmedUsername,
            bio: bio.trim(),
        });
        setIsEditing(false);
    };

    useEffect(() => {
        const loadOwnedGroups = async () => {
            try {
                const groups = await apiFetch('/profile/groups');
                setOwnedGroups(Array.isArray(groups) ? groups : []);
            } catch (e) {
                console.error('Failed to load profile groups', e);
            }
        };

        loadOwnedGroups();
    }, []);

    const updateAvatar = async (avatarValue: string) => {
        try {
            setUpdatingAvatar(true);
            await onUpdateProfile({ avatar: avatarValue });
        } finally {
            setUpdatingAvatar(false);
        }
    };

    const handleAvatarUpload = async (file: File) => {
        try {
            const token = localStorage.getItem('token') || '';
            const plainBytes = new Uint8Array(await file.arrayBuffer());
            const encryptedBytes = await encryptFileBytesClientSide(plainBytes, token, 'profile_avatar_shared');
            const encryptedFile = new window.File([new Uint8Array(encryptedBytes)], file.name, {
                type: 'application/octet-stream',
                lastModified: file.lastModified || Date.now(),
            });
            const formData = new FormData();
            formData.append('file', encryptedFile);

            const upload = await apiFetch('/files/upload', {
                method: 'POST',
                body: formData,
            });

            if (!upload?.file?.fileId) {
                alert('آپلود تصویر پروفایل موفق نبود');
                return;
            }

            await updateAvatar(upload.file.fileId);
        } catch (error) {
            console.error(error);
            alert('خطا در آپلود تصویر پروفایل');
        }
    };

    const handleAvatarRemove = async () => {
        await updateAvatar('');
    };

    const openAvatarViewer = async () => {
        const fileId = String(user.avatar || '').trim();
        if (!fileId) return;
        try {
            const cachedUrl = await getAvatarDisplayUrl(fileId);
            if (!cachedUrl) return;
            setOpenedProfileImage({ url: cachedUrl, fileId });
        } catch (error) {
            console.debug('Profile avatar preview skipped:', error);
        }
    };

    const handleCancel = () => {
        setName(user.name);
        setUsername(user.username);
        setBio(user.bio);
        setIsEditing(false);
        setUsernameStatus('idle');
        setUsernameHint('');
    };

    const canSave =
        isEditing && !!name.trim() && !!username.trim() && usernameStatus === 'available';

    const toastVariants: Variants = {
        hidden: { scale: 0.9, opacity: 0, },
        visible: { scale: 1, opacity: 1, transition: { duration: 0.2 } },
    };

    return (
        <motion.div
            className="profile"
            variants={toastVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            {/* Header */}
            <div className="profile__header">
                <button onClick={onBack} className="profile__header-back">
                    <ArrowLeft size={22} />
                </button>
                <h1 className="profile__header-title">پروفایل</h1>
                <div className="profile__header-spacer" />
                {!isEditing ? (
                    <button onClick={() => setIsEditing(true)} className="profile__edit-btn">
                        <Pencil size={14} />
                        ویرایش
                    </button>
                ) : (
                    <div className="profile__header-actions">
                        <button onClick={handleCancel} className="profile__cancel-btn">
                            <X size={14} />
                            لغو
                        </button>
                        <button onClick={handleSave} className="profile__save-btn" disabled={!canSave}>
                            <Save size={14} />
                            ذخیره
                        </button>
                    </div>
                )}
            </div>

            <div className="profile__content">
                {/* Avatar & Name Section */}
                <div className="profile__avatar-section">
                    <button type="button" onClick={openAvatarViewer} style={{ background: 'none', border: 'none', padding: 0, cursor: user.avatar ? 'zoom-in' : 'default' }}>
                        <Avatar name={user.name} size="xl" src={user.avatar || ''} />
                    </button>
                    <div className="profile__avatar-actions">
                        <label className="profile__avatar-btn" aria-disabled={updatingAvatar}>
                            <Upload size={14} />
                            آپلود عکس
                            <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        handleAvatarUpload(file);
                                        e.currentTarget.value = '';
                                    }
                                }}
                                disabled={updatingAvatar}
                                hidden
                            />
                        </label>
                        <button
                            type="button"
                            className="profile__avatar-btn profile__avatar-btn--danger"
                            onClick={handleAvatarRemove}
                            disabled={updatingAvatar || !user.avatar}
                        >
                            <Trash2 size={14} />
                            حذف عکس
                        </button>
                    </div>
                    <h2
                        className="profile__name"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                        {user.name}
                        {user.verified ? <VerifiedBadge size={16} /> : null}
                    </h2>
                    <p className="profile__username-display">@{user.username}</p>
                </div>

                <div className="profile__fields">
                    {/* Chat ID */}
                    <div className="profile__chat-id-card">
                        <div className="profile__chat-id-row">
                            <div>
                                <p className="profile__field-label">شناسه چت</p>
                                <p className="profile__chat-id-value" style={{ direction: 'ltr', unicodeBidi: 'plaintext', fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace" }}>{user.chatId}</p>
                            </div>
                            <button
                                onClick={() => handleCopy(user.chatId, 'chatId')}
                                className={cx(
                                    'profile__copy-btn',
                                    copiedField === 'chatId' && 'profile__copy-btn--copied'
                                )}
                            >
                                {copiedField === 'chatId' ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                        </div>
                    </div>

                    {/* Registration Date */}
                    {user.registrationDate && (
                        <div className="profile__chat-id-card" style={{ marginTop: 12 }}>
                            <div className="profile__chat-id-row">
                                <div>
                                    <p className="profile__field-label">تاریخ عضویت</p>
                                    <p className="profile__chat-id-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Calendar size={16} style={{ opacity: 0.7 }} />
                                        {toPersianDigits(user.registrationDate)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Editable Fields */}
                    {/* Name */}
                    <div className="profile__field-group">
                        <label className="profile__field-label" style={{ textAlign: 'right' }}>نام</label>
                        {isEditing ? (
                            <input
                                ref={nameRef}
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onFocus={() => scrollIntoViewOnMobile(nameRef.current)}
                                className="profile__field-input"
                                placeholder="نام شما"
                                maxLength={50}
                            />
                        ) : (
                            <div className="profile__field-static">
                                <p style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    {user.name}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Username */}
                    <div className="profile__field-group">
                        <label className="profile__field-label" style={{ textAlign: 'right' }}>نام کاربری</label>
                        {isEditing ? (
                            <div>
                                <div className="profile__username-wrapper">
                                    <span className="profile__username-at">@</span>
                                    <input
                                        ref={usernameRef}
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                                        onFocus={() => scrollIntoViewOnMobile(usernameRef.current)}
                                        className="profile__field-input profile__field-input--username"
                                        placeholder="نام کاربری"
                                        maxLength={32}
                                    />
                                </div>
                                {!!usernameHint && (
                                    <div className='profile__field-hint'
                                        style={{
                                            marginTop: 6,
                                            fontSize: 12,
                                            color:
                                                usernameStatus === 'available'
                                                    ? 'var(--accent-hover)'
                                                    : usernameStatus === 'taken' || usernameStatus === 'invalid'
                                                        ? '#dc2626'
                                                        : 'var(--text-secondary)',
                                        }}
                                    >
                                        {usernameHint}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="profile__field-static profile__field-static--with-copy">
                                <p>@{user.username}</p>
                                <button
                                    onClick={() => handleCopy(`@${user.username}`, 'username')}
                                    className={cx(
                                        'profile__small-copy-btn',
                                        copiedField === 'username' && 'profile__small-copy-btn--copied'
                                    )}
                                >
                                    {copiedField === 'username' ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Bio */}
                    <div className="profile__field-group">
                        <label className="profile__field-label" style={{ textAlign: 'right' }}>بیوگرافی</label>
                        {isEditing ? (
                            <div>
                                <textarea
                                    ref={bioRef}
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    onFocus={() => scrollIntoViewOnMobile(bioRef.current)}
                                    className="profile__textarea"
                                    placeholder="درباره خود چیزی بنویسید..."
                                    rows={3}
                                    maxLength={150}
                                />
                                <p className="profile__char-count" style={{ textAlign: 'left', direction: 'ltr' }}>{toPersianDigits(bio.length)}/{toPersianDigits(150)}</p>
                            </div>
                        ) : (
                            <div className="profile__field-static">
                                <p className={!user.bio ? 'profile__bio-empty' : ''}>
                                    {user.bio || 'بیوگرافی وجود ندارد'}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Info Note */}
                    <div className="profile__info-note">
                        <p>
                            شناسه چت شما یکتا بوده و قابل تغییر نیست. نام کاربری خود را با دیگران به اشتراک بگذارید تا بتوانند شما را پیدا کرده و پیام بدهند.
                        </p>
                    </div>

                    <div className="profile__groups-card">
                        <div className="profile__groups-title">
                            <Users size={16} />
                            گروه‌های ساخته‌شده توسط شما
                        </div>
                        {ownedGroups.length === 0 ? (
                            <p className="profile__groups-empty">هنوز گروهی نساخته‌اید.</p>
                        ) : (
                            ownedGroups.map((group) => (
                                <div className="profile__group-item" key={group.chatId}>
                                    <div>
                                        <p className="profile__group-name">{group.name}</p>
                                        <p className="profile__group-code">{group.inviteCode}</p>
                                    </div>
                                    <button
                                        type="button"
                                        className="profile__group-copy"
                                        onClick={() => handleCopy(group.inviteLink, `group-${group.chatId}`)}
                                    >
                                        <Link2 size={14} />
                                        {copiedField === `group-${group.chatId}` ? 'کپی شد' : 'کپی لینک دعوت'}
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
            {openedProfileImage && (
                <ImageMediaViewer
                    imageUrl={openedProfileImage.url}
                    token={localStorage.getItem('token') || ''}
                    downloadFile={{ fileId: openedProfileImage.fileId, fileName: `${user.name || 'profile'}.jpg` }}
                    onClose={() => setOpenedProfileImage(null)}
                />
            )}
        </motion.div >
    );
}
