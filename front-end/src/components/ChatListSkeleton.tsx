const SKELETON_ROWS = [
    { nameWidth: '44%', messageWidth: '68%' },
    { nameWidth: '52%', messageWidth: '54%' },
    { nameWidth: '38%', messageWidth: '74%' },
    { nameWidth: '48%', messageWidth: '60%' },
    { nameWidth: '34%', messageWidth: '70%' },
    { nameWidth: '56%', messageWidth: '50%' },
    { nameWidth: '42%', messageWidth: '64%' },
    { nameWidth: '46%', messageWidth: '58%' },
];

export function ChatListSkeleton() {
    return (
        <>
            {SKELETON_ROWS.map((row, idx) => (
                <div key={idx} className="skeleton-chat-item">
                    <div className="skeleton skeleton-avatar" />
                    <div className="skeleton-chat-content">
                        <div className="skeleton-chat-row">
                            <div className="skeleton skeleton-chat-name" style={{ width: row.nameWidth }} />
                            <div className="skeleton skeleton-chat-time" />
                        </div>
                        <div className="skeleton-chat-preview">
                            <div className="skeleton skeleton-chat-message" style={{ width: row.messageWidth }} />
                        </div>
                    </div>
                </div>
            ))}
        </>
    );
}

