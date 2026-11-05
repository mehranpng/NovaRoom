import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard, defaultPieces } from 'react-chessboard';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Check, Hourglass, Link2, Smile, UserRound, Volume2, VolumeX } from 'lucide-react';
import { apiFetch } from '../../config/api';
import { useChessSocket } from '../../hooks/useChessSocket';
import type { Chat, ChessColor, ChessEmote, ChessEvent, ChessGameView, User } from '../../types';
import {
    fetchChessGameCached,
    getCachedChessGame,
    isChessGameUnavailable,
    markChessGameUnavailable,
    setCachedChessGame,
} from '../../utils/chessCache';
import { playChessEmoteSound, playChessSound, soundForMove } from '../../utils/chessSounds';
import { copyText } from '../../utils/clipboard';
import { cx } from '../../utils/cx';
import { toPersianDigits } from '../../utils/format';
import { notify } from '../../utils/notificationBus';
import { screenVariants } from '../../utils/screenMotion';
import { Avatar } from '../Avatar';
import { ForwardModal } from '../ForwardModal';

interface ChessGameProps {
    currentUser: User;
    gameId: string;
    authToken: string | null;
    guestToken?: string | null;
    isGuestMode?: boolean;
    chats: Chat[];
    onExitGame: () => void;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const REASON_LABELS: Record<string, string> = {
    checkmate: 'کیش و مات',
    resign: 'تسلیم',
    timeout: 'اتمام زمان',
    first_move_timeout: 'عدم انجام حرکت اول',
    long_move_abandonment: 'عدم فعالیت در حرکت',
    disconnect_abandonment: 'قطع اتصال بازیکن',
    double_disconnect_draw: 'قطع اتصال هر دو بازیکن',
    stalemate: 'پات',
    insufficient: 'مهره ناکافی',
    repetition: 'تکرار حرکت',
    fifty: 'قانون ۵۰ حرکت',
    agreement: 'توافق',
    abandoned: 'ترک بازی',
};

const ERROR_MESSAGES: Record<string, string> = {
    too_early: 'هنوز برای پیشنهاد مساوی زود است',
    already_offered: 'پیشنهاد مساوی قبلاً ارسال شده است',
    cannot_abort: 'امکان لغو بازی وجود ندارد',
};

const formatClock = (ms: number): string => {
    const clamped = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    return `${toPersianDigits(String(minutes).padStart(2, '0'))}:${toPersianDigits(String(seconds).padStart(2, '0'))}`;
};

const formatTimeControl = (tc: string): string => {
    if (tc === 'unlimited') return 'بدون زمان';
    return toPersianDigits(tc);
};

const CAPTURE_ORDER = ['q', 'r', 'b', 'n', 'p'];

const CHESS_EMOTES: { id: ChessEmote; label: string; src: string }[] = [
    { id: 'trol', label: 'ترول', src: '/gifs/chess/trol.webp' },
    { id: 'cunning', label: 'حیله‌گر', src: '/gifs/chess/cunning.webp' },
    { id: 'nice', label: 'آفرین', src: '/gifs/chess/nice.webp' },
    { id: 'mad', label: 'عصبانی', src: '/gifs/chess/mad.webp' },
    { id: 'cry', label: 'گریه', src: '/gifs/chess/cry.webp' },
    { id: 'laugh', label: 'خنده', src: '/gifs/chess/laugh.webp' },
];

function PingBars({ online, latency }: { online: boolean; latency?: number }) {
    const level = !online || typeof latency !== 'number'
        ? 0
        : latency <= 80 ? 4 : latency <= 160 ? 3 : latency <= 300 ? 2 : 1;
    return (
        <span
            className={cx('chess__ping', `chess__ping--${level}`)}
            title={level ? `${toPersianDigits(latency!)} میلی‌ثانیه` : 'آفلاین'}
            aria-label={level ? `پینگ ${toPersianDigits(latency!)} میلی‌ثانیه` : 'آفلاین'}
        >
            <span className="chess__ping-bar" />
            <span className="chess__ping-bar" />
            <span className="chess__ping-bar" />
            <span className="chess__ping-bar" />
        </span>
    );
}


export function capturedPieces(moves: { san: string | null }[]): Record<ChessColor, { piece: string; count: number }[]> {
    const lost: Record<ChessColor, Record<string, number>> = { white: {}, black: {} };
    const board = new Chess();
    for (const entry of moves) {
        if (!entry.san) continue;
        try {
            const played = board.move(entry.san);
            if (!played?.captured) continue;
            const owner: ChessColor = played.color === 'w' ? 'black' : 'white';
            lost[owner][played.captured] = (lost[owner][played.captured] || 0) + 1;
        } catch {
            break;
        }
    }
    const toList = (counts: Record<string, number>) =>
        CAPTURE_ORDER.filter((piece) => counts[piece]).map((piece) => ({ piece, count: counts[piece] }));
    return { white: toList(lost.white), black: toList(lost.black) };
}

export function CapturedRow({ pieces, color }: { pieces: { piece: string; count: number }[]; color: ChessColor }) {
    if (pieces.length === 0) return null;
    return (
        <span className="chess__captured">
            {pieces.map(({ piece, count }) => (
                <span key={piece} className="chess__captured-item">
                    <span className="chess__captured-count" dir="ltr">×{toPersianDigits(count)}</span>
                    <span className={cx('chess__captured-piece', `chess__captured-piece--${color}`)}>
                        {defaultPieces[`${color === 'white' ? 'w' : 'b'}${piece.toUpperCase()}`]()}
                    </span>
                </span>
            ))}
        </span>
    );
}

export function ChessGame({ currentUser, gameId, authToken, guestToken, isGuestMode, chats, onExitGame }: ChessGameProps) {
    const initialCached = getCachedChessGame(gameId);
    const [game, setGame] = useState<ChessGameView | null>(() => initialCached);
    const [pendingFen, setPendingFen] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
    const [skew, setSkew] = useState(() =>
        initialCached?.serverNow ? initialCached.serverNow - Date.now() : 0,
    );
    const [now, setNow] = useState(() => Date.now());
    const [confirmResign, setConfirmResign] = useState(false);
    const [inviteOpen, setInviteOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    const [emotePickerOpen, setEmotePickerOpen] = useState(false);
    const [emoteSoundMuted, setEmoteSoundMuted] = useState(false);
    const [activeEmotes, setActiveEmotes] = useState<Partial<Record<ChessColor, { emote: ChessEmote; seq: number }>>>({});
    const [notFound, setNotFound] = useState<boolean>(() => isChessGameUnavailable(gameId));
    const [viewPly, setViewPly] = useState<number | null>(null);
    const soundPlyRef = useRef(typeof initialCached?.ply === 'number' ? initialCached.ply : -1);
    const startSoundPlayedRef = useRef(Boolean(initialCached && initialCached.status !== 'waiting'));
    const movesEndRef = useRef<HTMLDivElement | null>(null);
    const activeMoveRef = useRef<HTMLButtonElement | null>(null);
    const emoteTimersRef = useRef<Partial<Record<ChessColor, number>>>({});
    const emoteAnchorRef = useRef<HTMLDivElement | null>(null);
    const emoteSeqRef = useRef(0);

    const fetchDetails = useCallback((id: string, force = false) => {
        fetchChessGameCached(id, { force })
            .then((res) => {
                setGame(res);
                setNotFound(false);
                const clientNow = Date.now();
                setNow(clientNow);
                setSkew((res.serverNow || clientNow) - clientNow);
                if (res.status === 'active' && res.ply === 0 && !startSoundPlayedRef.current) {
                    startSoundPlayedRef.current = true;
                    playChessSound('game-start');
                }
                if (typeof res.ply === 'number' && soundPlyRef.current < 0) {
                    soundPlyRef.current = res.ply;
                }
            })
            .catch(() => {
                setNotFound(true);
            });
    }, []);

    useEffect(() => {
        const cached = getCachedChessGame(gameId);
        if (cached && cached.status === 'finished') {
            setGame(cached);
            setNotFound(false);
            return;
        }
        fetchDetails(gameId, Boolean(cached));
    }, [fetchDetails, gameId]);

    const myColor: ChessColor = useMemo(() => {
        if (!game) return 'white';
        return game.players.black === currentUser.chatId ? 'black' : 'white';
    }, [game, currentUser.chatId]);

    const isParticipant = useMemo(() => {
        if (!game) return false;
        return game.players.white === currentUser.chatId || game.players.black === currentUser.chatId;
    }, [game, currentUser.chatId]);

    const snapshots = useMemo(() => {
        const list: { fen: string; lastMove: { from: string; to: string } | null }[] = [
            { fen: START_FEN, lastMove: null },
        ];
        if (!game?.moves?.length) return list;
        const board = new Chess();
        for (const mv of game.moves) {
            try {
                const from = mv.uci.slice(0, 2);
                const to = mv.uci.slice(2, 4);
                const promotion = mv.uci.length > 4 ? mv.uci[4] : undefined;
                const played = board.move({ from, to, promotion });
                if (!played) break;
                list.push({ fen: board.fen(), lastMove: { from, to } });
            } catch {
                break;
            }
        }
        return list;
    }, [game?.moves]);

    const isFinished = game?.status === 'finished';
    const maxPly = snapshots.length - 1;
    const effectivePly = isFinished && viewPly !== null ? Math.min(Math.max(0, viewPly), maxPly) : maxPly;
    const viewedSnapshot = snapshots[effectivePly];
    const displayedFen = pendingFen ?? (isFinished && viewPly !== null ? viewedSnapshot?.fen : game?.fen) ?? START_FEN;
    const displayedLastMove = isFinished && viewPly !== null ? viewedSnapshot?.lastMove ?? null : game?.lastMove ?? null;

    const captured = useMemo(
        () => (game ? capturedPieces(game.moves.slice(0, effectivePly)) : null),
        [game, effectivePly],
    );

    useEffect(() => {
        if (activeMoveRef.current) {
            activeMoveRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [effectivePly]);

    const handleSelectPly = useCallback(
        (targetPly: number) => {
            if (!game || game.status !== 'finished') return;
            const clamped = Math.min(Math.max(0, targetPly), snapshots.length - 1);
            setViewPly(clamped === snapshots.length - 1 ? null : clamped);
            if (clamped > 0 && snapshots[clamped]) {
                try {
                    const prevFen = snapshots[clamped - 1].fen;
                    const mvUci = game.moves[clamped - 1]?.uci;
                    if (mvUci) {
                        const board = new Chess(prevFen);
                        const played = board.move({
                            from: mvUci.slice(0, 2),
                            to: mvUci.slice(2, 4),
                            promotion: mvUci.length > 4 ? mvUci[4] : undefined,
                        });
                        if (played) {
                            const moverColor: ChessColor = clamped % 2 === 1 ? 'white' : 'black';
                            playChessSound(
                                soundForMove(
                                    {
                                        capture: played.isCapture(),
                                        castle: played.isKingsideCastle() || played.isQueensideCastle(),
                                        promotion: played.isPromotion(),
                                        check: board.inCheck(),
                                    },
                                    moverColor === myColor,
                                ),
                            );
                        }
                    }
                } catch {
                    void 0;
                }
            }
        },
        [game, myColor, snapshots],
    );

    const handleState = useCallback((nextGame: ChessGameView, event: ChessEvent | null) => {
        setGame((prev) => {
            const merged = {
                ...nextGame,
                playerInfo: nextGame.playerInfo ?? prev?.playerInfo,
            };
            setCachedChessGame(merged);
            return merged;
        });
        setPendingFen(null);
        setSelected(null);
        setViewPly(null);
        const clientNow = Date.now();
        setNow(clientNow);
        setSkew((nextGame.serverNow || clientNow) - clientNow);

        const color: ChessColor = nextGame.players.black === currentUser.chatId ? 'black' : 'white';

        if (event?.kind === 'opponent_joined') {
            if (!startSoundPlayedRef.current) {
                startSoundPlayedRef.current = true;
                playChessSound('game-start');
            }
            fetchDetails(gameId, true);
        } else if (event?.kind === 'move') {
            if (nextGame.ply > soundPlyRef.current) {
                soundPlyRef.current = nextGame.ply;
                playChessSound(soundForMove(event, event.by === color));
            }
            if (nextGame.status === 'finished') {
                window.setTimeout(() => playChessSound('game-end'), 200);
            }
        } else if (event?.kind === 'game_over') {
            playChessSound('game-end');
        }
    }, [currentUser.chatId, fetchDetails, gameId]);

    const handleError = useCallback((code: string) => {
        setPendingFen(null);
        if (code === 'illegal_move' || code === 'not_your_turn') {
            playChessSound('illegal');
            return;
        }
        if (code === 'forbidden') {
            onExitGame();
            return;
        }
        const msg = ERROR_MESSAGES[code];
        if (msg) notify({ message: msg, type: 'info' });
    }, [onExitGame]);

    const socketGameId = game && game.status !== 'finished' && isParticipant ? gameId : null;

    const showEmoteForColor = useCallback((by: ChessColor, emote: ChessEmote) => {
        if (!CHESS_EMOTES.some((item) => item.id === emote)) return;
        if (!emoteSoundMuted) playChessEmoteSound(emote);
        const prevTimer = emoteTimersRef.current[by];
        if (prevTimer) window.clearTimeout(prevTimer);
        emoteSeqRef.current += 1;
        const seq = emoteSeqRef.current;
        setActiveEmotes((prev) => ({ ...prev, [by]: { emote, seq } }));
        emoteTimersRef.current[by] = window.setTimeout(() => {
            setActiveEmotes((prev) => {
                if (prev[by]?.seq !== seq) return prev;
                const next = { ...prev };
                delete next[by];
                return next;
            });
        }, 3200);
    }, [emoteSoundMuted]);

    useEffect(() => {
        const timers = emoteTimersRef.current;
        return () => {
            Object.values(timers).forEach((t) => {
                if (t) window.clearTimeout(t);
            });
        };
    }, []);

    useEffect(() => {
        if (!emotePickerOpen) return;
        const onDocPointerDown = (e: PointerEvent) => {
            if (!emoteAnchorRef.current?.contains(e.target as Node)) setEmotePickerOpen(false);
        };
        document.addEventListener('pointerdown', onDocPointerDown, true);
        return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
    }, [emotePickerOpen]);

    const { connected, latencies, send } = useChessSocket({
        token: authToken,
        guestToken,
        gameId: socketGameId,
        onState: handleState,
        onError: handleError,
        onEmote: showEmoteForColor,
    });

    const handleSendEmote = useCallback((emote: ChessEmote) => {
        setEmotePickerOpen(false);
        send({ type: 'emote', emote });
    }, [send]);

    useEffect(() => {
        if (game?.status !== 'active') return;
        const id = window.setInterval(() => {
            setNow(Date.now());
        }, 100);
        return () => window.clearInterval(id);
    }, [game?.status]);

    useEffect(() => {
        movesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
    }, [game?.moves.length]);

    const commitMove = useCallback((from: string, to: string, promo?: 'q' | 'r' | 'b' | 'n') => {
        if (!game) return;
        try {
            const chess = new Chess(game.fen);
            const mv = chess.move({ from, to, promotion: promo });
            if (!mv) {
                playChessSound('illegal');
                return;
            }
            setPendingFen(chess.fen());
            setSelected(null);
            setPromotion(null);
            playChessSound(
                soundForMove(
                    {
                        capture: mv.isCapture(),
                        castle: mv.isKingsideCastle() || mv.isQueensideCastle(),
                        promotion: Boolean(promo),
                        check: chess.inCheck(),
                    },
                    true,
                ),
            );
            soundPlyRef.current = game.ply + 1;
            const ok = send({ type: 'move', uci: `${from}${to}${promo ?? ''}` });
            if (!ok) {
                setPendingFen(null);
                notify({ message: 'اتصال برقرار نیست', type: 'error' });
            }
        } catch {
            playChessSound('illegal');
        }
    }, [game, send]);

    const tryMove = useCallback((from: string, to: string): boolean => {
        if (!game || !isParticipant || game.status !== 'active' || game.turn !== myColor) return false;
        if (from === to) return false;
        try {
            const chess = new Chess(game.fen);
            const legal = chess.moves({ square: from as Square, verbose: true }).filter((m) => m.to === to);
            if (legal.length === 0) {
                playChessSound('illegal');
                return false;
            }
            if (legal.some((m) => m.isPromotion())) {
                setPromotion({ from, to });
                return false;
            }
            commitMove(from, to);
            return true;
        } catch {
            return false;
        }
    }, [game, isParticipant, myColor, commitMove]);

    const squareStyles = useMemo(() => {
        const styles: Record<string, React.CSSProperties> = {};
        if (!game) return styles;
        if (displayedLastMove) {
            styles[displayedLastMove.from] = { backgroundColor: 'rgba(245, 197, 66, 0.36)' };
            styles[displayedLastMove.to] = { backgroundColor: 'rgba(245, 197, 66, 0.46)' };
        }
        try {
            const chess = new Chess(displayedFen);
            if (chess.inCheck()) {
                const turnCode = chess.turn();
                const board = chess.board();
                for (const row of board) {
                    for (const cell of row) {
                        if (cell && cell.type === 'k' && cell.color === turnCode) {
                            styles[cell.square] = { backgroundColor: 'rgba(229, 57, 53, 0.55)' };
                        }
                    }
                }
            }
            if (selected && isParticipant && game.status === 'active' && game.turn === myColor) {
                styles[selected] = { backgroundColor: 'rgba(66, 153, 225, 0.42)' };
                const legal = chess.moves({ square: selected as Square, verbose: true });
                for (const m of legal) {
                    const isCapture = m.isCapture() || m.isEnPassant();
                    styles[m.to] = {
                        ...styles[m.to],
                        backgroundImage: isCapture
                            ? 'radial-gradient(circle, transparent 56%, rgba(0, 0, 0, 0.28) 58%, rgba(0, 0, 0, 0.28) 72%, transparent 74%)'
                            : 'radial-gradient(circle, rgba(0, 0, 0, 0.26) 22%, transparent 24%)',
                    };
                }
            }
        } catch {
            return styles;
        }
        return styles;
    }, [game, displayedFen, displayedLastMove, selected, isParticipant, myColor]);

    const handleSquareClick = useCallback(({ square }: { square: string }) => {
        if (!game || !isParticipant || game.status !== 'active' || game.turn !== myColor) return;
        try {
            const chess = new Chess(game.fen);
            if (selected) {
                if (selected === square) {
                    setSelected(null);
                    return;
                }
                const legal = chess.moves({ square: selected as Square, verbose: true }).some((m) => m.to === square);
                if (legal) {
                    tryMove(selected, square);
                    return;
                }
            }
            const piece = chess.get(square as Square);
            const myCode = myColor === 'white' ? 'w' : 'b';
            if (piece && piece.color === myCode) {
                setSelected(square);
            } else {
                setSelected(null);
            }
        } catch {
            setSelected(null);
        }
    }, [game, isParticipant, myColor, selected, tryMove]);

    const directChats = useMemo(
        () =>
            chats.filter(
                (c) =>
                    c.chatType !== 'group' &&
                    !c.id.startsWith('grp_') &&
                    !c.id.startsWith('saved_messages_') &&
                    c.id !== 'official-channel' &&
                    c.otherUser &&
                    !c.otherUser.isGroup,
            ),
        [chats],
    );

    const shareableChats = useMemo(
        () =>
            chats.filter(
                (c) =>
                    !c.id.startsWith('saved_messages_') &&
                    c.id !== 'official-channel' &&
                    c.otherUser,
            ),
        [chats],
    );

    const sendInvite = async (chatId: string) => {
        const chat = chats.find((c) => c.id === chatId);
        const targetChatId = chat?.participantIds.find((id) => id !== currentUser.chatId) || chat?.otherUser?.chatId;
        if (!targetChatId) return;
        try {
            await apiFetch(`/chess/games/${encodeURIComponent(gameId)}/invite`, {
                method: 'POST',
                body: JSON.stringify({ targetChatId }),
            });
            notify({ message: 'دعوت ارسال شد.', type: 'success' });
            fetchDetails(gameId, true);
        } catch {
            notify({ message: 'ارسال دعوت انجام نشد.', type: 'error' });
        }
    };

    const sendShare = async (chatId: string) => {
        const chat = chats.find((c) => c.id === chatId);
        const isGroup = chat?.chatType === 'group' || chatId.startsWith('grp_') || Boolean(chat?.otherUser?.isGroup);
        const targetChatId = isGroup
            ? chatId
            : chat?.participantIds.find((id) => id !== currentUser.chatId) || chat?.otherUser?.chatId || chatId;
        if (!targetChatId) return;
        try {
            await apiFetch(`/chess/games/${encodeURIComponent(gameId)}/share`, {
                method: 'POST',
                body: JSON.stringify({ targetChatId }),
            });
            notify({ message: 'بازی به اشتراک گذاشته شد.', type: 'success' });
        } catch {
            notify({ message: 'اشتراک‌گذاری بازی انجام نشد.', type: 'error' });
        }
    };

    const handleCopyGameLink = async () => {
        if (!game?.inviteToken) return;
        const url = `${window.location.origin}/chess/join/${encodeURIComponent(game.inviteToken)}`;
        try {
            await copyText(url);
            setLinkCopied(true);
            notify({ message: 'لینک بازی کپی شد', type: 'success' });
            window.setTimeout(() => setLinkCopied(false), 1800);
        } catch {
            notify({ message: 'کپی لینک انجام نشد', type: 'error' });
        }
    };

    const handleCancelWaiting = async () => {
        try {
            await apiFetch(`/chess/games/${encodeURIComponent(gameId)}`, { method: 'DELETE' });
        } catch {
            void 0;
        }
        markChessGameUnavailable(gameId);
        onExitGame();
    };

    if (notFound) {
        return (
            <motion.div className="profile chess" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
                <div className="profile__header">
                    <div className="profile__header-side">
                        <button onClick={onExitGame} className="profile__header-back back-icon-btn" aria-label="بازگشت">
                            <ChevronLeft size={22} />
                        </button>
                    </div>
                    <h1 className="profile__header-title">شطرنج</h1>
                </div>
                <div className="chess__empty">
                    <p>بازی یافت نشد</p>
                    <button type="button" className="chess-primary-btn" onClick={onExitGame}>
                        بازگشت
                    </button>
                </div>
            </motion.div>
        );
    }

    if (!game) {
        return (
            <motion.div className="profile chess" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
                <div className="profile__header">
                    <div className="profile__header-side">
                        <button onClick={onExitGame} className="profile__header-back back-icon-btn" aria-label="بازگشت">
                            <ChevronLeft size={22} />
                        </button>
                    </div>
                    <h1 className="profile__header-title">شطرنج</h1>
                </div>
                <div className="chess__body">
                    <div className="chess__stage">
                        <div className="chess__player">
                            <div className="chess__player-info">
                                <span className="skeleton" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                                <span className="skeleton" style={{ width: 96, height: 14, borderRadius: 6 }} />
                            </div>
                            <span className="skeleton" style={{ width: 58, height: 28, borderRadius: 10 }} />
                        </div>
                        <div className="chess__board-wrap">
                            <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 20 }} />
                        </div>
                        <div className="chess__player">
                            <div className="chess__player-info">
                                <span className="skeleton" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                                <span className="skeleton" style={{ width: 96, height: 14, borderRadius: 6 }} />
                            </div>
                            <span className="skeleton" style={{ width: 58, height: 28, borderRadius: 10 }} />
                        </div>
                        <div className="skeleton" style={{ width: '100%', height: 48, borderRadius: 18 }} />
                    </div>
                </div>
            </motion.div>
        );
    }

    const oppColor: ChessColor = myColor === 'white' ? 'black' : 'white';
    const oppId = game.players[oppColor];
    const oppInfo = (oppId && game.playerInfo?.[oppId]) || null;
    const bottomId = game.players[myColor];
    const bottomInfo = (bottomId && game.playerInfo?.[bottomId]) || (isParticipant ? {
        chatId: currentUser.chatId,
        name: currentUser.name,
        avatar: currentUser.avatar,
    } : null);

    const serverEstimate = now + skew;

    const getClockMs = (color: ChessColor): number | null => {
        if (!game.clocks) return null;
        const base = game.clocks[color];
        if (game.status !== 'active' || game.ply < 2 || game.turn !== color) return base;
        const elapsed = serverEstimate - game.lastMoveAt;
        return Math.max(0, base - Math.max(0, elapsed));
    };

    const myClock = getClockMs(myColor);
    const oppClock = getClockMs(oppColor);

    const firstMoveLeftMs =
        game.status === 'active' && game.ply < 2 && typeof game.firstMoveDeadline === 'number'
            ? Math.max(0, game.firstMoveDeadline - serverEstimate)
            : null;

    const disconnectLeftMs =
        game.status === 'active' && typeof game.disconnectDeadline === 'number'
            ? Math.max(0, game.disconnectDeadline - serverEstimate)
            : null;

    const movePairs: { num: number; white?: string; whitePly: number; black?: string; blackPly: number }[] = [];
    for (let i = 0; i < game.moves.length; i += 2) {
        movePairs.push({
            num: i / 2 + 1,
            white: game.moves[i]?.san,
            whitePly: i + 1,
            black: game.moves[i + 1]?.san,
            blackPly: i + 2,
        });
    }

    const canPlay = isParticipant && game.status === 'active' && game.turn === myColor;

    const isAborted = game.reason === 'aborted' || game.reason === 'first_move_timeout' || game.result === '*';

    const resultTitle = (() => {
        if (game.status !== 'finished') return '';
        if (isAborted) return 'بازی لغو شد';
        if (game.result === '1-0') return 'سفید برنده شد';
        if (game.result === '0-1') return 'سیاه برنده شد';
        return 'مساوی';
    })();

    const resultSub = game.reason && game.reason !== 'aborted' ? REASON_LABELS[game.reason] || '' : '';

    const myRatingChange = game.ratingChanges?.[myColor] ?? null;
    const oppRatingChange = game.ratingChanges?.[oppColor] ?? null;

    const winnerColor: ChessColor | null =
        game.status === 'finished' ? (game.result === '1-0' ? 'white' : game.result === '0-1' ? 'black' : null) : null;

    return (
        <motion.div className="profile chess" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className="profile__header">
                <div className="profile__header-side">
                    <button onClick={onExitGame} className="profile__header-back back-icon-btn" aria-label="بازگشت">
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">
                    شطرنج • {formatTimeControl(game.timeControl)}
                </h1>
            </div>

            <div className="chess__body">
                <div className="chess__stage">
                    <div className="chess__player">
                        <div className="chess__player-info">
                            <div className="chess__avatar-wrap">
                                {oppInfo && !oppInfo.isGuest ? (
                                    <Avatar
                                        name={oppInfo.name || 'حریف'}
                                        size="sm"
                                        src={oppInfo.avatar}
                                        online={oppId ? game.online[oppColor] : undefined}
                                    />
                                ) : oppInfo?.isGuest ? (
                                    <span className="chess__player-placeholder"><UserRound size={18} /></span>
                                ) : (
                                    <span className="chess__player-placeholder"><Hourglass size={18} /></span>
                                )}
                                <AnimatePresence>
                                    {activeEmotes[oppColor] && (
                                        <motion.div
                                            key={activeEmotes[oppColor]!.seq}
                                            className="chess__emote-pop chess__emote-pop--top"
                                            initial={{ opacity: 0, scale: 0.3, x: 12, y: -4 }}
                                            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.4 }}
                                            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                                        >
                                            <img
                                                src={`/gifs/chess/${activeEmotes[oppColor]!.emote}.webp`}
                                                alt={activeEmotes[oppColor]!.emote}
                                                className="chess__emote-gif"
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                            <div className="chess__player-text">
                                <div className="chess__player-line">
                                    {game.status !== 'finished' && (
                                        <PingBars online={Boolean(oppId) && game.online[oppColor]} latency={oppId ? latencies[oppId] : undefined} />
                                    )}
                                    <span className="chess__player-name">
                                        {oppInfo?.name || (game.status === 'waiting' ? 'منتظر حریف…' : 'حریف')}
                                    </span>
                                    {typeof oppInfo?.elo === 'number' && !oppInfo.isGuest && (
                                        <span className="chess__player-elo">({toPersianDigits(oppInfo.elo)})</span>
                                    )}
                                    <span className={cx('chess__color-dot', `chess__color-dot--${oppColor}`)} />
                                    {winnerColor === oppColor && <span className="chess__winner-badge">برنده</span>}
                                    {oppRatingChange && oppRatingChange.delta !== 0 && (
                                        <span
                                            className={cx(
                                                'chess__rating-change',
                                                oppRatingChange.delta > 0 && 'chess__rating-change--up',
                                                oppRatingChange.delta < 0 && 'chess__rating-change--down',
                                            )}
                                        >
                                            {`${oppRatingChange.delta > 0 ? '+' : '−'}${toPersianDigits(Math.abs(oppRatingChange.delta))}`}
                                        </span>
                                    )}
                                </div>
                                <CapturedRow pieces={captured?.[myColor] ?? []} color={myColor} />
                            </div>
                        </div>
                        {oppClock !== null && (
                            <div className={cx('chess__clock', game.status === 'active' && game.turn === oppColor && 'chess__clock--active')}>
                                {formatClock(oppClock)}
                            </div>
                        )}
                    </div>

                    <div className="chess__board-wrap">
                        <Chessboard
                            options={{
                                position: displayedFen,
                                boardOrientation: myColor,
                                allowDragging: canPlay,
                                dragActivationDistance: 6,
                                allowDrawingArrows: false,
                                animationDurationInMs: 160,
                                squareStyles,
                                boardStyle: {
                                    borderRadius: '14px',
                                    overflow: 'hidden',
                                },
                                lightSquareStyle: { backgroundColor: '#eeeed2' },
                                darkSquareStyle: { backgroundColor: '#769656' },
                                canDragPiece: ({ piece }) => {
                                    if (!canPlay) return false;
                                    const code = myColor === 'white' ? 'w' : 'b';
                                    return piece.pieceType.startsWith(code);
                                },
                                onPieceDrag: ({ square }) => {
                                    if (square) setSelected(square);
                                },
                                onPieceDrop: ({ sourceSquare, targetSquare }) => {
                                    if (!targetSquare || sourceSquare === targetSquare) return false;
                                    return tryMove(sourceSquare, targetSquare);
                                },
                                onSquareClick: handleSquareClick,
                            }}
                        />

                        <AnimatePresence>
                            {socketGameId && !connected && (
                                <motion.div
                                    className="chess__connecting"
                                    role="status"
                                    aria-live="polite"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.22, ease: 'easeOut' }}
                                >
                                    <span className="chess__connecting-spinner" aria-hidden="true" />
                                    <span>در حال اتصال…</span>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <AnimatePresence>
                            {promotion && (
                                <motion.div
                                    className="chess__promotion-backdrop"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    onClick={() => setPromotion(null)}
                                >
                                    <motion.div
                                        className="chess__promotion"
                                        initial={{ opacity: 0, scale: 0.9, y: 8 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.9, y: 8 }}
                                        transition={{ duration: 0.15 }}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {(['q', 'r', 'b', 'n'] as const).map((p) => (
                                            <button
                                                key={p}
                                                type="button"
                                                className="chess__promotion-btn"
                                                onClick={() => commitMove(promotion.from, promotion.to, p)}
                                            >
                                                <span className={cx('chess__promotion-piece', `chess__promotion-piece--${myColor}`)}>
                                                    {defaultPieces[`${myColor === 'white' ? 'w' : 'b'}${p.toUpperCase()}`]()}
                                                </span>
                                            </button>
                                        ))}
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <div className="chess__player">
                        <div className="chess__player-info">
                            <div className="chess__avatar-wrap">
                                {bottomInfo && !bottomInfo.isGuest ? (
                                    <Avatar
                                        name={bottomInfo.name || currentUser.name}
                                        size="sm"
                                        src={bottomInfo.avatar}
                                        online={game.online[myColor]}
                                    />
                                ) : bottomInfo?.isGuest ? (
                                    <span className="chess__player-placeholder"><UserRound size={18} /></span>
                                ) : (
                                    <span className="chess__player-placeholder"><Hourglass size={18} /></span>
                                )}
                                <AnimatePresence>
                                    {activeEmotes[myColor] && (
                                        <motion.div
                                            key={activeEmotes[myColor]!.seq}
                                            className="chess__emote-pop chess__emote-pop--bottom"
                                            initial={{ opacity: 0, scale: 0.3, x: 12, y: -4 }}
                                            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.4 }}
                                            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                                        >
                                            <img
                                                src={`/gifs/chess/${activeEmotes[myColor]!.emote}.webp`}
                                                alt={activeEmotes[myColor]!.emote}
                                                className="chess__emote-gif"
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                            <div className="chess__player-text">
                                <div className="chess__player-line">
                                    {game.status !== 'finished' && (
                                        <PingBars online={game.online[myColor]} latency={bottomId ? latencies[bottomId] : undefined} />
                                    )}
                                    <span className="chess__player-name">{bottomInfo?.name || currentUser.name}</span>
                                    {typeof bottomInfo?.elo === 'number' && !bottomInfo.isGuest && (
                                        <span className="chess__player-elo">({toPersianDigits(bottomInfo.elo)})</span>
                                    )}
                                    <span className={cx('chess__color-dot', `chess__color-dot--${myColor}`)} />
                                    {winnerColor === myColor && <span className="chess__winner-badge">برنده</span>}
                                    {myRatingChange && myRatingChange.delta !== 0 && (
                                        <span
                                            className={cx(
                                                'chess__rating-change',
                                                myRatingChange.delta > 0 && 'chess__rating-change--up',
                                                myRatingChange.delta < 0 && 'chess__rating-change--down',
                                            )}
                                        >
                                            {`${myRatingChange.delta > 0 ? '+' : '−'}${toPersianDigits(Math.abs(myRatingChange.delta))}`}
                                        </span>
                                    )}
                                </div>
                                <CapturedRow pieces={captured?.[oppColor] ?? []} color={oppColor} />
                            </div>
                        </div>
                        <div className="chess__player-end">
                            {isParticipant && game.status === 'active' && (
                                <div className="chess__emote-anchor" ref={emoteAnchorRef}>
                                    <button
                                        type="button"
                                        className={cx('chess__emote-trigger', emotePickerOpen && 'chess__emote-trigger--open')}
                                        aria-label="ایموت"
                                        disabled={Boolean(activeEmotes[myColor])}
                                        onClick={() => setEmotePickerOpen((v) => !v)}
                                    >
                                        <Smile size={18} />
                                    </button>
                                    <AnimatePresence>
                                        {emotePickerOpen && (
                                            <motion.div
                                                className="chess__emote-picker"
                                                initial={{ opacity: 0, scale: 0.88, y: 6 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.88, y: 6 }}
                                                transition={{ duration: 0.14 }}
                                            >
                                                {CHESS_EMOTES.map((item) => (
                                                    <button
                                                        key={item.id}
                                                        type="button"
                                                        className="chess__emote-option"
                                                        title={item.label}
                                                        onClick={() => handleSendEmote(item.id)}
                                                        onContextMenu={(e) => e.preventDefault()}
                                                    >
                                                        <img src={item.src} alt={item.label} className="chess__emote-option-img" draggable={false} />
                                                    </button>
                                                ))}
                                                <button
                                                    type="button"
                                                    className={cx('chess__emote-mute', emoteSoundMuted && 'chess__emote-mute--active')}
                                                    aria-label={emoteSoundMuted ? 'روشن کردن صدای ایموت' : 'بی‌صدا کردن صدای ایموت'}
                                                    onClick={() => setEmoteSoundMuted((v) => !v)}
                                                >
                                                    {emoteSoundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                                                </button>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}
                            {myClock !== null && (
                                <div className={cx('chess__clock', game.status === 'active' && game.turn === myColor && 'chess__clock--active')}>
                                    {formatClock(myClock)}
                                </div>
                            )}
                        </div>
                    </div>

                    {movePairs.length > 0 && (
                        <div className="chess__moves">
                            <div className="chess__moves-track">
                                {movePairs.map((pair) => {
                                    const whiteActive = effectivePly === pair.whitePly;
                                    const blackActive = effectivePly === pair.blackPly;
                                    return (
                                        <span key={pair.num} className="chess__move-pair">
                                            <span className="chess__move-num">{toPersianDigits(pair.num)}.</span>
                                            {pair.white && (
                                                <button
                                                    ref={whiteActive ? activeMoveRef : null}
                                                    type="button"
                                                    disabled={!isFinished}
                                                    className={cx(
                                                        'chess__move-btn',
                                                        isFinished && 'chess__move-btn--interactive',
                                                        whiteActive && 'chess__move-btn--active',
                                                    )}
                                                    onClick={() => handleSelectPly(pair.whitePly)}
                                                >
                                                    {pair.white}
                                                </button>
                                            )}
                                            {pair.black && (
                                                <button
                                                    ref={blackActive ? activeMoveRef : null}
                                                    type="button"
                                                    disabled={!isFinished}
                                                    className={cx(
                                                        'chess__move-btn',
                                                        isFinished && 'chess__move-btn--interactive',
                                                        blackActive && 'chess__move-btn--active',
                                                    )}
                                                    onClick={() => handleSelectPly(pair.blackPly)}
                                                >
                                                    {pair.black}
                                                </button>
                                            )}
                                        </span>
                                    );
                                })}
                                <div ref={movesEndRef} />
                            </div>
                        </div>
                    )}

                    {game.status === 'waiting' && isParticipant && (
                        <div className="chess__panel">
                            <span className="chess__panel-icon"><Hourglass size={26} /></span>
                            <div className="chess__panel-title">منتظر حریف…</div>
                            <div className="chess__result-sub">بازی را برای دوستت بفرست تا شروع شود</div>
                            <div className="chess__actions">
                                <button
                                    type="button"
                                    className="chess-primary-btn"
                                    onClick={() => setInviteOpen(true)}
                                >
                                    ارسال به چت
                                </button>
                                {game.inviteToken && (
                                    <button
                                        type="button"
                                        className="chess-secondary-btn chess-secondary-btn--icon"
                                        onClick={handleCopyGameLink}
                                    >
                                        {linkCopied ? <Check size={16} /> : <Link2 size={16} />}
                                        <span>{linkCopied ? 'کپی شد' : 'کپی لینک بازی'}</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="chess-secondary-btn chess-secondary-btn--danger"
                                    onClick={handleCancelWaiting}
                                >
                                    لغو بازی
                                </button>
                            </div>
                        </div>
                    )}

                    {game.status === 'active' && firstMoveLeftMs !== null && (
                        <div className="chess__timer-banner">
                            <span>
                                {game.turn === myColor ? 'مهلت حرکت اول شما' : 'مهلت حرکت اول حریف'}
                            </span>
                            <span className="chess__timer-pill">{formatClock(firstMoveLeftMs)}</span>
                        </div>
                    )}

                    {game.status === 'active' && game.disconnectTarget && (
                        <div className="chess__timer-banner chess__timer-banner--warn">
                            <span>
                                {game.disconnectTarget === 'double'
                                    ? 'قطع اتصال هر دو بازیکن • مهلت بازگشت'
                                    : game.disconnectTarget === myColor
                                      ? disconnectLeftMs !== null
                                          ? 'اتصال شما قطع شد • مهلت بازگشت'
                                          : 'اتصال شما قطع است'
                                      : disconnectLeftMs !== null
                                        ? 'اتصال حریف قطع شد • مهلت بازگشت'
                                        : 'اتصال حریف قطع است (شروع تایمر در نوبت حریف)'}
                            </span>
                            {disconnectLeftMs !== null && (
                                <span className="chess__timer-pill">{formatClock(disconnectLeftMs)}</span>
                            )}
                        </div>
                    )}

                    {game.status === 'active' && isParticipant && (
                        <>
                            {game.drawOfferedBy === oppColor && (
                                <div className="chess__draw-banner">
                                    <span>پیشنهاد مساوی از طرف حریف</span>
                                    <div className="chess__draw-actions">
                                        <button
                                            type="button"
                                            className="chess-chip chess-chip--active"
                                            onClick={() => send({ type: 'draw_accept' })}
                                        >
                                            قبول
                                        </button>
                                        <button
                                            type="button"
                                            className="chess-chip"
                                            onClick={() => send({ type: 'draw_decline' })}
                                        >
                                            رد
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="chess__controls">
                                {game.ply < 2 ? (
                                    <button
                                        type="button"
                                        className="chess-secondary-btn"
                                        onClick={() => send({ type: 'abort' })}
                                    >
                                        لغو بازی
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="chess-secondary-btn"
                                        disabled={game.drawOfferedBy === myColor}
                                        onClick={() => send({ type: 'draw_offer' })}
                                    >
                                        {game.drawOfferedBy === myColor ? 'پیشنهاد مساوی ارسال شد' : 'پیشنهاد مساوی'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="chess-secondary-btn chess-secondary-btn--danger"
                                    onClick={() => setConfirmResign(true)}
                                >
                                    تسلیم
                                </button>
                            </div>
                        </>
                    )}

                    {game.status === 'finished' && (
                        <div className="chess__panel">
                            <div className="chess__result-title">{resultTitle}</div>
                            {resultSub && <div className="chess__result-sub">{resultSub}</div>}
                            <div className="chess__actions">
                                {isParticipant && !isGuestMode && !isAborted && (
                                    <button
                                        type="button"
                                        className="chess-secondary-btn"
                                        onClick={() => setShareOpen(true)}
                                    >
                                        اشتراک‌گذاری بازی
                                    </button>
                                )}
                                <button type="button" className="chess-primary-btn" style={{ flex: 1 }} onClick={onExitGame}>
                                    بازگشت
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <ForwardModal
                isOpen={inviteOpen}
                chats={directChats}
                currentUserId={currentUser.chatId}
                title="ارسال بازی به چت"
                hideSavedMessages
                onClose={() => setInviteOpen(false)}
                onSelectTargetChat={sendInvite}
            />

            <ForwardModal
                isOpen={shareOpen}
                chats={shareableChats}
                currentUserId={currentUser.chatId}
                title="اشتراک‌گذاری بازی در چت"
                hideSavedMessages
                onClose={() => setShareOpen(false)}
                onSelectTargetChat={sendShare}
            />

            <AnimatePresence>
                {confirmResign && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        style={{ zIndex: 120 }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        onClick={() => setConfirmResign(false)}
                    >
                        <motion.div
                            className="chat-room-confirm-modal"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, y: 14, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h3 className="chat-room-confirm-modal__title">تسلیم در بازی؟</h3>
                            <p className="chat-room-confirm-modal__text">آیا می‌خواهید تسلیم شوید؟</p>
                            <div className="chat-room-confirm-modal__actions">
                                <button
                                    className="chat-room-confirm-modal__btn"
                                    onClick={() => setConfirmResign(false)}
                                    type="button"
                                >
                                    لغو
                                </button>
                                <button
                                    className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger"
                                    onClick={() => {
                                        setConfirmResign(false);
                                        send({ type: 'resign' });
                                    }}
                                    type="button"
                                >
                                    تسلیم
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}
