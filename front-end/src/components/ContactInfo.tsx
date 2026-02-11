import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { apiFetch } from '../config/api';

interface ContactInfoProps {
    user: User;
    onBack: () => void;
}

export function ContactInfo({ user, onBack }: ContactInfoProps) {
    const [resolvedUser, setResolvedUser] = useState<User>(user);

    // Reset when switching contacts
    useEffect(() => {
        setResolvedUser(user);
    }, [user.chatId, user.username]);

    // Some endpoints (e.g. chats list) may not include full user fields like bio.
    // If bio is missing, try to resolve it from the search endpoint.
    useEffect(() => {
        const currentBio = typeof user.bio === 'string' ? user.bio.trim() : '';
        if (currentBio) return;
        if (!user.username) return;

        let cancelled = false;
        (async () => {
            try {
                const users = await apiFetch(`/users/search?query=${encodeURIComponent(user.username)}`);
                if (cancelled) return;

                if (Array.isArray(users) && users.length > 0) {
                    const exact = users.find((u: any) => (u?.username || '').toLowerCase() === user.username.toLowerCase()) || users[0];
                    setResolvedUser(prev => ({
                        ...prev,
                        ...exact,
                        chatId: prev.chatId || exact?.chatId || exact?.username || '',
                        online: typeof prev.online === 'boolean' ? prev.online : Boolean(exact?.online),
                    }));
                }
            } catch {
                // ignore, we will just show fallback
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [user.username, user.bio]);

    const bio = typeof resolvedUser.bio === 'string' ? resolvedUser.bio.trim() : '';

    return (
        <div className="contact-info">
            <div className="contact-info__header">
                <button className="contact-info__back" onClick={onBack} aria-label="Back" type="button">
                    <ArrowLeft size={20} />
                </button>
                <div className="contact-info__title">Contact</div>
                <div className="contact-info__spacer" />
            </div>

            <div className="contact-info__content">
                <div className="contact-info__avatar">
                    <Avatar name={resolvedUser.name} size="xl" online={resolvedUser.online} />
                    <div className="contact-info__name">{resolvedUser.name}</div>
                    <div className={resolvedUser.online ? 'contact-info__status contact-info__status--online' : 'contact-info__status'}>
                        {resolvedUser.online ? 'Online' : 'Offline'}
                    </div>
                </div>

                <div className="contact-info__card">
                    <div className="contact-info__label">Bio</div>
                    <div className={bio ? 'contact-info__bio' : 'contact-info__bio contact-info__bio--empty'}>
                        {bio || 'No bio'}
                    </div>
                </div>

                <div className="contact-info__card">
                    <div className="contact-info__label">Username</div>
                    <div className="contact-info__mono">@{resolvedUser.username}</div>
                </div>
            </div>
        </div>
    );
}
