import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { API_BASE_URL } from '../config/api';
import { type User } from '../types';
import { Key, User as UserIcon, Link2Off } from 'lucide-react';
import { DarkModeToggle } from './DarkModeToggle';
import { PasswordField } from './PasswordField';
import { useDarkMode } from '../hooks/useDarkMode';
import { detectDeviceName } from '../utils/device';
import { screenVariants } from '../utils/screenMotion';

interface RegisterProps {
    onRegisterSuccess: (user: User, token: string) => void;
    onBackToLogin: () => void;
}

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
type LinkState = 'checking' | 'valid' | 'invalid';

export function Register({ onRegisterSuccess, onBackToLogin }: RegisterProps) {
    const { token } = useParams<{ token: string }>();
    const { themeMode, setThemeMode } = useDarkMode();

    const [linkState, setLinkState] = useState<LinkState>('checking');
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
    const [usernameHint, setUsernameHint] = useState<string>('');
    const checkTimerRef = useRef<number | null>(null);

    const handleToggleTheme = () => {
        setThemeMode((prevMode) =>
            prevMode === 'system' ? 'light' : prevMode === 'light' ? 'dark' : 'system'
        );
    };

    useEffect(() => {
        if (!token) {
            setLinkState('invalid');
            return;
        }
        let cancelled = false;
        fetch(`${API_BASE_URL}/auth/register-link/${encodeURIComponent(token)}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' },
        })
            .then((response) => response.json())
            .then((data) => {
                if (!cancelled) setLinkState(data?.valid ? 'valid' : 'invalid');
            })
            .catch(() => {
                if (!cancelled) setLinkState('invalid');
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    useEffect(() => {
        const trimmed = username.trim();
        if (!trimmed) {
            setUsernameStatus('idle');
            setUsernameHint('');
            return;
        }
        if (trimmed.length < 3) {
            setUsernameStatus('invalid');
            setUsernameHint('نام کاربری باید حداقل ۳ کاراکتر باشد');
            return;
        }
        if (trimmed.length > 32) {
            setUsernameStatus('invalid');
            setUsernameHint('حداکثر ۳۲ کاراکتر');
            return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            setUsernameStatus('invalid');
            setUsernameHint('فقط حروف لاتین، اعداد و آندرلاین');
            return;
        }

        setUsernameStatus('checking');
        setUsernameHint('در حال بررسی...');

        if (checkTimerRef.current) window.clearTimeout(checkTimerRef.current);
        checkTimerRef.current = window.setTimeout(async () => {
            try {
                const response = await fetch(
                    `${API_BASE_URL}/auth/username-available?username=${encodeURIComponent(trimmed)}`,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'ngrok-skip-browser-warning': 'true',
                        },
                    }
                );

                if (!response.ok) {
                    setUsernameStatus('invalid');
                    setUsernameHint('بررسی نام کاربری ممکن نشد');
                    return;
                }

                const res = await response.json();
                if (res?.available) {
                    setUsernameStatus('available');
                    setUsernameHint('نام کاربری قابل استفاده است');
                } else {
                    setUsernameStatus('taken');
                    setUsernameHint('این نام کاربری قبلاً گرفته شده');
                }
            } catch {
                setUsernameStatus('invalid');
                setUsernameHint('بررسی نام کاربری ممکن نشد');
            }
        }, 350);

        return () => {
            if (checkTimerRef.current) window.clearTimeout(checkTimerRef.current);
        };
    }, [username]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!name.trim()) {
            setError('لطفاً نام خود را وارد کنید');
            return;
        }
        if (usernameStatus !== 'available') {
            setError('لطفاً یک نام کاربری معتبر و در دسترس وارد کنید');
            return;
        }
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
            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true',
                },
                body: JSON.stringify({
                    token,
                    name: name.trim(),
                    username: username.trim(),
                    password,
                    deviceName: detectDeviceName(),
                }),
            });

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                const detail = String(body?.detail || '');
                if (response.status === 409) {
                    setError('این نام کاربری قبلاً گرفته شده است');
                } else if (response.status === 400 && detail.toLowerCase().includes('link')) {
                    setError('این لینک نامعتبر یا منقضی شده است');
                } else if (response.status === 400) {
                    setError(detail || 'درخواست نامعتبر است');
                } else {
                    setError('خطای سرور. لطفاً بعداً تلاش کنید');
                }
                return;
            }

            const data = await response.json();
            localStorage.setItem('token', data.token);
            onRegisterSuccess(data.user, data.token);
        } catch {
            setError('خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید');
        } finally {
            setLoading(false);
        }
    };

    return (
        <motion.div className="login-page" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className="login-page__dark-toggle">
                <DarkModeToggle themeMode={themeMode} onToggle={handleToggleTheme} />
            </div>

            <div className="login-container">
                <div className="login-header">
                    <img src="/logo/logo.svg" alt="نواروم" className="login-logo" />
                    <h1>ثبت نام در نواروم</h1>
                    <p>اطلاعات خود را تکمیل کنید</p>
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
                        <button type="button" className="adm-btn adm-btn--primary adm-tap" onClick={onBackToLogin}>
                            بازگشت به ورود
                        </button>
                    </div>
                )}

                {linkState === 'valid' && (
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>
                                <UserIcon size={16} />
                                نام
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => {
                                    setName(e.target.value);
                                    setError('');
                                }}
                                placeholder="نام خود را وارد کنید"
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <label>
                                <UserIcon size={16} />
                                نام کاربری
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => {
                                    setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''));
                                    setError('');
                                }}
                                placeholder="username123"
                                maxLength={32}
                                dir="ltr"
                            />
                            {!!usernameHint && (
                                <small style={{
                                    color: usernameStatus === 'available' ? 'var(--accent-hover)' :
                                        usernameStatus === 'taken' || usernameStatus === 'invalid' ? '#dc2626' : '#6b7280',
                                    fontSize: '12px',
                                    marginTop: '5px',
                                    display: 'block',
                                    direction: 'rtl',
                                    textAlign: 'right'
                                }}>
                                    {usernameHint}
                                </small>
                            )}
                        </div>

                        <div className="form-group">
                            <PasswordField
                                label="رمز عبور"
                                icon={<Key size={16} />}
                                value={password}
                                onChange={(value) => {
                                    setPassword(value);
                                    setError('');
                                }}
                                placeholder="••••••••"
                                autoComplete="new-password"
                            />
                        </div>

                        <div className="form-group">
                            <PasswordField
                                label="تکرار رمز عبور"
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

                        <button
                            type="submit"
                            className={loading ? 'login-btn login-btn--loading' : 'login-btn'}
                            disabled={loading || usernameStatus !== 'available'}
                        >
                            {loading ? 'در حال ثبت نام...' : 'ثبت نام'}
                        </button>

                        <button
                            type="button"
                            className="secondary-btn adm-tap"
                            onClick={onBackToLogin}
                            style={{ marginTop: '10px' }}
                        >
                            بازگشت به ورود
                        </button>
                    </form>
                )}
            </div>
        </motion.div>
    );
}
