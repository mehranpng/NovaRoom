import { ArrowLeft, Copy, Check, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface ContactInfoProps {
    user: User;
    onBack: () => void;
}

export function ContactInfo({ user, onBack }: ContactInfoProps) {
    const [copied, setCopied] = useState(false);
    const [copiedInvite, setCopiedInvite] = useState(false);

    // Reset when switching contacts
    useEffect(() => {
        setCopied(false);
        setCopiedInvite(false);
    }, [user.chatId, user.username]);

    const bio = typeof user.bio === 'string' ? user.bio.trim() : '';

    const createdAtLabel = useMemo(() => {
        if (!user.createdAt) return 'نامشخص';
        return new Date(user.createdAt).toLocaleDateString('fa-IR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    }, [user.createdAt]);

    const birthDateLabel = user.birthDate
        ? new Date(user.birthDate).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'ثبت نشده';

    const members = ((user as any).members || []) as User[];
    const onlineCount = members.filter((m) => m.online).length;
    const offlineCount = Math.max(0, members.length - onlineCount);

    const handleCopyUsername = () => {
        const un = (user.username || '').trim();
        if (!un) return;
        navigator.clipboard.writeText(`@${un}`).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const handleCopyInvite = () => {
        const invite = (user as any).inviteLink;
        if (!invite) return;
        navigator.clipboard.writeText(String(invite)).catch(() => { });
        setCopiedInvite(true);
        setTimeout(() => setCopiedInvite(false), 1500);
    };

    return (
        <div className="contact-info">
            <div className="contact-info__header">
                <button className="contact-info__back" onClick={onBack} aria-label="Back" type="button">
                    <ArrowLeft size={20} />
                </button>
                <div className="contact-info__title">اطلاعات</div>
                <div className="contact-info__spacer" />
            </div>

            <div className="contact-info__content">
                <div className="contact-info__avatar">
                    <Avatar name={user.name} size="xl" online={user.online} avatar={user.avatar} />
                    <div
                        className="contact-info__name"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                        {user.name}
                        {user.verified ? <VerifiedBadge size={16} /> : null}
                    </div>
                    <div className={user.online ? 'contact-info__status contact-info__status--online' : 'contact-info__status'}>
                        {user.online ? 'آنلاین' : 'آفلاین'}
                    </div>
                </div>

                {(user as any).isGroup && (
                    <div className="contact-info__card">
                        <div className="contact-info__label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Users size={16} /> وضعیت اعضا
                        </div>
                        <div className="contact-info__bio">{onlineCount} آنلاین • {offlineCount} آفلاین</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
                            <div className="contact-info__mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{(user as any).inviteLink}</div>
                            <button
                                type="button"
                                className="icon-btn"
                                aria-label="Copy invite link"
                                onClick={handleCopyInvite}
                            >
                                {copiedInvite ? <Check size={18} /> : <Copy size={18} />}
                            </button>
                        </div>
                    </div>
                )}

                <div className="contact-info__card">
                    <div className="contact-info__label">تاریخ ساخت اکانت</div>
                    <div className="contact-info__bio">{createdAtLabel}</div>
                </div>

                <div className="contact-info__card">
                    <div className="contact-info__label">تاریخ تولد</div>
                    <div className="contact-info__bio">{birthDateLabel}</div>
                </div>

                <div className="contact-info__card">
                    <div className="contact-info__label">بیوگرافی</div>
                    <div className={bio ? 'contact-info__bio' : 'contact-info__bio contact-info__bio--empty'}>
                        {bio || 'بدون بیوگرافی'}
                    </div>
                </div>

                <div className="contact-info__card">
                    <div className="contact-info__label">نام کاربری</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div className="contact-info__mono">@{user.username}</div>
                        <button
                            type="button"
                            className="icon-btn"
                            aria-label="Copy username"
                            onClick={handleCopyUsername}
                            disabled={!user.username}
                        >
                            {copied ? <Check size={18} /> : <Copy size={18} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
