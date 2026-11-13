import { Copy, Check, Pencil, Save, Calendar, Upload, Trash2, UserRound, AtSign, Hash, FileText, ChevronLeft, LogOut } from 'lucide-react';
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { User } from '../types';
import { Avatar, getAvatarDisplayUrl } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { useChessChampion } from '../contexts/ChessChampionContext';
import { cx } from '../utils/cx';
import { apiFetch } from '../config/api';
import { ImageMediaViewer } from './ImageMediaViewer';
import { ImageEditorModal } from './ImageEditorModal';
import { encryptAvatarBytesClientSide } from '../utils/e2ee';
import { screenVariants } from '../utils/screenMotion';
import { useScrollFade } from '../hooks/useScrollFade';
import { copyText } from '../utils/clipboard';
import { isLtrText } from '../utils/format';

interface ProfileProps {
    user: User;
    mode: 'view' | 'edit';
    onUpdateProfile: (updates: Partial<Pick<User, 'name' | 'username' | 'bio' | 'avatar'>>) => Promise<void> | void;
    onEdit: () => void;
    onFinishEdit: () => void;
    onLogout: () => void;
}

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
const toPersianDigits = (value: string | number): string => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);

export function Profile({ user, mode, onUpdateProfile, onEdit, onFinishEdit, onLogout }: ProfileProps) {
    const { scrolled, handleScroll } = useScrollFade();
    const isEditing = mode === 'edit';
    const [saving, setSaving] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [name, setName] = useState(user.name);
    const [username, setUsername] = useState(user.username);
    const [bio, setBio] = useState(user.bio);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [updatingAvatar, setUpdatingAvatar] = useState(false);
    const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
    const [openedProfileImage, setOpenedProfileImage] = useState<{ url: string; fileId: string } | null>(null);
    const navigate = useNavigate();
    const location = useLocation();
    const { isChampion } = useChessChampion();
    const isChessChampion = Boolean(user.isChessChampion ?? isChampion(user.chatId));

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
        copyText(text)
            .then(() => {
                setCopiedField(field);
                setTimeout(() => setCopiedField(null), 2000);
            })
            .catch(() => alert('کپی انجام نشد'));
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

        if (trimmed.length < 3) {
            setUsernameStatus('invalid');
            setUsernameHint('نام کاربری باید حداقل ۳ کاراکتر باشد.');
            return;
        }

        if (trimmed.length > 32) {
            setUsernameStatus('invalid');
            setUsernameHint('حداکثر ۳۲ کاراکتر');
            return;
        }

        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            setUsernameStatus('invalid');
            setUsernameHint('فقط حروف لاتین، اعداد و آندرلاین.');
            return;
        }

        
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

    const handleSave = async () => {
        const trimmedName = name.trim();
        const trimmedUsername = username.trim();
        if (!trimmedName || !trimmedUsername) return;
        if (usernameStatus !== 'available') return;

        setSaving(true);
        try {
            await onUpdateProfile({
                name: trimmedName,
                username: trimmedUsername,
                bio: bio.trim(),
            });
            onFinishEdit();
        } catch (error) {
            console.error('Failed to update profile', error);
            alert('ذخیره تغییرات پروفایل انجام نشد.');
        } finally {
            setSaving(false);
        }
    };

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
            const encryptedBytes = await encryptAvatarBytesClientSide(plainBytes, token);
            const encryptedFile = new window.File([encryptedBytes as BlobPart], file.name, {
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
            const params = new URLSearchParams(location.search);
            params.set('avatar', '1');
            navigate({ pathname: location.pathname, search: `?${params.toString()}` });
        } catch (error) {
            console.debug('Profile avatar preview skipped:', error);
        }
    };
    useEffect(() => {
        const hasAvatarRoute = new URLSearchParams(location.search).get('avatar') === '1';
        if (hasAvatarRoute || !openedProfileImage) return;
        setOpenedProfileImage(null);
    }, [location.search, openedProfileImage]);

    const handleCancel = () => {
        setName(user.name);
        setUsername(user.username);
        setBio(user.bio);
        setUsernameStatus('idle');
        setUsernameHint('');
        onFinishEdit();
    };

    useEffect(() => {
        if (!isEditing) return;
        setName(user.name);
        setUsername(user.username);
        setBio(user.bio);
    }, [isEditing, user.name, user.username, user.bio]);

    useEffect(() => {
        if (!showLogoutConfirm) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setShowLogoutConfirm(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [showLogoutConfirm]);

    const canSave =
        isEditing && !!name.trim() && !!username.trim() && usernameStatus === 'available' && !saving;

    return (
        <motion.div
            className="profile"
            variants={screenVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />
            <div className="profile__header">
                {isEditing && (
                    <div className="profile__header-side">
                        <button onClick={handleCancel} className="profile__header-back back-icon-btn" aria-label="بازگشت به پروفایل">
                            <ChevronLeft size={22} />
                        </button>
                    </div>
                )}
                <h1 className="profile__header-title">{isEditing ? 'ویرایش پروفایل' : 'پروفایل'}</h1>
                {isEditing && (
                    <div className="profile__header-actions">
                        <button onClick={handleSave} className="profile__save-btn" disabled={!canSave}>
                            <Save size={15} />
                            <span className="profile__btn-label">{saving ? 'در حال ذخیره' : 'ذخیره'}</span>
                        </button>
                    </div>
                )}
            </div>

            <div className="profile__content" onScroll={handleScroll}>
                <div className={`profile__hero${isChessChampion ? ' profile__hero--chess-champion' : ''}`}>
                    <span className="profile__hero-orb profile__hero-orb--one" aria-hidden="true" />
                    <span className="profile__hero-orb profile__hero-orb--two" aria-hidden="true" />

                    <button
                        type="button"
                        onClick={openAvatarViewer}
                        className="profile__avatar-wrap"
                        aria-label="مشاهده تصویر پروفایل"
                        style={{ cursor: user.avatar ? 'zoom-in' : 'default' }}
                    >
                        <Avatar name={user.name} size="xl" src={user.avatar || ''} userId={user.chatId} isChessChampion={user.isChessChampion} />
                    </button>

                    <h2 className="profile__name">
                        {user.name}
                        {user.verified ? <VerifiedBadge size={20} /> : null}
                    </h2>
                    <p className="profile__username-display">@{user.username}</p>

                    {isEditing && (
                        <div className="profile__avatar-actions">
                            <label className="profile__avatar-btn profile__avatar-btn--upload" aria-disabled={updatingAvatar}>
                                <Upload size={14} />
                                {updatingAvatar ? 'در حال آپلود...' : 'آپلود تصویر'}
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
                                                alert('فرمت GIF برای عکس پروفایل پشتیبانی نمی‌شود. لطفاً یک تصویر ثابت انتخاب کنید.');
                                            } else {
                                                setPendingAvatarFile(file);
                                            }
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
                                حذف تصویر
                            </button>
                        </div>
                    )}
                </div>

                <div className="profile__fields">
                    {!isEditing && (
                        <button type="button" className="profile__edit-action" onClick={onEdit}>
                            <Pencil size={17} />
                            ویرایش پروفایل
                        </button>
                    )}

                    {isEditing ? (
                        <div className="profile__card">
                            <div className="profile__section-title">
                                <span className="profile__section-icon"><Pencil size={15} /></span>
                                ویرایش اطلاعات
                            </div>

                            <div className="profile__field-group">
                                <label className="profile__field-label">نام نمایشی</label>
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
                            </div>

                            <div className="profile__field-group">
                                <label className="profile__field-label">نام کاربری</label>
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
                                    <div
                                        className="profile__field-hint"
                                        style={{
                                            color:
                                                usernameStatus === 'available'
                                                    ? 'var(--accent-hover)'
                                                    : usernameStatus === 'taken' || usernameStatus === 'invalid'
                                                        ? 'var(--accent-danger)'
                                                        : 'var(--text-secondary)',
                                        }}
                                    >
                                        {usernameHint}
                                    </div>
                                )}
                            </div>

                            <div className="profile__field-group">
                                <label className="profile__field-label">بیوگرافی</label>
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
                                <p className="profile__char-count">{toPersianDigits(bio.length)}/{toPersianDigits(150)}</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="profile__card">
                                <div className="profile__section-title">
                                    <span className="profile__section-icon"><UserRound size={15} /></span>
                                    اطلاعات حساب
                                </div>

                                <div className="profile__info-row">
                                    <span className="profile__info-icon"><UserRound size={16} /></span>
                                    <div className="profile__info-body">
                                        <span className="profile__info-label">نام</span>
                                        <span className="profile__info-value">{user.name}</span>
                                    </div>
                                </div>

                                <div className="profile__info-row">
                                    <span className="profile__info-icon"><AtSign size={16} /></span>
                                    <div className="profile__info-body">
                                        <span className="profile__info-label">نام کاربری</span>
                                        <span className="profile__info-value" style={{ direction: 'ltr', textAlign: 'right' }}>@{user.username}</span>
                                    </div>
                                    <button
                                        onClick={() => handleCopy(`@${user.username}`, 'username')}
                                        className={cx('profile__copy-btn', copiedField === 'username' && 'profile__copy-btn--copied')}
                                        aria-label="کپی نام کاربری"
                                    >
                                        {copiedField === 'username' ? <Check size={16} /> : <Copy size={16} />}
                                    </button>
                                </div>

                                <div className="profile__info-row">
                                    <span className="profile__info-icon"><Hash size={16} /></span>
                                    <div className="profile__info-body">
                                        <span className="profile__info-label">شناسه چت</span>
                                        <span className="profile__info-value profile__info-value--mono">{user.chatId}</span>
                                    </div>
                                    <button
                                        onClick={() => handleCopy(user.chatId, 'chatId')}
                                        className={cx('profile__copy-btn', copiedField === 'chatId' && 'profile__copy-btn--copied')}
                                        aria-label="کپی شناسه چت"
                                    >
                                        {copiedField === 'chatId' ? <Check size={16} /> : <Copy size={16} />}
                                    </button>
                                </div>

                                {user.registrationDate && (
                                    <div className="profile__info-row">
                                        <span className="profile__info-icon"><Calendar size={16} /></span>
                                        <div className="profile__info-body">
                                            <span className="profile__info-label">تاریخ عضویت</span>
                                            <span className="profile__info-value">{toPersianDigits(user.registrationDate)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="profile__card">
                                <div className="profile__section-title">
                                    <span className="profile__section-icon"><FileText size={15} /></span>
                                    بیوگرافی
                                </div>
                                <p className={cx('profile__bio-text', !user.bio && 'profile__bio-text--empty', !!user.bio && isLtrText(user.bio) && 'profile__bio-text--ltr')}>
                                    {user.bio || 'هنوز بیوگرافی اضافه نکرده‌اید.'}
                                </p>
                            </div>
                        </>
                    )}

                    {!isEditing && (
                        <>
                            <button type="button" className="profile__logout-btn" onClick={() => setShowLogoutConfirm(true)}>
                                <LogOut size={17} />
                                خروج از حساب کاربری
                            </button>
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
                        void handleAvatarUpload(file);
                    }}
                    onCancel={() => setPendingAvatarFile(null)}
                />
            )}

            <AnimatePresence>
                {showLogoutConfirm && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        style={{ zIndex: 140 }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        onClick={() => setShowLogoutConfirm(false)}
                    >
                        <motion.div
                            className="chat-room-confirm-modal"
                            onClick={(event) => event.stopPropagation()}
                            initial={{ opacity: 0, y: 14, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h3 className="chat-room-confirm-modal__title">خروج از حساب کاربری؟</h3>
                            <p className="chat-room-confirm-modal__text">
                                با خروج از حساب، برای ورود مجدد باید ایمیل و رمز عبور خود را وارد کنید.
                            </p>
                            <div className="chat-room-confirm-modal__actions">
                                <button
                                    type="button"
                                    className="chat-room-confirm-modal__btn"
                                    onClick={() => setShowLogoutConfirm(false)}
                                >
                                    لغو
                                </button>
                                <button
                                    type="button"
                                    className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger"
                                    onClick={() => {
                                        setShowLogoutConfirm(false);
                                        onLogout();
                                    }}
                                >
                                    خروج از حساب
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
