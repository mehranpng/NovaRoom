import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { apiFetch, getAuthToken } from '../../config/api';
import type { ChessGameView, User } from '../../types';
import {
    findGuestChessSessionByInvite,
    saveGuestChessSession,
    setCachedChessGame,
} from '../../utils/chessCache';
import { screenVariants } from '../../utils/screenMotion';
import { ChessGame } from './ChessGame';

interface ChessJoinPageProps {
    authToken: string | null;
    currentUser: User | null;
}

interface GuestSession {
    gameId: string;
    guestId: string;
    guestToken: string;
}

export function ChessJoinPage({ authToken, currentUser }: ChessJoinPageProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const inviteToken = location.pathname.match(/^\/chess\/join\/([^/?#]+)$/)?.[1] ?? '';
    const startedRef = useRef(false);
    const [guest, setGuest] = useState<GuestSession | null>(null);
    const [error, setError] = useState<'invalid' | 'auth' | 'own_game' | 'already_in_game' | null>(null);

    useEffect(() => {
        const effectiveToken = authToken || getAuthToken();
        if (effectiveToken && !currentUser) return;
        if (startedRef.current) return;
        startedRef.current = true;

        const hasAccountSession = Boolean(currentUser || effectiveToken);

        const join = async () => {
            const existing = hasAccountSession ? null : findGuestChessSessionByInvite(inviteToken);
            try {
                const res = await apiFetch(`/chess/join/${encodeURIComponent(inviteToken)}`, {
                    method: 'POST',
                    body: JSON.stringify({ guestToken: existing?.guestToken ?? null }),
                    ...(effectiveToken ? { headers: { Authorization: `Bearer ${effectiveToken}` } } : {}),
                });
                const view: ChessGameView = res.game;
                if (res.mode === 'guest') {
                    if (hasAccountSession) {
                        setError('auth');
                        return;
                    }
                    setCachedChessGame(view);
                    saveGuestChessSession({
                        gameId: view.id,
                        guestId: res.guestId,
                        guestToken: res.guestToken,
                        inviteToken,
                    });
                    setGuest({ gameId: view.id, guestId: res.guestId, guestToken: res.guestToken });
                    return;
                }
                setCachedChessGame(view);
                navigate(`/chess/game/${encodeURIComponent(view.id)}`, { replace: true });
            } catch (err) {
                const e = err as { status?: number; message?: string };
                if (e?.status === 401) {
                    setError('auth');
                } else if (e?.message === 'own_game') {
                    setError('own_game');
                } else if (e?.message === 'already_in_game') {
                    setError('already_in_game');
                } else {
                    setError('invalid');
                }
            }
        };

        void join();
    }, [inviteToken, navigate, authToken, currentUser]);

    if (guest) {
        return (
            <ChessGame
                key={guest.gameId}
                currentUser={{
                    chatId: guest.guestId,
                    name: 'مهمان',
                    username: '',
                    bio: '',
                    avatar: '',
                    online: true,
                }}
                gameId={guest.gameId}
                authToken={null}
                guestToken={guest.guestToken}
                isGuestMode
                chats={[]}
                onExitGame={() => navigate('/login')}
            />
        );
    }

    return (
        <motion.div className="profile chess" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className="profile__header">
                <h1 className="profile__header-title">شطرنج</h1>
            </div>
            <div className="chess__empty">
                {error === 'auth' ? (
                    <>
                        <p>برای بازی با حساب کاربری خود دوباره وارد شوید</p>
                        <button type="button" className="chess-primary-btn" onClick={() => navigate('/login')}>
                            ورود به حساب
                        </button>
                    </>
                ) : error === 'own_game' ? (
                    <>
                        <p>این لینک بازی توسط خودتان ساخته شده است و نمی‌توانید با حساب خودتان به آن بپیوندید</p>
                        <button
                            type="button"
                            className="chess-primary-btn"
                            onClick={() => navigate('/chess')}
                        >
                            بازگشت به شطرنج
                        </button>
                    </>
                ) : error === 'already_in_game' ? (
                    <>
                        <p>شما در حال حاضر یک بازی فعال دارید</p>
                        <button
                            type="button"
                            className="chess-primary-btn"
                            onClick={() => navigate('/chess')}
                        >
                            بازگشت به شطرنج
                        </button>
                    </>
                ) : error ? (
                    <>
                        <p>این لینک بازی منقضی شده یا نامعتبر است</p>
                        <button
                            type="button"
                            className="chess-primary-btn"
                            onClick={() => navigate(currentUser ? '/chess' : '/login')}
                        >
                            بازگشت
                        </button>
                    </>
                ) : (
                    <p>در حال پیوستن به بازی…</p>
                )}
            </div>
        </motion.div>
    );
}
