import { ArrowLeft, Copy, Check, Calendar, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface ContactInfoProps {
    user: User;
    onBack: () => void;
}

export function ContactInfo({ user, onBack }: ContactInfoProps) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setCopied(false);
    }, [user.chatId, user.username]);

    const bio = typeof user.bio === 'string' ? user.bio.trim() : '';

    const isInviteLink = (un: string) =>
        un.startsWith('senoroom://') || un.startsWith('novaroom://');

    const isGroup = user.username ? isInviteLink(user.username) : false;

    // bio "گروه" رو نشون نده
    const displayBio = bio === 'گروه' ? '' : bio;

    const handleCopy = () => {
        const un = (user.username || '').trim();
        if (!un) return;
        const textToCopy = isInviteLink(un) ? un : `@${un}`;
        navigator.clipboard.writeText(textToCopy).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="contact-info">
            <div className="contact-info__header">
                <button className="contact-info__back" onClick={onBack} aria-label="Back" type="button">
                    <ArrowLeft size={20} />
                </button>
                <div className="contact-info__title">{isGroup ? 'اطلاعات گروه' : 'مخاطب'}</div>
                <div className="contact-info__spacer" />
            </div>

            <div className="contact-info__content">
                <div className="contact-info__avatar">
                    <Avatar name={user.name} size="xl" online={user.online} src={user.avatar} />
                    <div
                        className="contact-info__name"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                        {user.name}
                        {user.verified ? <VerifiedBadge size={16} /> : null}
                    </div>
                    {!isGroup && (
                        <div className={user.online ? 'contact-info__status contact-info__status--online' : 'contact-info__status'}>
                            {user.online ? 'آنلاین' : 'آفلاین'}
                        </div>
                    )}
                </div>

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
                        <div className="contact-info__label">تاریخ عضویت</div>
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