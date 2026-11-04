import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../utils/clipboard';
import { notify } from '../../utils/notificationBus';
import './admin.css';

interface AdminLinkBoxProps {
    path: string;
    expiresAt: string;
}

const parseUtcMillis = (iso: string) => {
    const raw = String(iso || '').trim();
    if (!raw) return NaN;
    const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`;
    return Date.parse(normalized);
};

const remainingSeconds = (expiresAt: string) => {
    const target = parseUtcMillis(expiresAt);
    if (!Number.isFinite(target)) return 0;
    return Math.max(0, Math.floor((target - Date.now()) / 1000));
};

const formatRemaining = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const rest = String(seconds % 60).padStart(2, '0');
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${minutes}:${rest}`;
    }
    return `${minutes}:${rest}`;
};

export function AdminLinkBox({ path, expiresAt }: AdminLinkBoxProps) {
    const [remaining, setRemaining] = useState(() => remainingSeconds(expiresAt));
    const [copied, setCopied] = useState(false);
    const url = `${window.location.origin}${path}`;

    useEffect(() => {
        const timer = window.setInterval(() => {
            setRemaining(remainingSeconds(expiresAt));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [expiresAt]);

    const expired = remaining <= 0;

    const handleCopy = async () => {
        if (expired) return;
        try {
            await copyText(url);
            setCopied(true);
            notify({ type: 'success', message: 'لینک کپی شد' });
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            notify({ type: 'error', message: 'کپی لینک ممکن نشد' });
        }
    };

    return (
        <div className="adm-card adm-link-item">
            <div className="adm-link-item__top">
                <span className="adm-link-item__url" dir="ltr">{url}</span>
                <span className="adm-link-item__timer">{expired ? 'منقضی شد' : formatRemaining(remaining)}</span>
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
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
            </div>
        </div>
    );
}
