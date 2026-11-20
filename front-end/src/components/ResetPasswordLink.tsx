import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { API_BASE_URL } from '../config/api';
import { AlertTriangle, Check, Key, Link2Off, Loader2, ShieldCheck } from 'lucide-react';
import { PasswordField } from './PasswordField';
import { RecoveryPhraseInputs } from './RecoveryPhraseInputs';
import { screenVariants } from '../utils/screenMotion';
import { cx } from '../utils/cx';
import {
    clearLocalE2EEIdentity,
    generateUserE2EEBundle,
    loadLocalE2EEIdentity,
    rewrapPrivateKeyWithNewPassword,
    rewrapPrivateKeyWithRecoveryPhrase,
    validateRecoveryPhrase,
} from '../utils/e2ee';

interface ResetPasswordLinkProps {
    token: string;
}

type LinkState = 'checking' | 'valid' | 'invalid' | 'done';

interface LinkE2EEInfo {
    publicKey?: string | null;
    recoveryEncryptedPrivateKey?: string | null;
    recoverySalt?: string | null;
    keyVersion?: number;
}

export function ResetPasswordLink({ token }: ResetPasswordLinkProps) {
    const [linkState, setLinkState] = useState<LinkState>('checking');
    const [username, setUsername] = useState('');
    const [targetChatId, setTargetChatId] = useState('');
    const [hasRecoveryKey, setHasRecoveryKey] = useState(false);
    const [hasLocalKey, setHasLocalKey] = useState(false);
    const [linkE2ee, setLinkE2ee] = useState<LinkE2EEInfo | null>(null);
    const [useRecoveryPhrase, setUseRecoveryPhrase] = useState(true);
    const [recoveryWords, setRecoveryWords] = useState<string[]>(() => Array(12).fill(''));
    const [confirmWipe, setConfirmWipe] = useState(false);
    const [wasWiped, setWasWiped] = useState(false);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!token) {
            setLinkState('invalid');
            return;
        }
        let cancelled = false;
        fetch(`${API_BASE_URL}/auth/password-link/${encodeURIComponent(token)}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' },
        })
            .then((response) => response.json())
            .then((data) => {
                if (cancelled) return;
                if (data?.valid) {
                    const chatId = String(data?.chatId || '');
                    const serverHasRecovery = Boolean(data?.hasRecoveryKey && data?.e2ee?.recoveryEncryptedPrivateKey);
                    setUsername(String(data?.username || ''));
                    setTargetChatId(chatId);
                    setHasRecoveryKey(serverHasRecovery);
                    setLinkE2ee(data?.e2ee || null);
                    setHasLocalKey(!serverHasRecovery && Boolean(chatId && loadLocalE2EEIdentity(chatId)));
                    setUseRecoveryPhrase(serverHasRecovery);
                    setLinkState('valid');
                } else {
                    setLinkState('invalid');
                }
            })
            .catch(() => {
                if (!cancelled) setLinkState('invalid');
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    const goToLogin = () => {
        localStorage.removeItem('token');
        document.cookie = 'auth_token=; path=/; max-age=0; samesite=lax';
        window.location.assign('/login');
    };

    const needsWipeConfirmation = (hasRecoveryKey && !useRecoveryPhrase) || (!hasRecoveryKey && !hasLocalKey);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 8) {
            setError('رمز عبور باید حداقل ۸ کاراکتر باشد');
            return;
        }
        if (password !== confirmPassword) {
            setError('رمز عبور و تکرار آن یکسان نیستند');
            return;
        }

        if (hasRecoveryKey && useRecoveryPhrase) {
            if (!validateRecoveryPhrase(recoveryWords)) {
                setError('لطفاً هر ۱۲ کلمه بازیابی را به ترتیب و با املای صحیح وارد کنید');
                return;
            }
        } else if (needsWipeConfirmation && !confirmWipe) {
            setError('برای ادامه بدون کلمات بازیابی، تایید حذف چت‌های قبلی الزامی است');
            return;
        }

        setLoading(true);
        try {
            let e2eePayload;
            let wipeChats = false;

            if (hasRecoveryKey && useRecoveryPhrase && linkE2ee) {
                const rewrapped = await rewrapPrivateKeyWithRecoveryPhrase(recoveryWords, password, linkE2ee);
                if (!rewrapped) {
                    setError('۱۲ کلمه بازیابی اشتباه است یا ترتیب آن‌ها درست نیست');
                    return;
                }
                e2eePayload = rewrapped;
                wipeChats = false;
            } else if (!hasRecoveryKey && hasLocalKey) {
                const rewrapped = await rewrapPrivateKeyWithNewPassword(password, undefined, undefined, targetChatId, true);
                if (rewrapped) {
                    e2eePayload = rewrapped;
                    wipeChats = false;
                } else {
                    e2eePayload = (await generateUserE2EEBundle(password)).bundle;
                    wipeChats = true;
                }
            } else {
                e2eePayload = (await generateUserE2EEBundle(password)).bundle;
                wipeChats = true;
            }

            const response = await fetch(`${API_BASE_URL}/auth/password-link/consume`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true',
                },
                body: JSON.stringify({
                    token,
                    newPassword: password,
                    e2ee: e2eePayload,
                    wipeChats,
                }),
            });

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                const detail = String(body?.detail || '');
                if (response.status === 400 && detail.toLowerCase().includes('link')) {
                    setError('این لینک نامعتبر یا منقضی شده است');
                } else if (response.status === 400 && detail.toLowerCase().includes('recovery')) {
                    setError('تایید کلید بازیابی انجام نشد');
                } else if (response.status === 400) {
                    setError(detail || 'درخواست نامعتبر است');
                } else {
                    setError('خطای سرور. لطفاً بعداً تلاش کنید');
                }
                return;
            }

            if (targetChatId) {
                clearLocalE2EEIdentity(targetChatId);
            }
            setWasWiped(wipeChats);
            setLinkState('done');
        } catch {
            setError('خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید');
        } finally {
            setLoading(false);
        }
    };

    return (
        <motion.div className="login-page" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className={cx('login-container', linkState === 'valid' && 'login-container--wide')}>
                <div className="login-header">
                    <ShieldCheck size={48} strokeWidth={1.5} className="login-header-icon" />
                    <h1>تغییر رمز عبور</h1>
                    <p dir="rtl">
                        {linkState === 'valid' && username ? `تغییر رمز عبور برای @${username}` : 'رمز عبور جدید خود را تعیین کنید'}
                    </p>
                </div>

                {linkState === 'checking' && (
                    <div className="adm-state">
                        <span className="adm-state__text">در حال بررسی لینک...</span>
                    </div>
                )}

                {linkState === 'invalid' && (
                    <div className="adm-state">
                        <Link2Off size={40} className="adm-state__icon" />
                        <div className="adm-state__text">این لینک نامعتبر یا منقضی شده است</div>
                        <button type="button" className="login-btn" onClick={goToLogin}>
                            بازگشت به ورود
                        </button>
                    </div>
                )}

                {linkState === 'done' && (
                    <div className="adm-state">
                        <div className="success-message">
                            {wasWiped
                                ? 'رمز عبور تغییر کرد، چت‌های قبلی پاک شدند و کلید بازیابی جدید ساخته شد. اکنون وارد شوید.'
                                : 'رمز عبور تغییر کرد و تمام چت‌های قبلی شما حفظ شدند. با رمز جدید وارد شوید.'}
                        </div>
                        <button type="button" className="login-btn" onClick={goToLogin}>
                            ورود به حساب
                        </button>
                    </div>
                )}

                {linkState === 'valid' && (
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <PasswordField
                                label="رمز جدید"
                                icon={<Key size={16} />}
                                value={password}
                                onChange={(value) => {
                                    setPassword(value);
                                    setError('');
                                }}
                                placeholder="••••••••"
                                autoComplete="new-password"
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <PasswordField
                                label="تکرار رمز جدید"
                                icon={<Key size={16} />}
                                value={confirmPassword}
                                onChange={(value) => {
                                    setConfirmPassword(value);
                                    setError('');
                                }}
                                placeholder="••••••••"
                                autoComplete="new-password"
                            />
                        </div>

                        {hasRecoveryKey && (
                            <div className="nr-reset-toggle-card" dir="rtl">
                                <div className="nr-reset-toggle-row">
                                    <div className="nr-reset-toggle-copy">
                                        <span className="nr-reset-toggle-title">ورود ۱۲ کلمه بازیابی</span>
                                        <span className="nr-reset-toggle-sub">
                                            {useRecoveryPhrase
                                                ? 'با وارد کردن کلمات، تمام چت‌ها و پیام‌های قبلی حفظ می‌شوند'
                                                : 'در حالت خاموش، تمام پیام‌ها و چت‌های قبلی حذف می‌شوند'}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={useRecoveryPhrase}
                                        aria-label="ورود ۱۲ کلمه بازیابی"
                                        className={cx('nr-switch', useRecoveryPhrase && 'nr-switch--on')}
                                        onClick={() => {
                                            setUseRecoveryPhrase((prev) => !prev);
                                            setConfirmWipe(false);
                                            setError('');
                                        }}
                                        disabled={loading}
                                    >
                                        <span className="nr-switch__thumb" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {hasRecoveryKey && useRecoveryPhrase && (
                            <div className="nr-recovery-section">
                                <div className="nr-recovery-section__head">
                                    <span className="nr-recovery-section__title">۱۲ کلمه بازیابی (به ترتیب ۱ تا ۱۲)</span>
                                </div>
                                <RecoveryPhraseInputs
                                    words={recoveryWords}
                                    onChange={(next) => {
                                        setRecoveryWords(next);
                                        setError('');
                                    }}
                                    disabled={loading}
                                />
                            </div>
                        )}

                        {!hasRecoveryKey && hasLocalKey && (
                            <div className="nr-recovery-info" dir="rtl">
                                <ShieldCheck size={18} />
                                <span>
                                    کلید رمزنگاری این حساب در مرورگر شما یافت شد. چت‌های قبلی حفظ شده و کد بازیابی جدید نیز ساخته می‌شود.
                                </span>
                            </div>
                        )}

                        {needsWipeConfirmation && (
                            <div className="nr-wipe-warning" dir="rtl">
                                <div className="nr-wipe-warning__head">
                                    <AlertTriangle size={18} />
                                    <span>هشدار: حذف دائمی تمام پیام‌ها و چت‌ها</span>
                                </div>
                                <p className="nr-wipe-warning__desc">
                                    {hasRecoveryKey
                                        ? 'در صورت تغییر رمز عبور بدون وارد کردن ۱۲ کلمه بازیابی، موارد زیر برای همیشه پاک می‌شوند:'
                                        : 'این حساب هنوز عبارت بازیابی فعال ندارد. برای تغییر رمز عبور، موارد زیر برای همیشه پاک می‌شوند:'}
                                </p>
                                <ul className="nr-wipe-warning__list">
                                    <li>تمام چت‌ها و پیام‌های خصوصی (PV)</li>
                                    <li>تمام پیام‌های ارسال‌شده شما در گروه‌های دیگران</li>
                                    <li>گروه‌هایی که خودتان ساخته‌اید به همراه تمام پیام‌هایشان</li>
                                    <li>پیام‌های ذخیره‌شده (Saved Messages)</li>
                                    <li>تمام چت‌ها و پیام‌های هوش مصنوعی (Nova AI)</li>
                                </ul>
                                <p className="nr-wipe-warning__foot">
                                    پس از ورود، فقط کانال رسمی نواروم در لیست چت‌های شما باقی می‌ماند و یک عبارت ۱۲ کلمه‌ای جدید برایتان ساخته می‌شود.
                                </p>
                                <label className="nr-wipe-confirm">
                                    <input
                                        type="checkbox"
                                        checked={confirmWipe}
                                        onChange={(e) => {
                                            setConfirmWipe(e.target.checked);
                                            setError('');
                                        }}
                                        disabled={loading}
                                    />
                                    <span className={cx('nr-wipe-confirm__box', confirmWipe && 'nr-wipe-confirm__box--checked')}>
                                        {confirmWipe && <Check size={13} />}
                                    </span>
                                    <span className="nr-wipe-confirm__label">
                                        متوجه شدم که تمام پیام‌ها و چت‌های قبلی به‌صورت دائمی حذف می‌شوند
                                    </span>
                                </label>
                            </div>
                        )}

                        {error && <div className="error-message">{error}</div>}

                        <button
                            type="submit"
                            className={cx('login-btn', 'nr-login-btn-flex', needsWipeConfirmation && 'nr-btn-danger-solid')}
                            disabled={loading || (needsWipeConfirmation && !confirmWipe)}
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={18} className="adm-spin" />
                                    <span>در حال آماده‌سازی اکانت...</span>
                                </>
                            ) : needsWipeConfirmation ? (
                                'حذف چت‌ها و تغییر رمز عبور'
                            ) : (
                                'ذخیره رمز جدید'
                            )}
                        </button>
                    </form>
                )}
            </div>
        </motion.div>
    );
}
