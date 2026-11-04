const ROW_WIDTHS = [46, 62, 34, 72, 54, 40, 66, 30, 58, 48, 38, 70, 44, 60, 32, 64, 50, 42, 68, 36];

export function ChatMessagesSkeleton({ count = ROW_WIDTHS.length }: { count?: number } = {}) {
    return (
        <div className="chat-messages-skeleton" aria-hidden="true">
            {ROW_WIDTHS.slice(0, count).map((width, index) => (
                <div key={index} className={`skeleton-message-row ${index % 3 === 1 ? 'skeleton-message-row--mine' : 'skeleton-message-row--theirs'}`}>
                    <div
                        className="skeleton-message-bubble"
                        style={{ width: `${width}%`, height: index % 4 === 0 ? 54 : 38 }}
                    />
                </div>
            ))}
        </div>
    );
}
