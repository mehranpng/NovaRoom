import { ArrowLeft, Copy, Check } from 'lucide-react';
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

    // Reset when switching contacts
    useEffect(() => {
        setCopied(false);
    }, [user.chatId, user.username]);

    const bio = typeof user.bio === 'string' ? user.bio.trim() : '';

    const handleCopyUsername = () => {
        const un = (user.username || '').trim();
        if (!un) return;
        navigator.clipboard.writeText(`@${un}`).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="contact-info">
            <div className="contact-info__header">
                <button className="contact-info__back" onClick={onBack} aria-label="Back" type="button">
                    <ArrowLeft size={20} />
                </button>
                <div className="contact-info__title">مخاطب</div>
                <div className="contact-info__spacer" />
            </div>

            <div className="contact-info__content">
                <div className="contact-info__avatar">
                    <Avatar name={user.name} size="xl" online={user.online} />
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
