import { memo, useEffect, useState } from 'react';
import { Grid3X3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { apiFetch } from '../config/api';
import type { TicTacToeData } from '../types';
import { cx } from '../utils/cx';
import { notify } from '../utils/notificationBus';
import './TicTacToeMessage.css';

interface TicTacToeMessageProps {
    messageId: string;
    chatId: string;
    game: TicTacToeData;
    currentUserId: string;
    isMine: boolean;
    isSelectionModeActive?: boolean;
    onGameUpdated?: (chatId: string, messageId: string, nextGame: TicTacToeData) => void;
}

function gameProgressScore(g: TicTacToeData): number {
    const statusWeight = g.status === 'finished' ? 200 : g.status === 'playing' ? 100 : 0;
    const movesCount = Array.isArray(g.board) ? g.board.filter(Boolean).length : 0;
    return statusWeight + movesCount;
}

function MarkX({ size }: { size: number }) {
    return (
        <svg className="ttt-mark-svg ttt-mark-svg--x" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 5L19 19M19 5L5 19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

function MarkO({ size }: { size: number }) {
    return (
        <svg className="ttt-mark-svg ttt-mark-svg--o" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="3" />
        </svg>
    );
}

export const TicTacToeMessage = memo(function TicTacToeMessage({
    messageId,
    chatId,
    game,
    currentUserId,
    isMine,
    isSelectionModeActive = false,
    onGameUpdated,
}: TicTacToeMessageProps) {
    const [pendingGame, setPendingGame] = useState<TicTacToeData | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!pendingGame) return;
        if (gameProgressScore(game) >= gameProgressScore(pendingGame)) {
            setPendingGame(null);
        }
    }, [game, pendingGame]);

    const activeGame = pendingGame && gameProgressScore(pendingGame) > gameProgressScore(game)
        ? pendingGame
        : game;

    const applyUpdatedGame = (nextGame: TicTacToeData) => {
        setPendingGame(nextGame);
        onGameUpdated?.(chatId, messageId, nextGame);
    };

    const isPlayerX = activeGame.playerX === currentUserId;
    const isPlayerO = activeGame.playerO === currentUserId;
    const mySymbol = isPlayerX ? 'X' : isPlayerO ? 'O' : null;
    const canStartAsO = activeGame.status === 'waiting' && !activeGame.playerO && !isPlayerX;
    const isMyTurn = canStartAsO || (activeGame.status === 'playing' && mySymbol === activeGame.turn);

    const handleCellClick = async (cellIndex: number) => {
        if (busy || isSelectionModeActive) return;
        if (!isMyTurn) return;
        if (activeGame.board[cellIndex] !== '') return;
        setBusy(true);
        try {
            const res = await apiFetch(`/tictactoe/games/${encodeURIComponent(messageId)}/move`, {
                method: 'POST',
                body: JSON.stringify({ cell: cellIndex }),
            });
            if (res?.ticTacToe) {
                applyUpdatedGame(res.ticTacToe);
            }
        } catch (err: unknown) {
            const apiErr = err as { message?: string; data?: { ticTacToe?: TicTacToeData } };
            const latest = apiErr?.data?.ticTacToe;
            if (latest) {
                applyUpdatedGame(latest);
            }
            if (apiErr?.message === 'already_joined' && latest?.playerO !== currentUserId) {
                notify({ message: 'بازیکن دیگری زودتر بازی را شروع کرد', type: 'info' });
            }
        } finally {
            setBusy(false);
        }
    };

    const turnName = activeGame.turn === 'X'
        ? activeGame.playerXName
        : (activeGame.playerOName || 'حریف');

    const winnerName = activeGame.winner === 'X'
        ? activeGame.playerXName
        : activeGame.winner === 'O'
            ? (activeGame.playerOName || 'حریف')
            : '';

    const statusText = (() => {
        if (activeGame.status === 'waiting') {
            return canStartAsO ? 'نوبت شما' : 'در انتظار حریف';
        }
        if (activeGame.status === 'finished') {
            if (activeGame.winner === 'draw') return 'مساوی';
            return `برد ${winnerName}`;
        }
        return isMyTurn ? 'نوبت شما' : `نوبت ${turnName}`;
    })();

    const winSet = activeGame.winLine ? new Set(activeGame.winLine) : null;
    const noGestureAttr = isSelectionModeActive ? undefined : 'true';

    return (
        <div className={cx('ttt-card', isMine && 'ttt-card--mine')}>
            <div className="ttt-header">
                <div className="ttt-title-wrap">
                    <span className="ttt-title-icon">
                        <Grid3X3 size={12} />
                    </span>
                    <span className="ttt-title">دوز</span>
                </div>
                <span
                    className={cx(
                        'ttt-badge',
                        isMyTurn && 'ttt-badge--turn',
                        activeGame.status === 'finished' && 'ttt-badge--win',
                    )}
                >
                    {statusText}
                </span>
            </div>

            <div className="ttt-players">
                <div
                    className={cx(
                        'ttt-player',
                        activeGame.status === 'playing' && activeGame.turn === 'X' && 'ttt-player--active',
                        activeGame.winner === 'X' && 'ttt-player--winner',
                    )}
                >
                    <span className="ttt-player__mark ttt-player__mark--x">
                        <MarkX size={11} />
                    </span>
                    <span className="ttt-player__name">{activeGame.playerXName}</span>
                    {activeGame.status === 'playing' && activeGame.turn === 'X' && (
                        <span className="ttt-turn-dot" aria-hidden="true" />
                    )}
                </div>

                <div
                    className={cx(
                        'ttt-player',
                        !activeGame.playerOName && 'ttt-player--waiting',
                        ((activeGame.status === 'playing' && activeGame.turn === 'O') || activeGame.status === 'waiting') && 'ttt-player--active',
                        activeGame.winner === 'O' && 'ttt-player--winner',
                    )}
                >
                    <span className="ttt-player__mark ttt-player__mark--o">
                        <MarkO size={11} />
                    </span>
                    <span className="ttt-player__name">{activeGame.playerOName || 'در انتظار...'}</span>
                    {((activeGame.status === 'playing' && activeGame.turn === 'O') || activeGame.status === 'waiting') && (
                        <span className="ttt-turn-dot" aria-hidden="true" />
                    )}
                </div>
            </div>

            <div className="ttt-board" data-no-message-gesture={noGestureAttr}>
                {activeGame.board.map((cell, index) => {
                    const playable = !busy && !isSelectionModeActive && isMyTurn && cell === '';
                    const isWinCell = Boolean(winSet?.has(index));
                    const isDimCell = Boolean(winSet && !isWinCell);
                    return (
                        <button
                            key={index}
                            type="button"
                            className={cx(
                                'ttt-cell',
                                playable && 'ttt-cell--playable',
                                isWinCell && 'ttt-cell--win',
                                isDimCell && 'ttt-cell--dim',
                            )}
                            disabled={!playable}
                            onClick={(e) => {
                                e.stopPropagation();
                                void handleCellClick(index);
                            }}
                            aria-label={`خانه ${index + 1}`}
                        >
                            {cell === 'X' && (
                                <motion.span
                                    initial={{ scale: 0.45, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ type: 'spring', stiffness: 460, damping: 24 }}
                                >
                                    <MarkX size={22} />
                                </motion.span>
                            )}
                            {cell === 'O' && (
                                <motion.span
                                    initial={{ scale: 0.45, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ type: 'spring', stiffness: 460, damping: 24 }}
                                >
                                    <MarkO size={22} />
                                </motion.span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
});
