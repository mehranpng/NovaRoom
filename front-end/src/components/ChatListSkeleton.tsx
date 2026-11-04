export function ChatListSkeleton() {
    return (
        <>
            {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="skeleton-chat-item">
                    <div className="skeleton skeleton-avatar" />
                    <div className="skeleton-chat-content">
                        <div className="skeleton skeleton-chat-name" />
                        <div className="skeleton skeleton-chat-message" />
                    </div>
                </div>
            ))}
        </>
    );
}
