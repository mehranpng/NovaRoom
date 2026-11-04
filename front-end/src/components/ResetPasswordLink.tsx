import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { API_BASE_URL } from '../config/api';
import { Key, ShieldCheck, Link2Off } from 'lucide-react';
import { PasswordField } from './PasswordField';
import { screenVariants } from '../utils/screenMotion';

interface ResetPasswordLinkProps {
    token: string;
}

type LinkState = 'checking' | 'valid' | 'invalid' | 'done';

export function ResetPasswordLink({ token }: ResetPasswordLinkProps) {
    const [linkState, setLinkState] = useState<LinkState>('checking');
    const [username, setUsername] = useState('');
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
                    setUsername(String(data?.username || ''));
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

        setLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/auth/password-link/consume`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true',
                },
                body: JSON.stringify({ token, newPassword: password }),
            });

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                const detail = String(body?.detail || '');
                if (response.status === 400 && detail.toLowerCase().includes('link')) {
                    setError('این لینک نامعتبر یا منقضی شده است');
                } else if (response.status === 400) {
                    setError(detail || 'درخواست نامعتبر است');
                } else {
                    setError('خطای سرور. لطفاً بعداً تلاش کنید');
                }
                return;
            }

            setLinkState('done');
        } catch {
            setError('خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید');
        } finally {
            setLoading(false);
        }
    };

    return (
        <motion.div className="login-page" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className="login-container">
                <div className="login-header">
                    <ShieldCheck size={48} strokeWidth={1.5} className="login-header-icon" />
                    <h1>تغییر رمز عبور</h1>
                    <p>
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
                        <button type="button" className="adm-btn adm-btn--primary adm-tap" onClick={goToLogin}>
                            بازگشت به ورود
                        </button>
                    </div>
                )}

                {linkState === 'done' && (
                    <div className="adm-state">
                        <div className="success-message">رمز عبور تغییر کرد. با رمز جدید وارد شوید.</div>
                        <button type="button" className="adm-btn adm-btn--primary adm-tap" onClick={goToLogin}>
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

                        {error && <div className="error-message">{error}</div>}

                        <button type="submit" className="login-btn" disabled={loading}>
                            {loading ? 'در حال ذخیره...' : 'ذخیره رمز جدید'}
                        </button>
                    </form>
                )}
            </div>
        </motion.div>
    );
}
