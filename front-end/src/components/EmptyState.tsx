import { MessageCircle } from 'lucide-react';

export function EmptyState() {
    return (
        <div className="empty-state">
            <div className="empty-state__icon">
                <MessageCircle size={36} />
            </div>
            <h2 className="empty-state__title">به نوا روم خوش آمدید</h2>
            <p className="empty-state__description">برای شروع صحبت یک گفتوگو انتخاب کنید یا کاربری را جستوجو کنید.</p>
            <div className="empty-state__footer">
                <span className="empty-state__dot" />
                رمزگذاری سرتاسری
            </div>
        </div>
    );
}
