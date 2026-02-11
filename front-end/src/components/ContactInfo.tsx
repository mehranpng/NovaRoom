import { ArrowLeft } from 'lucide-react';
import type { User } from '../types';
import { Avatar } from './Avatar';

interface ContactInfoProps {
    user: User;
    onBack: () => void;
}

export function ContactInfo({ user, onBack }: ContactInfoProps) {
    return (
        <div className="contact-info">
            <div className="contact-info__header">
                <button className="contact-info__back" onClick={onBack} aria-label="Back">
                    <ArrowLeft size={20} />
                </button>
                <div className="contact-info__title">Contact</div>
                <div className="contact-info__spacer" />
            </div>

            <div className="contact-info__content">
                <div className="contact-info__avatar">
                    <Avatar name={user.name} size="xl" online={user.online} />
                    <div className="contact-info__name">{user.name}</div>
                    <div className={user.online ? 'contact-info__status contact-info__status--online' : 'contact-info__status'}>
                        {user.online ? 'Online' : 'Offline'}
                    </div>
                </div>

                <div className="contact-info__card">
                    <div className="contact-info__label">Bio</div>
                    <div className={user.bio ? 'contact-info__bio' : 'contact-info__bio contact-info__bio--empty'}>
                        {user.bio || 'No bio'}
                    </div>
                </div>

                <div className="contact-info__card">
                    <div className="contact-info__label">Username</div>
                    <div className="contact-info__mono">@{user.username}</div>
                </div>
            </div>
        </div>
    );
}
