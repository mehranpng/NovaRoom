import { MessageCircle } from 'lucide-react';

export function EmptyState() {
    return (
        <div className="empty-state">
            <div className="empty-state__icon">
                <MessageCircle size={36} />
            </div>
            <h2 className="empty-state__title">Welcome to NovaRoom</h2>
            <p className="empty-state__description">
                Select a conversation from the sidebar to start messaging, or create a new one.
            </p>
            <div className="empty-state__footer">
                <span className="empty-state__dot" />
                End-to-end encrypted
            </div>
        </div>
    );
}
