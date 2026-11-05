import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Check, Loader2, RotateCcw, Save, Sliders, UserPlus } from 'lucide-react';
import { apiFetch } from '../../config/api';
import { useScrollFade } from '../../hooks/useScrollFade';
import { cx } from '../../utils/cx';
import { notify } from '../../utils/notificationBus';
import './admin.css';

const DEFAULT_AI_DISABLED_MESSAGE = 'به دلایل فنی Nova AI موقتا غیرفعال هست';
const AI_DISABLED_MESSAGE_MAX_LENGTH = 100;

interface AdminSettingsCache {
    registrationOpen: boolean;
    aiEnabled: boolean;
    dailyTokenLimit: string;
    dailySearchLimit: string;
    dailyFileLimit: string;
    disabledMessage: string;
}

let cachedAdminSettings: AdminSettingsCache | null = null;

export function AdminRegistrationSection() {
    const { scrolled, handleScroll } = useScrollFade();
    const [loading, setLoading] = useState(!cachedAdminSettings);
    const [registrationOpen, setRegistrationOpen] = useState(cachedAdminSettings?.registrationOpen ?? true);
    const [saving, setSaving] = useState(false);

    const [aiEnabled, setAiEnabled] = useState(cachedAdminSettings?.aiEnabled ?? true);
    const [aiToggleSaving, setAiToggleSaving] = useState(false);
    const [dailyTokenLimit, setDailyTokenLimit] = useState(cachedAdminSettings?.dailyTokenLimit ?? '20000');
    const [dailySearchLimit, setDailySearchLimit] = useState(cachedAdminSettings?.dailySearchLimit ?? '3');
    const [dailyFileLimit, setDailyFileLimit] = useState(cachedAdminSettings?.dailyFileLimit ?? '5');
    const [aiDisabledMessage, setAiDisabledMessage] = useState(cachedAdminSettings?.disabledMessage ?? DEFAULT_AI_DISABLED_MESSAGE);
    const [savedAiDisabledMessage, setSavedAiDisabledMessage] = useState(cachedAdminSettings?.disabledMessage ?? DEFAULT_AI_DISABLED_MESSAGE);
    const [messageSaving, setMessageSaving] = useState(false);
    const [limitsSaving, setLimitsSaving] = useState(false);

    const [resetTokens, setResetTokens] = useState(true);
    const [resetSearch, setResetSearch] = useState(true);
    const [resetFiles, setResetFiles] = useState(true);
    const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
    const [resettingAll, setResettingAll] = useState(false);

    const applySettings = (settings: AdminSettingsCache) => {
        setRegistrationOpen(settings.registrationOpen);
        setAiEnabled(settings.aiEnabled);
        setDailyTokenLimit(settings.dailyTokenLimit);
        setDailySearchLimit(settings.dailySearchLimit);
        setDailyFileLimit(settings.dailyFileLimit);
        setAiDisabledMessage(settings.disabledMessage);
        setSavedAiDisabledMessage(settings.disabledMessage);
    };

    useEffect(() => {
        if (cachedAdminSettings) {
            applySettings(cachedAdminSettings);
            return;
        }
        let cancelled = false;
        apiFetch('/admin/me')
            .then((data) => {
                if (cancelled) return;
                const settings: AdminSettingsCache = {
                    registrationOpen: Boolean(data?.registrationOpen),
                    aiEnabled: Boolean(data?.aiSettings?.enabled ?? true),
                    dailyTokenLimit: String(data?.aiSettings?.dailyTokenLimit ?? 20000),
                    dailySearchLimit: String(data?.aiSettings?.dailySearchLimit ?? 3),
                    dailyFileLimit: String(data?.aiSettings?.dailyFileLimit ?? 5),
                    disabledMessage: String(data?.aiSettings?.disabledMessage ?? DEFAULT_AI_DISABLED_MESSAGE),
                };
                cachedAdminSettings = settings;
                applySettings(settings);
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const updateCache = (patch: Partial<AdminSettingsCache>) => {
        cachedAdminSettings = {
            registrationOpen,
            aiEnabled,
            dailyTokenLimit,
            dailySearchLimit,
            dailyFileLimit,
            disabledMessage: savedAiDisabledMessage,
            ...patch,
        };
    };

    const parseLimit = (val: string, fallback: number) => {
        const num = Number.parseInt(val, 10);
        return Number.isFinite(num) && num >= 0 ? num : fallback;
    };

    const resolvedDisabledMessage = () => aiDisabledMessage.trim() || DEFAULT_AI_DISABLED_MESSAGE;

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
            updateCache({ registrationOpen: Boolean(data?.open) });
            notify({ type: 'success', message: nextState ? 'ثبت‌ نام باز شد' : 'ثبت‌ نام بسته شد' });
        } catch {
            setRegistrationOpen(!nextState);
            notify({ type: 'error', message: 'ذخیره وضعیت ثبت‌ نام ممکن نشد' });
        } finally {
            setSaving(false);
        }
    };

    const toggleAiEnabled = async () => {
        if (aiToggleSaving) return;
        const nextState = !aiEnabled;
        setAiToggleSaving(true);
        setAiEnabled(nextState);
        try {
            const data = await apiFetch('/admin/ai/settings', {
                method: 'PUT',
                body: JSON.stringify({
                    enabled: nextState,
                    dailyTokenLimit: parseLimit(dailyTokenLimit, 20000),
                    dailySearchLimit: parseLimit(dailySearchLimit, 3),
                    dailyFileLimit: parseLimit(dailyFileLimit, 5),
                    disabledMessage: savedAiDisabledMessage,
                }),
            });
            setAiEnabled(Boolean(data?.enabled));
            if (data?.disabledMessage) setSavedAiDisabledMessage(data.disabledMessage);
            updateCache({
                aiEnabled: Boolean(data?.enabled),
                disabledMessage: String(data?.disabledMessage ?? savedAiDisabledMessage),
            });
            notify({ type: 'success', message: nextState ? 'Nova AI فعال شد' : 'Nova AI غیرفعال شد' });
        } catch {
            setAiEnabled(!nextState);
            notify({ type: 'error', message: 'تغییر وضعیت هوش مصنوعی ممکن نشد' });
        } finally {
            setAiToggleSaving(false);
        }
    };

    const saveDisabledMessage = async () => {
        if (messageSaving) return;
        const nextMessage = resolvedDisabledMessage();
        setMessageSaving(true);
        try {
            const data = await apiFetch('/admin/ai/settings', {
                method: 'PUT',
                body: JSON.stringify({
                    enabled: aiEnabled,
                    dailyTokenLimit: parseLimit(dailyTokenLimit, 20000),
                    dailySearchLimit: parseLimit(dailySearchLimit, 3),
                    dailyFileLimit: parseLimit(dailyFileLimit, 5),
                    disabledMessage: nextMessage,
                }),
            });
            const savedMessage = String(data?.disabledMessage ?? nextMessage);
            setAiDisabledMessage(savedMessage);
            setSavedAiDisabledMessage(savedMessage);
            updateCache({ disabledMessage: savedMessage });
            notify({ type: 'success', message: 'متن پیام غیرفعالی ذخیره شد' });
        } catch {
            notify({ type: 'error', message: 'ذخیره متن پیام ممکن نشد' });
        } finally {
            setMessageSaving(false);
        }
    };

    const saveGlobalLimits = async (event: React.FormEvent) => {
        event.preventDefault();
        if (limitsSaving) return;
        const tokenVal = parseLimit(dailyTokenLimit, -1);
        const searchVal = parseLimit(dailySearchLimit, -1);
        const fileVal = parseLimit(dailyFileLimit, -1);
        if (tokenVal < 0 || searchVal < 0 || fileVal < 0) {
            notify({ type: 'error', message: 'مقادیر محدودیت باید عدد صحیح و نامنفی باشند' });
            return;
        }
        setLimitsSaving(true);
        try {
            const data = await apiFetch('/admin/ai/settings', {
                method: 'PUT',
                body: JSON.stringify({
                    enabled: aiEnabled,
                    dailyTokenLimit: tokenVal,
                    dailySearchLimit: searchVal,
                    dailyFileLimit: fileVal,
                    disabledMessage: savedAiDisabledMessage,
                }),
            });
            setDailyTokenLimit(String(data.dailyTokenLimit));
            setDailySearchLimit(String(data.dailySearchLimit));
            setDailyFileLimit(String(data.dailyFileLimit));
            setSavedAiDisabledMessage(String(data.disabledMessage ?? savedAiDisabledMessage));
            updateCache({
                dailyTokenLimit: String(data.dailyTokenLimit),
                dailySearchLimit: String(data.dailySearchLimit),
                dailyFileLimit: String(data.dailyFileLimit),
                disabledMessage: String(data.disabledMessage ?? savedAiDisabledMessage),
            });
            notify({ type: 'success', message: 'محدودیت‌های سراسری ذخیره شد' });
        } catch {
            notify({ type: 'error', message: 'ذخیره محدودیت‌ها ممکن نشد' });
        } finally {
            setLimitsSaving(false);
        }
    };

    const confirmResetAll = async () => {
        if (resettingAll || (!resetTokens && !resetSearch && !resetFiles)) return;
        setResettingAll(true);
        try {
            await apiFetch('/admin/ai/reset-usage', {
                method: 'POST',
                body: JSON.stringify({
                    tokens: resetTokens,
                    search: resetSearch,
                    files: resetFiles,
                }),
            });
            setResetConfirmOpen(false);
            notify({ type: 'success', message: 'محدودیت‌های انتخاب‌شده برای همه کاربران ریست شد' });
        } catch {
            notify({ type: 'error', message: 'ریست محدودیت‌ها ممکن نشد' });
        } finally {
            setResettingAll(false);
        }
    };

    const anyResetSelected = resetTokens || resetSearch || resetFiles;

    return (
        <>
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />

            <div className="adm-content" onScroll={handleScroll}>
                {loading ? (
                    <>
                        <div className="adm-card adm-card--switch">
                            <div>
                                <div className="skeleton adm-skeleton-line adm-skeleton-line--title" />
                                <div className="skeleton adm-skeleton-line adm-skeleton-line--sub" style={{ marginTop: 8 }} />
                            </div>
                        </div>
                        <div className="adm-card">
                            <div className="skeleton adm-skeleton-line adm-skeleton-line--title" />
                            <div className="skeleton adm-skeleton-line adm-skeleton-line--meta" style={{ marginTop: 14 }} />
                            <div className="skeleton adm-skeleton-line adm-skeleton-line--url" style={{ marginTop: 16, height: 48 }} />
                        </div>
                        <div className="adm-card">
                            <div className="skeleton adm-skeleton-line adm-skeleton-line--title" />
                            <div className="skeleton adm-skeleton-line adm-skeleton-line--url" style={{ marginTop: 14, height: 48 }} />
                            <div className="skeleton adm-skeleton-line adm-skeleton-line--url" style={{ marginTop: 12, height: 48 }} />
                            <div className="skeleton adm-skeleton-line adm-skeleton-line--url" style={{ marginTop: 12, height: 48 }} />
                        </div>
                    </>
                ) : (
                    <>
                <div className="adm-card adm-card--switch">
                    <div>
                        <div className="adm-card__title">
                            <UserPlus size={18} />
                            ثبت‌ نام ادمین‌ها
                        </div>
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

                <div className="adm-section-heading">هوش مصنوعی (Nova AI)</div>

                <div className="adm-card">
                    <div className="adm-card--switch">
                        <div className="adm-card__title">
                            <Bot size={18} />
                            وضعیت Nova AI
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={aiEnabled}
                            aria-label="وضعیت Nova AI"
                            className={cx('adm-switch', aiEnabled && 'adm-switch--on')}
                            onClick={toggleAiEnabled}
                            disabled={aiToggleSaving}
                        >
                            <span className="adm-switch__thumb" />
                        </button>
                    </div>

                    <div className="adm-field" style={{ marginTop: 12 }}>
                        <label className="adm-label">متن نمایش به کاربر هنگام غیرفعال بودن</label>
                        <input
                            type="text"
                            className="adm-input"
                            value={aiDisabledMessage}
                            maxLength={AI_DISABLED_MESSAGE_MAX_LENGTH}
                            onChange={(e) => setAiDisabledMessage(e.target.value)}
                        />
                        <span className="adm-count" dir="ltr">{aiDisabledMessage.length} / {AI_DISABLED_MESSAGE_MAX_LENGTH}</span>
                    </div>

                    {resolvedDisabledMessage() !== savedAiDisabledMessage && (
                        <button
                            type="button"
                            className="adm-btn adm-btn--primary adm-btn--block adm-card__action"
                            onClick={saveDisabledMessage}
                            disabled={messageSaving}
                        >
                            {messageSaving ? <Loader2 size={18} className="adm-spin" /> : <Save size={18} />}
                            ذخیره متن پیام
                        </button>
                    )}
                </div>

                <form className="adm-card" onSubmit={saveGlobalLimits}>
                    <div className="adm-card__title">
                        <Sliders size={18} />
                        محدودیت‌های روزانه سراسری
                    </div>
                    <div className="adm-grid-inputs">
                        <div className="adm-field">
                            <label className="adm-label">کل توکن‌های مجاز روزانه</label>
                            <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                dir="ltr"
                                className="adm-input"
                                value={dailyTokenLimit}
                                onChange={(e) => setDailyTokenLimit(e.target.value)}
                            />
                        </div>
                        <div className="adm-field">
                            <label className="adm-label">تعداد مجاز سرچ روزانه</label>
                            <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                dir="ltr"
                                className="adm-input"
                                value={dailySearchLimit}
                                onChange={(e) => setDailySearchLimit(e.target.value)}
                            />
                        </div>
                        <div className="adm-field">
                            <label className="adm-label">تعداد مجاز تصویر و فایل روزانه</label>
                            <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                dir="ltr"
                                className="adm-input"
                                value={dailyFileLimit}
                                onChange={(e) => setDailyFileLimit(e.target.value)}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="adm-btn adm-btn--primary adm-btn--block adm-card__action"
                        disabled={limitsSaving}
                    >
                        {limitsSaving ? <Loader2 size={18} className="adm-spin" /> : <Save size={18} />}
                        ذخیره محدودیت‌ها
                    </button>
                </form>

                <div className="adm-card">
                    <div className="adm-card__title">
                        <RotateCcw size={18} />
                        ریست محدودیت‌ها برای همه کاربران
                    </div>
                    <div className="adm-check-list">
                        <button
                            type="button"
                            className="adm-check-item adm-tap"
                            onClick={() => setResetTokens((v) => !v)}
                            aria-pressed={resetTokens}
                        >
                            <span>توکن‌های مصرفی</span>
                            <span className={cx('adm-check-box', resetTokens && 'adm-check-box--checked')}>
                                {resetTokens && <Check size={14} />}
                            </span>
                        </button>
                        <button
                            type="button"
                            className="adm-check-item adm-tap"
                            onClick={() => setResetSearch((v) => !v)}
                            aria-pressed={resetSearch}
                        >
                            <span>تعداد سرچ</span>
                            <span className={cx('adm-check-box', resetSearch && 'adm-check-box--checked')}>
                                {resetSearch && <Check size={14} />}
                            </span>
                        </button>
                        <button
                            type="button"
                            className="adm-check-item adm-tap"
                            onClick={() => setResetFiles((v) => !v)}
                            aria-pressed={resetFiles}
                        >
                            <span>تعداد تصویر و فایل</span>
                            <span className={cx('adm-check-box', resetFiles && 'adm-check-box--checked')}>
                                {resetFiles && <Check size={14} />}
                            </span>
                        </button>
                    </div>

                    <button
                        type="button"
                        className="adm-btn adm-btn--block adm-tap adm-card__action"
                        disabled={!anyResetSelected || resettingAll}
                        onClick={() => setResetConfirmOpen(true)}
                    >
                        <RotateCcw size={18} />
                        ریست موارد انتخاب‌شده برای همه
                    </button>
                </div>
                    </>
                )}
            </div>

            <AnimatePresence>
                {resetConfirmOpen && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        style={{ zIndex: 120 }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        onClick={() => !resettingAll && setResetConfirmOpen(false)}
                    >
                        <motion.div
                            className="chat-room-confirm-modal"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, y: 14, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h3 className="chat-room-confirm-modal__title">ریست محدودیت‌های همه کاربران؟</h3>
                            <p className="chat-room-confirm-modal__text">
                                مصرف روزانه موارد انتخاب‌شده برای تمام کاربران صفر خواهد شد. آیا مطمئن هستید؟
                            </p>
                            <div className="chat-room-confirm-modal__actions">
                                <button
                                    type="button"
                                    className="chat-room-confirm-modal__btn"
                                    onClick={() => setResetConfirmOpen(false)}
                                    disabled={resettingAll}
                                >
                                    لغو
                                </button>
                                <button
                                    type="button"
                                    className="chat-room-confirm-modal__btn adm-btn--primary"
                                    onClick={confirmResetAll}
                                    disabled={resettingAll}
                                >
                                    {resettingAll ? <Loader2 size={16} className="adm-spin" /> : 'ریست همه'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
