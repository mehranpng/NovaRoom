import { ArrowLeft, Copy, Check, Calendar, Link2, MessageCircle, Pencil, X, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { apiFetch } from '../config/api';

interface ContactInfoProps {
    user: User;
    onBack: () => void;
    onOpenChat?: (user: User) => void;
}

export function ContactInfo({ user, onBack, onOpenChat }: ContactInfoProps) {
    const [copied, setCopied] = useState(false);
    const [canEditGroup, setCanEditGroup] = useState(false);
    const [editingGroup, setEditingGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [groupAvatar, setGroupAvatar] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    // bio "گروه" رو نشون نده
    const displayBio = bio === 'گروه' ? '' : bio;

    useEffect(() => {
        // Reset group edit state when user changes
        setEditingGroup(false);
        setSaving(false);
        setError(null);
        setGroupName(String(user.name ?? ''));
        setGroupAvatar(String(user.avatar ?? ''));
    }, [user.chatId, user.name, user.avatar]);

    useEffect(() => {
        let cancelled = false;
        if (!isGroup) {
            setCanEditGroup(false);
            return;
        }

        apiFetch('/profile/me')
            .then((me) => {
                if (cancelled) return;
                setCanEditGroup(Boolean(me?.verified));
            })
            .catch(() => {
                if (cancelled) return;
                setCanEditGroup(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isGroup]);

    const handleCopy = () => {
        const un = (user.username || '').trim();
        if (!un) return;
        const textToCopy = isInviteLink(un) ? un : `@${un}`;
        navigator.clipboard.writeText(textToCopy).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const canOpenChat = Boolean(onOpenChat) && !isGroup && Boolean(user.chatId) && user.chatId !== 'saved';

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

    return (
        <div className="contact-info">
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
                    <Avatar name={user.name} size="xl" online={user.online} src={user.avatar} />
                    <div
                        className="contact-info__name"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                        {user.name}
                        {!isGroup && user.verified ? <VerifiedBadge size={16} /> : null}
                    </div>
                    {!isGroup && (
                        <div className={user.online ? 'contact-info__status contact-info__status--online' : 'contact-info__status'}>
                            {user.online ? 'آنلاین' : 'آفلاین'}
                        </div>
                    )}
                </div>

                {isGroup && canEditGroup && editingGroup && (
                    <div className="contact-info__card">
                        <div className="contact-info__label">ویرایش گروه</div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ fontSize: 12, opacity: 0.7 }}>اسم گروه</div>
                                <input
                                    value={groupName}
                                    onChange={(e) => setGroupName(e.target.value)}
                                    placeholder="مثلاً تیم توسعه"
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: 12,
                                        border: '1px solid var(--border-primary)',
                                        background: 'var(--bg-secondary)',
                                        color: 'var(--text-primary)',
                                        fontSize: 14,
                                        fontFamily: 'Vazir, sans-serif',
                                    }}
                                    disabled={saving}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ fontSize: 12, opacity: 0.7 }}>آواتار گروه (URL)</div>
                                <input
                                    value={groupAvatar}
                                    onChange={(e) => setGroupAvatar(e.target.value)}
                                    placeholder="https://..."
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: 12,
                                        border: '1px solid var(--border-primary)',
                                        background: 'var(--bg-secondary)',
                                        color: 'var(--text-primary)',
                                        fontSize: 14,
                                        fontFamily: 'Vazir, sans-serif',
                                    }}
                                    disabled={saving}
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
                                        color: 'var(--text-primary)',
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
                                        color: 'var(--text-primary)',
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
                        <button
                            type="button"
                            onClick={() => onOpenChat?.(user)}
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 10,
                                padding: '10px 12px',
                                borderRadius: 12,
                                border: '1px solid var(--border-primary)',
                                background: 'var(--bg-secondary)',
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                fontSize: 14,
                                fontWeight: 700,
                                fontFamily: 'Vazir, sans-serif',
                            }}
                            aria-label="Open chat"
                        >
                            پیام
                            <MessageCircle size={18} />
                        </button>
                    </div>
                )}

                {/* بیوگرافی — برای گروه نشون داده نمیشه اگه خالی باشه */}
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

                {!isGroup && user.registrationDate && (
                    <div className="contact-info__card">
                        <div className="contact-info__label">تاریخ ساخت اکانت</div>
                        <div className="contact-info__mono" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Calendar size={16} style={{ opacity: 0.7 }} />
                            {user.registrationDate}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
