export function ChatMessagesSkeleton() {
    return (
        <>
            <div className="skeleton-message-row skeleton-message-row--theirs">
                <div className="skeleton-message-bubble skeleton-message-bubble--theirs" style={{ width: '60%' }} />
            </div>
            <div className="skeleton-message-row skeleton-message-row--mine">
                <div className="skeleton-message-bubble skeleton-message-bubble--mine" style={{ width: '50%' }} />
            </div>
            <div className="skeleton-message-row skeleton-message-row--theirs">
                <div className="skeleton-message-bubble skeleton-message-bubble--theirs" style={{ width: '70%' }} />
            </div>
            <div className="skeleton-message-row skeleton-message-row--mine">
                <div className="skeleton-message-bubble skeleton-message-bubble--mine" style={{ width: '55%' }} />
            </div>
            <div className="skeleton-message-row skeleton-message-row--theirs">
                <div className="skeleton-message-bubble skeleton-message-bubble--theirs" style={{ width: '65%' }} />
            </div>
        </>
    );
}
