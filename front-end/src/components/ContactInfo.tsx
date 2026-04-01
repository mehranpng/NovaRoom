import { ArrowLeft, Copy, Check, Calendar, Link2, MessageCircle, Pencil, X, Save, Image as ImageIcon, Trash2, RotateCcw } from 'lucide-react';
import { motion, type Variants } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { apiFetch } from '../config/api';

interface ContactInfoProps {
    user: User;
    onBack: () => void;
    onOpenChat?: (user: User) => void;
    onOpenMembers?: () => void;
}

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function extractUploadedFileId(res: any): string {
    const file = res?.file || {};
    return String(file.fileId || file.id || file.file_id || file.path || '').trim();
}

export function ContactInfo({ user, onBack, onOpenChat }: ContactInfoProps) {
    const [copied, setCopied] = useState(false);
    const [canEditGroup, setCanEditGroup] = useState(false);
    const [editingGroup, setEditingGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [groupAvatar, setGroupAvatar] = useState(''); // stores fileId (draft)
    const [avatarTouched, setAvatarTouched] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [membersLoading, setMembersLoading] = useState(false);
    const [groupMembers, setGroupMembers] = useState<Array<{ chatId: string; name: string; username: string; avatar: string; online?: boolean }>>([]);
    const [registrationDate, setRegistrationDate] = useState<string>('');
    const [registrationLoading, setRegistrationLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        setEditingGroup(false);
        setSaving(false);
        setError(null);
        setGroupName(String(user.name ?? ''));
        setGroupAvatar(String(user.avatar ?? ''));
        setAvatarTouched(false);
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

    useEffect(() => {
        let cancelled = false;
        if (!isGroup || !user.chatId) {
            setGroupMembers([]);
            setMembersLoading(false);
            return;
        }
        setMembersLoading(true);
        apiFetch(`/chats/${encodeURIComponent(user.chatId)}/members`)
            .then((res) => {
                if (cancelled) return;
                setGroupMembers(Array.isArray(res) ? res : []);
            })
            .catch(() => {
                if (cancelled) return;
                setGroupMembers([]);
            })
            .finally(() => {
                if (cancelled) return;
                setMembersLoading(false);
            });
        return () => { cancelled = true; };
    }, [isGroup, user.chatId]);

    useEffect(() => {
        let cancelled = false;
        if (isGroup) {
            setRegistrationDate('');
            setRegistrationLoading(false);
            return;
        }

        if (user.registrationDate) {
            setRegistrationDate(String(user.registrationDate));
            setRegistrationLoading(false);
            return;
        }

        const username = String(user.username || '').trim();
        if (!username) {
            setRegistrationDate('');
            setRegistrationLoading(false);
            return;
        }

        setRegistrationLoading(true);
        apiFetch(`/users/search?q=${encodeURIComponent(username)}`)
            .then((rows) => {
                if (cancelled) return;
                const list = Array.isArray(rows) ? rows : [];
                const normalized = username.toLowerCase();
                const exact = list.find((r: any) => String(r?.username || '').toLowerCase() === normalized)
                    || list.find((r: any) => String(r?.chatId || '') === String(user.chatId || ''));
                const resolved = exact?.registrationDate || '';
                setRegistrationDate(String(resolved || ''));
            })
            .catch(() => {
                if (cancelled) return;
                setRegistrationDate('');
            })
            .finally(() => {
                if (cancelled) return;
                setRegistrationLoading(false);
            });

        return () => { cancelled = true; };
    }, [isGroup, user.chatId, user.username, user.registrationDate]);

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
            const form = new FormData();
            form.append('file', file);
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

                {isGroup && (
                    <div className="contact-info__card">
                        <div className="contact-info__label">اعضا</div>
                        {membersLoading ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {[0, 1, 2, 3].map((idx) => (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg-secondary)', opacity: 0.7 }} />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ height: 10, borderRadius: 8, background: 'var(--bg-secondary)', marginBottom: 6, opacity: 0.8 }} />
                                            <div style={{ width: '60%', height: 9, borderRadius: 8, background: 'var(--bg-secondary)', opacity: 0.6 }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {groupMembers.map((member) => (
                                    <div key={member.chatId || member.username} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <Avatar name={member.name || member.username || 'کاربر'} size="sm" src={member.avatar || ''} online={Boolean(member.online)} />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 13, color: 'var(--text-primary, #fff)' }}>{member.name || member.username || 'کاربر'}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-secondary, #bbb)', direction: 'ltr' }}>
                                                @{member.username || member.chatId}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {groupMembers.length === 0 && (
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary, #bbb)' }}>عضوی برای نمایش وجود ندارد</div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {isGroup && canEditGroup && editingGroup && (
                    <div className="contact-info__card">
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
                                        background: 'var(--bg-secondary)',
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
                                                    const ok = window.confirm('عکس گروه حذف شود؟ (بعد از زدن «ذخیره» اعمال می‌شود)');
                                                    if (!ok) return;
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
                                color: 'var(--text-primary, #fff)',
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

                {!isGroup && (registrationLoading || registrationDate) && (
                    <div className="contact-info__card">
                        <div className="contact-info__label">تاریخ عضویت</div>
                        {registrationLoading ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 16, height: 16, borderRadius: 4, background: 'var(--bg-secondary)', opacity: 0.7 }} />
                                <div style={{ width: 120, height: 12, borderRadius: 8, background: 'var(--bg-secondary)', opacity: 0.8 }} />
                            </div>
                        ) : (
                            <div className="contact-info__mono" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Calendar size={16} style={{ opacity: 0.7 }} />
                                {registrationDate}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
