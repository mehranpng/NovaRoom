import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { apiFetch } from '../../config/api';
import { useScrollFade } from '../../hooks/useScrollFade';
import { cx } from '../../utils/cx';
import { notify } from '../../utils/notificationBus';
import './admin.css';

export function AdminRegistrationSection() {
    const { scrolled, handleScroll } = useScrollFade();
    const [registrationOpen, setRegistrationOpen] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        apiFetch('/admin/me')
            .then((data) => setRegistrationOpen(Boolean(data?.registrationOpen)))
            .catch(() => { });
    }, []);

    const toggleRegistration = async () => {
        if (saving) return;
        const nextState = !registrationOpen;
        setSaving(true);
        setRegistrationOpen(nextState);
        try {
            const data = await apiFetch('/admin/registration', {
                method: 'PUT',
                body: JSON.stringify({ open: nextState }),
            });
            setRegistrationOpen(Boolean(data?.open));
            notify({ type: 'success', message: nextState ? 'ثبت‌ نام باز شد' : 'ثبت‌ نام بسته شد' });
        } catch {
            setRegistrationOpen(!nextState);
            notify({ type: 'error', message: 'ذخیره وضعیت ثبت‌ نام ممکن نشد' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />

            <div className="adm-content" onScroll={handleScroll}>
                <div className="adm-card adm-card--switch">
                    <div>
                        <div className="adm-card__title">
                            <UserPlus size={18} />
                            ثبت‌ نام ادمین‌ها
                        </div>
                        <p className="adm-card__text">وقتی بسته باشد، ادمین‌ های سطح ۱ نمی‌ توانند لینک بسازند</p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={registrationOpen}
                        aria-label="وضعیت ثبت‌ نام"
                        className={cx('adm-switch', registrationOpen && 'adm-switch--on')}
                        onClick={toggleRegistration}
                        disabled={saving}
                    >
                        <span className="adm-switch__thumb" />
                    </button>
                </div>
            </div>
        </>
    );
}
