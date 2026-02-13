import { MessageCircle } from 'lucide-react';

export function EmptyState() {
    return (
        <div className="empty-state">
            <div className="empty-state__icon">
                <MessageCircle size={36} />
            </div>
            <h2 className="empty-state__title">به نوا روم خوش آمدید</h2>
            <p className="empty-state__description">
                یک گفتگو را از نوار کناری انتخاب کرده و شروع به صحبت کنید یا یک گفتگوی جدید ایجاد نمایید.
            </p>
            <div className="empty-state__footer">
                <span className="empty-state__dot" />
                رمزگذاری سرتاسری
            </div>
        </div>
    );
}
