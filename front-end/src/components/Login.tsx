import { useState, useRef } from 'react';
import { apiFetch } from '../config/api';
import { type User } from '../types';
import { LogIn } from 'lucide-react';

interface LoginProps {
    onLoginSuccess: (user: User, token: string) => void;
}

export function Login({ onLoginSuccess }: LoginProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const emailRef = useRef<HTMLInputElement | null>(null);
    const passwordRef = useRef<HTMLInputElement | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const data = await apiFetch('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password }),
            });

            localStorage.setItem('token', data.token);
            onLoginSuccess(data.user, data.token);
        } catch (err: any) {
            setError(err.message || 'Invalid email or password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-container">
                <div className="login-header">
                    <LogIn size={48} strokeWidth={1.5} />
                    <h1>NovaRoom</h1>
                    <p>Sign in to continue</p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            ref={emailRef}
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onFocus={() => {
                                setTimeout(() => {
                                    emailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 150);
                            }}
                            placeholder="mehran@gmail.com"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <input
                            ref={passwordRef}
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onFocus={() => {
                                setTimeout(() => {
                                    passwordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 150);
                            }}
                            placeholder="••••••••"
                            required
                        />
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button type="submit" className="login-btn" disabled={loading}>
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
}
