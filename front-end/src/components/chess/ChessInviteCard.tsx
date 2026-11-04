import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hourglass, Trophy } from 'lucide-react';
import { apiFetch } from '../../config/api';
import type { ChessGameView, ChessInvite } from '../../types';
import {
    fetchChessGameCached,
    getCachedChessGame,
    isChessGameUnavailable,
    markChessGameUnavailable,
    setCachedChessGame,
    type CachedChessGame,
} from '../../utils/chessCache';
import { cx } from '../../utils/cx';
import { toPersianDigits } from '../../utils/format';
import { notify } from '../../utils/notificationBus';
import { Avatar } from '../Avatar';
import { PlumpyChessIcon } from '../BottomNavbar';

interface ChessInviteCardProps {
    invite: ChessInvite;
    isMine: boolean;
}

const REASON_LABELS: Record<string, string> = {
    checkmate: 'کیش و مات',
    resign: 'تسلیم',
    timeout: 'اتمام زمان',
    stalemate: 'پات',
    insufficient: 'مهره ناکافی',
    repetition: 'تکرار حرکت',
    fifty: 'قانون ۵۰ حرکت',
    agreement: 'توافق',
    abandoned: 'ترک بازی',
    aborted: 'لغو شده',
};

const timeControlCategory = (tc: string): string => {
    if (tc === 'unlimited') return 'بدون زمان';
    if (tc === '1+0') return 'بولت';
    if (tc === '3+0' || tc === '3+2' || tc === '5+0') return 'بلیتز';
    if (tc === '10+0' || tc === '15+10') return 'رپید';
    return 'کلاسیک';
};

const formatTimeControlLabel = (tc: string): string => {
    if (tc === 'unlimited') return 'بدون زمان';
    return `${timeControlCategory(tc)} • ${toPersianDigits(tc)}`;
};

const resultLabel = (game: ChessGameView): string => {
    if (game.result === '1-0') return 'برد سفید';
    if (game.result === '0-1') return 'برد سیاه';
    if (game.result === '1/2-1/2') return 'مساوی';
    if (game.reason === 'aborted' || game.result === '*') return 'لغو شده';
    return '';
};

export function ChessInviteCard({ invite, isMine }: ChessInviteCardProps) {
    const navigate = useNavigate();
    const [game, setGame] = useState<CachedChessGame | null>(() => getCachedChessGame(invite.gameId));
    const [unavailable, setUnavailable] = useState<boolean>(() => isChessGameUnavailable(invite.gameId));
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const cached = getCachedChessGame(invite.gameId);
        const alreadyUnavailable = isChessGameUnavailable(invite.gameId);
        setGame(cached);
        setUnavailable(alreadyUnavailable);

        if (alreadyUnavailable) return;
        if (cached && cached.status !== 'waiting') return;

        let cancelled = false;
        fetchChessGameCached(invite.gameId, { force: Boolean(cached) })
            .then((data) => {
                if (!cancelled) {
                    setGame(data);
                    setUnavailable(false);
                }
            })
            .catch(() => {
                if (!cancelled) setUnavailable(true);
            });
        return () => {
            cancelled = true;
        };
    }, [invite.gameId]);

    const isFinished = game?.status === 'finished';
    const isSharedFinished = Boolean(invite.shared || isFinished);

    const handleAction = async () => {
        if (busy || !game) return;
        if (isSharedFinished || isMine || game.me) {
            navigate(`/chess/game/${encodeURIComponent(invite.gameId)}`);
            return;
        }
        if (game.status !== 'waiting') {
            markChessGameUnavailable(invite.gameId);
            setUnavailable(true);
            return;
        }
        setBusy(true);
        try {
            const res = await apiFetch(`/chess/games/${encodeURIComponent(invite.gameId)}/accept`, { method: 'POST' });
            if (res?.game) {
                setCachedChessGame({ ...res.game, me: res.game.players?.black ? 'black' : 'white' });
            }
            navigate(`/chess/game/${encodeURIComponent(invite.gameId)}`);
        } catch (err: unknown) {
            const code = err instanceof Error ? err.message : '';
            const msg = code === 'already_in_game'
                ? 'شما در حال حاضر یک بازی فعال دارید'
                : 'این بازی دیگر در دسترس نیست';
            notify({ message: msg, type: 'error' });
            if (code !== 'already_in_game') {
                markChessGameUnavailable(invite.gameId);
                setUnavailable(true);
            }
        } finally {
            setBusy(false);
        }
    };

    const canEnter = Boolean(
        game &&
        (isSharedFinished || isMine || game.me || game.status === 'waiting') &&
        !unavailable,
    );
    const buttonLabel = isSharedFinished
        ? 'مشاهده بازی'
        : isMine || game?.me
        ? 'ورود به بازی'
        : 'قبول دعوت و شروع';

    const whiteId = game?.players.white || null;
    const blackId = game?.players.black || null;
    const whiteInfo = (whiteId && game?.playerInfo?.[whiteId]) || null;
    const blackInfo = (blackId && game?.playerInfo?.[blackId]) || null;
    const whiteWin = game?.result === '1-0';
    const blackWin = game?.result === '0-1';

    const statusBadge = (() => {
        if (unavailable || (game && !canEnter)) return { text: 'منقضی شده', cls: 'chess-invite__badge--muted' };
        if (!game) return { text: '…', cls: 'chess-invite__badge--muted' };
        if (game.status === 'waiting') return { text: 'در انتظار حریف', cls: 'chess-invite__badge--waiting' };
        if (game.status === 'active') return { text: 'در حال انجام', cls: 'chess-invite__badge--live' };
        return { text: resultLabel(game) || 'پایان یافته', cls: 'chess-invite__badge--done' };
    })();

    const reasonText = game?.reason ? REASON_LABELS[game.reason] || '' : '';
    const movesCount = game ? Math.ceil((game.ply || game.moves?.length || 0) / 2) : 0;

    return (
        <div className="chess-invite" onClick={(e) => e.stopPropagation()}>
            <div className="chess-invite__header">
                <div className="chess-invite__header-main">
                    <span className="chess-invite__icon">
                        <PlumpyChessIcon size={22} />
                    </span>
                    <div className="chess-invite__meta">
                        <div className="chess-invite__title">
                            {invite.shared ? 'نتیجه بازی شطرنج' : isFinished ? 'بازی شطرنج' : 'دعوت به بازی شطرنج'}
                        </div>
                        <div className="chess-invite__sub">
                            {formatTimeControlLabel(game?.timeControl || invite.timeControl)}
                        </div>
                    </div>
                </div>
                <span className={cx('chess-invite__badge', statusBadge.cls)}>
                    {statusBadge.text}
                </span>
            </div>

            {game && (
                <div className="chess-invite__players">
                    <div className={cx('chess-invite__seat', whiteWin && 'chess-invite__seat--winner')}>
                        <div className="chess-invite__seat-user">
                            {whiteInfo ? (
                                <Avatar name={whiteInfo.name || 'سفید'} size="xs" src={whiteInfo.avatar} />
                            ) : (
                                <span className="chess-invite__seat-wait">
                                    <Hourglass size={13} />
                                </span>
                            )}
                            <span className="chess-invite__seat-name">
                                {whiteInfo?.name || (whiteId ? 'سفید' : 'منتظر حریف…')}
                            </span>
                        </div>
                        <div className="chess-invite__seat-tags">
                            {whiteWin && <Trophy size={13} />}
                            <span className="chess-invite__piece chess-invite__piece--white" title="مهره سفید" />
                        </div>
                    </div>

                    <div className={cx('chess-invite__seat', blackWin && 'chess-invite__seat--winner')}>
                        <div className="chess-invite__seat-user">
                            {blackInfo ? (
                                <Avatar name={blackInfo.name || 'سیاه'} size="xs" src={blackInfo.avatar} />
                            ) : (
                                <span className="chess-invite__seat-wait">
                                    <Hourglass size={13} />
                                </span>
                            )}
                            <span className="chess-invite__seat-name">
                                {blackInfo?.name || (blackId ? 'سیاه' : 'منتظر حریف…')}
                            </span>
                        </div>
                        <div className="chess-invite__seat-tags">
                            {blackWin && <Trophy size={13} />}
                            <span className="chess-invite__piece chess-invite__piece--black" title="مهره سیاه" />
                        </div>
                    </div>
                </div>
            )}

            {game && (reasonText || movesCount > 0) && (
                <div className="chess-invite__stats">
                    {reasonText && <span className="chess-invite__stat-pill">{reasonText}</span>}
                    {movesCount > 0 && (
                        <span className="chess-invite__stat-pill">
                            {toPersianDigits(movesCount)} حرکت
                        </span>
                    )}
                </div>
            )}

            {unavailable || (game && !canEnter) ? (
                <div className="chess-invite__unavailable">این بازی دیگر در دسترس نیست</div>
            ) : game ? (
                <button
                    type="button"
                    className="chess-invite__btn"
                    onClick={handleAction}
                    disabled={busy}
                >
                    {buttonLabel}
                </button>
            ) : (
                <div className="skeleton" style={{ height: 40, width: '100%', borderRadius: 9999 }} />
            )}
        </div>
    );
}
