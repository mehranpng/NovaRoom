import { useState } from 'react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { LogIn, User as UserIcon, Key } from 'lucide-react';
import { DarkModeToggle } from './DarkModeToggle';
import { PasswordField } from './PasswordField';
import { useDarkMode } from '../hooks/useDarkMode';
import { detectDeviceName } from '../utils/device';

interface LoginProps {
    onLoginSuccess: (user: User, token: string) => void;
}

export function Login({ onLoginSuccess }: LoginProps) {
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { themeMode, setThemeMode } = useDarkMode();

    const handleToggleTheme = () => {
        setThemeMode((prevMode) =>
            prevMode === 'system' ? 'light' : prevMode === 'light' ? 'dark' : 'system'
        );
    };

    
    const getErrorMessage = (err: any): string => {
        const message = err.message || '';

        
        if (message.includes('401') || message.includes('Unauthorized') ||
            message.includes('Invalid credentials') || message.includes('incorrect')) {
            return 'نام کاربری یا رمز عبور نامعتبر است';
        }
        if (message.includes('404') || message.includes('not found') || message.includes('User not found')) {
            return 'کاربری با این مشخصات یافت نشد';
        }

        
        if (message.includes('Network') || message.includes('fetch')) {
            return 'خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید';
        }

        
        if (message.includes('400')) {
            return 'درخواست نامعتبر است';
        }
        if (message.includes('500')) {
            return 'خطای سرور. لطفاً بعداً تلاش کنید';
        }

        return 'نام کاربری یا رمز عبور نامعتبر است';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        
        if (!identifier) {
            setError('لطفاً نام کاربری یا ایمیل خود را وارد کنید');
            return;
        }
        if (!password) {
            setError('لطفاً رمز عبور خود را وارد کنید');
            return;
        }

        setLoading(true);

        try {
            const data = await apiFetch('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ identifier, password, deviceName: detectDeviceName() }),
            });

            localStorage.setItem('token', data.token);
            onLoginSuccess(data.user, data.token);
        } catch (err: any) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-page__dark-toggle">
                <DarkModeToggle themeMode={themeMode} onToggle={handleToggleTheme} />
            </div>

            <div className="login-container">
                <div className="login-header">
                    <LogIn size={48} strokeWidth={1.5} className="login-header-icon" />
                    <h1>نوا روم</h1>
                    <p>برای ادامه وارد شوید</p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>
                            <UserIcon size={16} />
                            نام کاربری یا ایمیل
                        </label>
                        <input
                            type="text"
                            value={identifier}
                            onChange={(e) => {
                                setIdentifier(e.target.value);
                                setError('');
                            }}
                            placeholder="username"
                            autoComplete="username"
                            dir="ltr"
                            autoFocus
                        />
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
                            autoComplete="current-password"
                        />
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button type="submit" className="login-btn adm-tap" disabled={loading}>
                        {loading ? 'در حال ورود...' : 'ورود'}
                    </button>
                </form>
            </div>
        </div>
    );
}
