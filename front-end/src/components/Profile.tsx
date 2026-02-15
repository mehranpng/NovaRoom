import { ArrowLeft, Copy, Check, Pencil, X, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { cx } from '../utils/cx';
import { apiFetch } from '../config/api';

interface ProfileProps {
    user: User;
    onBack: () => void;
    onUpdateProfile: (updates: Partial<Pick<User, 'name' | 'username' | 'bio'>>) => void;
}

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export function Profile({ user, onBack, onUpdateProfile }: ProfileProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [name, setName] = useState(user.name);
    const [username, setUsername] = useState(user.username);
    const [bio, setBio] = useState(user.bio);
    const [copiedField, setCopiedField] = useState<string | null>(null);

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

    const createdAtLabel = user.createdAt
        ? new Date(user.createdAt).toLocaleDateString('fa-IR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        })
        : 'نامشخص';

    return (
        <div className="profile">
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
                    <Avatar name={user.name} size="xl" online={true} />
                    <h2
                        className="profile__name"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                        {user.name}
                        {user.verified ? <VerifiedBadge size={16} /> : null}
                    </h2>
                    <p className="profile__username-display">@{user.username}</p>
                    <span className="profile__online-badge">
                        <span className="profile__online-dot" />
                        آنلاین
                    </span>
                </div>

                <div className="profile__fields">
                    {/* Chat ID */}
                    <div className="profile__chat-id-card">
                        <div className="profile__chat-id-row">
                            <div>
                                <p className="profile__field-label">شناسه چت</p>
                                <p className="profile__chat-id-value">{user.chatId}</p>
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

                    {/* Editable Fields */}
                    <div className="profile__field-group">
                        <label className="profile__field-label">تاریخ ساخت اکانت</label>
                        <div className="profile__field-static">
                            <p>{createdAtLabel}</p>
                        </div>
                    </div>

                    {/* Name */}
                    <div className="profile__field-group">
                        <label className="profile__field-label">نام</label>
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
                        <label className="profile__field-label">نام کاربری</label>
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
                                                    ? '#16a34a'
                                                    : usernameStatus === 'taken' || usernameStatus === 'invalid'
                                                        ? '#dc2626'
                                                        : '#6b7280',
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
                        <label className="profile__field-label">بیوگرافی</label>
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
                                <p className="profile__char-count">{bio.length}/150</p>
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
                </div>
            </div>
        </div>
    );
}
