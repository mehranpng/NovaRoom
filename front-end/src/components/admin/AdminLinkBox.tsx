import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { copyText } from '../../utils/clipboard';
import { notify } from '../../utils/notificationBus';
import './admin.css';

interface AdminLinkBoxProps {
    path: string;
    expiresAt: string;
}

const remainingSeconds = (expiresAt: string) => {
    const target = Date.parse(expiresAt);
    if (!Number.isFinite(target)) return 0;
    return Math.max(0, Math.floor((target - Date.now()) / 1000));
};

export function AdminLinkBox({ path, expiresAt }: AdminLinkBoxProps) {
    const [remaining, setRemaining] = useState(() => remainingSeconds(expiresAt));
    const url = `${window.location.origin}${path}`;

    useEffect(() => {
        const timer = window.setInterval(() => {
            setRemaining(remainingSeconds(expiresAt));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [expiresAt]);

    const expired = remaining <= 0;
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');

    const handleCopy = async () => {
        if (expired) return;
        try {
            await copyText(url);
            notify({ type: 'success', message: 'لینک کپی شد' });
        } catch {
            notify({ type: 'error', message: 'کپی لینک ممکن نشد' });
        }
    };

    return (
        <div className="adm-card adm-link-item">
            <div className="adm-link-item__top">
                <input className="adm-link-item__url" readOnly value={url} dir="ltr" onFocus={(event) => event.currentTarget.select()} aria-label="لینک تغییر رمز" />
                <span className="adm-link-item__timer">{expired ? 'منقضی شد' : `${minutes}:${seconds}`}</span>
            </div>
            <div className="adm-link-item__bottom">
                <span className="adm-link-item__meta">لینک تغییر رمز عبور</span>
                <button
                    type="button"
                    className="adm-icon-btn adm-tap"
                    onClick={handleCopy}
                    disabled={expired}
                    aria-label="کپی لینک"
                >
                    <Copy size={16} />
                </button>
            </div>
        </div>
    );
}
