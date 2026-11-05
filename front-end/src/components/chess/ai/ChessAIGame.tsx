import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard, defaultPieces } from 'react-chessboard';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, RotateCcw, Undo2 } from 'lucide-react';
import type { User } from '../../../types';
import { playChessSound, soundForMove } from '../../../utils/chessSounds';
import { cx } from '../../../utils/cx';
import { toPersianDigits } from '../../../utils/format';
import { screenVariants } from '../../../utils/screenMotion';
import { Avatar } from '../../Avatar';
import { AI_DEFAULT_DIFFICULTY, AI_DIFFICULTIES, AI_DIFFICULTY_ORDER, AI_HASH_MB } from './difficulty';
import type { AiDifficulty } from './difficulty';
import { StockfishEngine } from './stockfishEngine';
import type { EngineStatus } from './stockfishEngine';
import { createStockfishWorker, downloadStockfishAssets, isStockfishDownloaded } from './stockfishAssets';
import { clearSavedAiGame, loadSavedAiGame, saveAiGame } from './chessAiStorage';
import type { SavedAiGame } from './chessAiStorage';
import { CapturedRow, capturedPieces } from '../ChessGame';
import './chess-ai.css';

interface ChessAIGameProps {
    currentUser: User;
    onExitGame: () => void;
}

type PlayColor = 'white' | 'black';
type ColorChoice = PlayColor | 'random';
type PromotionPiece = 'q' | 'r' | 'b' | 'n';
type GamePhase = 'setup' | 'playing';

interface LastMove {
    from: Square;
    to: Square;
}

interface LineEntry {
    fen: string;
    lastMove: LastMove | null;
    san: string | null;
    playerMs: number;
    at: number;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const BOT_AVATAR = `${import.meta.env.BASE_URL}logo/stockfish.webp`;

const AI_TIME_OPTIONS = [
    { value: 'unlimited', label: 'بدون زمان', baseMs: 0 },
    { value: '1', label: '۱ دقیقه', baseMs: 60_000 },
    { value: '3', label: '۳ دقیقه', baseMs: 180_000 },
    { value: '5', label: '۵ دقیقه', baseMs: 300_000 },
    { value: '10', label: '۱۰ دقیقه', baseMs: 600_000 },
    { value: '15', label: '۱۵ دقیقه', baseMs: 900_000 },
    { value: '30', label: '۳۰ دقیقه', baseMs: 1_800_000 },
] as const;

type TimeValue = (typeof AI_TIME_OPTIONS)[number]['value'];

const PROMOTION_LABELS: Record<PromotionPiece, string> = {
    q: 'وزیر',
    r: 'رخ',
    b: 'فیل',
    n: 'اسب',
};

const ERROR_TEXT: Record<string, string> = {
    engine_illegal_move: 'موتور حرکت غیرقانونی برگرداند؛ حرکت رد شد. بازی را دوباره شروع کنید.',
    engine_no_move: 'موتور حرکتی برنگرداند. بازی را دوباره شروع کنید.',
    engine_not_ready: 'موتور هنوز آماده نیست.',
    engine_search_failed: 'جست‌وجوی موتور ناموفق بود. دوباره تلاش کنید.',
    search_timeout: 'جست‌وجوی موتور بیش از حد طول کشید و متوقف شد.',
    engine_stop_timeout: 'موتور به درخواست توقف پاسخ نداد و متوقف شد.',
};

const DEFAULT_ENGINE_ERROR =
    'موتور استاک‌فیش راه‌اندازی نشد. مرورگر شما باید از WebAssembly و Web Worker پشتیبانی کند.';

const startEntry = (baseMs: number): LineEntry => ({
    fen: START_FEN,
    lastMove: null,
    san: null,
    playerMs: baseMs,
    at: Date.now(),
});

const formatClock = (ms: number): string => {
    const clamped = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    return `${toPersianDigits(String(minutes).padStart(2, '0'))}:${toPersianDigits(String(seconds).padStart(2, '0'))}`;
};

const isTimeValue = (value: string): value is TimeValue =>
    AI_TIME_OPTIONS.some((option) => option.value === value);

const restoreLine = (saved: SavedAiGame): LineEntry[] => {
    const restored = saved.line.map((entry, index, all) => ({
        fen: entry.fen,
        lastMove: entry.lastMove
            ? { from: entry.lastMove.from as Square, to: entry.lastMove.to as Square }
            : null,
        san: entry.san,
        playerMs: entry.playerMs,
        at: index === all.length - 1 ? Date.now() : entry.at,
    }));
    return restored;
};

const isSavedGamePlayable = (saved: SavedAiGame): boolean => {
    try {
        return !new Chess(saved.line[saved.line.length - 1].fen).isGameOver();
    } catch {
        return false;
    }
};

const positionKey = (value: string): string => value.split(' ').slice(0, 4).join(' ');

export function ChessAIGame({ currentUser, onExitGame }: ChessAIGameProps) {
    const [saved] = useState<SavedAiGame | null>(loadSavedAiGame);
    const savedGame = saved && isTimeValue(saved.timeValue) && isSavedGamePlayable(saved) ? saved : null;
    const [phase, setPhase] = useState<GamePhase>(savedGame ? 'playing' : 'setup');
    const [difficulty, setDifficulty] = useState<AiDifficulty>(savedGame?.difficulty ?? AI_DEFAULT_DIFFICULTY);
    const [playerColor, setPlayerColor] = useState<PlayColor>(savedGame?.playerColor ?? 'white');
    const [colorChoice, setColorChoice] = useState<ColorChoice>(savedGame?.playerColor ?? 'white');
    const [timeValue, setTimeValue] = useState<TimeValue>(() =>
        savedGame && isTimeValue(savedGame.timeValue) ? savedGame.timeValue : 'unlimited',
    );
    const [line, setLine] = useState<LineEntry[]>(() =>
        savedGame ? restoreLine(savedGame) : [startEntry(0)],
    );
    const [selected, setSelected] = useState<Square | null>(null);
    const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
    const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
    const [engineError, setEngineError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [pageVisible, setPageVisible] = useState(() => !document.hidden);
    const [now, setNow] = useState(() => Date.now());
    const [timedOut, setTimedOut] = useState(false);
    const [starting, setStarting] = useState(false);
    const [downloadPercent, setDownloadPercent] = useState(0);
    const [setupError, setSetupError] = useState<string | null>(null);
    const [boardKey, setBoardKey] = useState(0);
    const [viewIndex, setViewIndex] = useState<number | null>(null);

    const engineRef = useRef<StockfishEngine | null>(null);
    const fenRef = useRef(START_FEN);
    const movesEndRef = useRef<HTMLDivElement | null>(null);
    const activeMoveRef = useRef<HTMLButtonElement | null>(null);
    const mountedRef = useRef(true);
    const draggingRef = useRef(false);

    const timeConfig = AI_TIME_OPTIONS.find((option) => option.value === timeValue) ?? AI_TIME_OPTIONS[0];
    const latest = line[line.length - 1];
    const latestPosition = useMemo(() => new Chess(latest.fen), [latest.fen]);
    const repetitionCount = useMemo(() => {
        const key = positionKey(latest.fen);
        return line.reduce((count, entry) => count + (positionKey(entry.fen) === key ? 1 : 0), 0);
    }, [latest.fen, line]);
    const threefoldRepetition = repetitionCount >= 3;
    const playerCode = playerColor === 'white' ? 'w' : 'b';
    const aiColor: PlayColor = playerColor === 'white' ? 'black' : 'white';
    const gameOver = latestPosition.isGameOver() || threefoldRepetition || timedOut;
    const activeIndex = gameOver && viewIndex !== null ? Math.min(Math.max(0, viewIndex), line.length - 1) : line.length - 1;
    const current = line[activeIndex];
    const fen = current.fen;
    const position = useMemo(() => new Chess(fen), [fen]);
    const captured = useMemo(() => capturedPieces(line.slice(0, activeIndex + 1)), [line, activeIndex]);
    const isPlayerTurn = latestPosition.turn() === playerCode && !gameOver;
    const engineReady = engineStatus === 'ready' || engineStatus === 'searching';
    const hasEngineError = engineError !== null || engineStatus === 'error';
    const thinking = !isPlayerTurn && !gameOver && !hasEngineError;
    const difficultyConfig = AI_DIFFICULTIES[difficulty];
    const aiName = 'استاک‌فیش';

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useLayoutEffect(() => {
        fenRef.current = latest.fen;
    }, [latest.fen]);

    useEffect(() => {
        const onVisibilityChange = () => setPageVisible(!document.hidden);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    useEffect(() => {
        const releaseStuckDrag = () => {
            if (!draggingRef.current) return;
            window.setTimeout(() => {
                if (!draggingRef.current) return;
                draggingRef.current = false;
                setSelected(null);
                setBoardKey((key) => key + 1);
            }, 120);
        };
        window.addEventListener('pointerup', releaseStuckDrag);
        window.addEventListener('pointercancel', releaseStuckDrag);
        window.addEventListener('touchend', releaseStuckDrag);
        return () => {
            window.removeEventListener('pointerup', releaseStuckDrag);
            window.removeEventListener('pointercancel', releaseStuckDrag);
            window.removeEventListener('touchend', releaseStuckDrag);
        };
    }, []);

    useEffect(() => {
        if (saved && !savedGame) clearSavedAiGame();
    }, [saved, savedGame]);

    useEffect(() => {
        if (phase !== 'playing') return;
        if (gameOver) {
            clearSavedAiGame();
            return;
        }
        saveAiGame({ version: 2, difficulty, playerColor, timeValue, line });
    }, [difficulty, gameOver, line, phase, playerColor, timeValue]);

    useEffect(() => {
        if (phase !== 'playing') return;
        let disposed = false;
        setEngineStatus('starting');

        (async () => {
            try {
                const worker = await createStockfishWorker();
                if (disposed) {
                    worker.terminate();
                    return;
                }
                const engine = new StockfishEngine(worker, (status, error) => {
                    if (disposed) return;
                    setEngineStatus(status);
                    if (status === 'error') setEngineError(error ?? 'engine_error');
                });
                engineRef.current = engine;
                await engine.init(AI_HASH_MB);
            } catch (err) {
                if (disposed) return;
                setEngineStatus('error');
                setEngineError(err instanceof Error ? err.message : 'engine_init_failed');
            }
        })();

        return () => {
            disposed = true;
            engineRef.current?.destroy();
            engineRef.current = null;
        };
    }, [attempt, phase]);

    useEffect(() => {
        if (phase !== 'playing' || timeConfig.baseMs === 0 || gameOver || !isPlayerTurn) return;
        const id = window.setInterval(() => setNow(Date.now()), 200);
        return () => window.clearInterval(id);
    }, [gameOver, isPlayerTurn, phase, timeConfig.baseMs]);

    const playerClock =
        timeConfig.baseMs === 0
            ? null
            : timedOut
                ? 0
                : isPlayerTurn
                    ? Math.max(0, current.playerMs - (now - current.at))
                    : current.playerMs;

    useEffect(() => {
        if (phase !== 'playing' || gameOver || playerClock === null) return;
        if (playerClock <= 0) {
            setTimedOut(true);
            playChessSound('game-end');
        }
    }, [gameOver, phase, playerClock]);

    useEffect(() => {
        if (phase !== 'playing' || !engineReady || !pageVisible) return;
        if (gameOver || latestPosition.turn() === playerCode) return;

        const engine = engineRef.current;
        if (!engine) return;

        let cancelled = false;
        let delayTimer: number | null = null;
        const searchedFen = latest.fen;

        engine
            .search({
                fen: searchedFen,
                movetimeMs: difficultyConfig.movetimeMs,
                skillLevel: difficultyConfig.skillLevel,
                depth: difficultyConfig.depth,
                multiPv: difficultyConfig.multiPv,
                minRankRatio: difficultyConfig.minRankRatio,
            })
            .then((result) => {
                if (cancelled || !result) return;
                if (!result.bestmove) {
                    setEngineError('engine_no_move');
                    return;
                }
                if (!UCI_MOVE.test(result.bestmove)) {
                    setEngineError('engine_illegal_move');
                    return;
                }
                const bestmove = result.bestmove;
                const waitMs = Math.max(0, difficultyConfig.movetimeMs - result.elapsedMs);
                delayTimer = window.setTimeout(() => {
                    if (cancelled || fenRef.current !== searchedFen) return;

                    const board = new Chess(searchedFen);
                    const from = bestmove.slice(0, 2) as Square;
                    const to = bestmove.slice(2, 4) as Square;
                    const promo = bestmove.length > 4 ? (bestmove[4] as PromotionPiece) : undefined;

                    try {
                        const move = board.move({ from, to, promotion: promo });
                        if (!move) {
                            setEngineError('engine_illegal_move');
                            return;
                        }
                        playChessSound(
                            soundForMove(
                                {
                                    capture: move.isCapture(),
                                    castle: move.isKingsideCastle() || move.isQueensideCastle(),
                                    promotion: move.isPromotion(),
                                    check: board.inCheck(),
                                },
                                false,
                            ),
                        );
                        const nowMs = Date.now();
                        setLine((prev) => {
                            const last = prev[prev.length - 1];
                            if (!last || last.fen !== searchedFen) return prev;
                            return [
                                ...prev,
                                {
                                    fen: board.fen(),
                                    lastMove: { from, to },
                                    san: move.san,
                                    playerMs: last.playerMs,
                                    at: nowMs,
                                },
                            ];
                        });
                    } catch {
                        setEngineError('engine_illegal_move');
                    }
                }, waitMs);
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setEngineError(err instanceof Error ? err.message : 'engine_search_failed');
                }
            });

        return () => {
            cancelled = true;
            if (delayTimer !== null) window.clearTimeout(delayTimer);
            engine.stop();
        };
    }, [difficultyConfig, engineReady, gameOver, latest.fen, latestPosition, pageVisible, phase, playerCode]);

    useEffect(() => {
        movesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
    }, [line.length]);

    useEffect(() => {
        if (activeMoveRef.current) {
            activeMoveRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }, [activeIndex]);

    const commitPlayerMove = useCallback(
        (from: Square, to: Square, promo?: PromotionPiece) => {
            setPromotion(null);
            setSelected(null);

            const board = new Chess(fenRef.current);
            try {
                const move = board.move({ from, to, promotion: promo });
                if (!move) {
                    playChessSound('illegal');
                    return;
                }
                playChessSound(
                    soundForMove(
                        {
                            capture: move.isCapture(),
                            castle: move.isKingsideCastle() || move.isQueensideCastle(),
                            promotion: move.isPromotion(),
                            check: board.inCheck(),
                        },
                        true,
                    ),
                );
                const searchedFen = fenRef.current;
                const nowMs = Date.now();
                setLine((prev) => {
                    const last = prev[prev.length - 1];
                    if (!last || last.fen !== searchedFen) return prev;
                    const remaining = Math.max(0, last.playerMs - (nowMs - last.at));
                    return [
                        ...prev,
                        {
                            fen: board.fen(),
                            lastMove: { from, to },
                            san: move.san,
                            playerMs: remaining,
                            at: nowMs,
                        },
                    ];
                });
            } catch {
                playChessSound('illegal');
            }
        },
        [],
    );

    const tryPlayerMove = useCallback(
        (from: Square, to: Square): boolean => {
            if (!isPlayerTurn || hasEngineError || phase !== 'playing') return false;

            try {
                const board = new Chess(fenRef.current);
                const legal = board.moves({ square: from, verbose: true }).filter((move) => move.to === to);
                if (legal.length === 0) {
                    playChessSound('illegal');
                    return false;
                }
                if (legal.some((move) => move.isPromotion())) {
                    setPromotion({ from, to });
                    return false;
                }
                commitPlayerMove(from, to);
                return true;
            } catch {
                playChessSound('illegal');
                return false;
            }
        },
        [commitPlayerMove, hasEngineError, isPlayerTurn, phase],
    );

    const handleSquareClick = useCallback(
        ({ square }: { square: string }) => {
            if (!isPlayerTurn || hasEngineError) return;
            const target = square as Square;

            try {
                const board = new Chess(fenRef.current);
                if (selected) {
                    if (selected === target) {
                        setSelected(null);
                        return;
                    }
                    const legal = board
                        .moves({ square: selected, verbose: true })
                        .some((move) => move.to === target);
                    if (legal) {
                        tryPlayerMove(selected, target);
                        return;
                    }
                }
                const piece = board.get(target);
                setSelected(piece && piece.color === playerCode ? target : null);
            } catch {
                setSelected(null);
            }
        },
        [hasEngineError, isPlayerTurn, playerCode, selected, tryPlayerMove],
    );

    const squareStyles = useMemo(() => {
        const styles: Record<string, React.CSSProperties> = {};
        if (current.lastMove) {
            styles[current.lastMove.from] = { backgroundColor: 'rgba(245, 197, 66, 0.36)' };
            styles[current.lastMove.to] = { backgroundColor: 'rgba(245, 197, 66, 0.46)' };
        }

        if (position.inCheck()) {
            const turn = position.turn();
            for (const row of position.board()) {
                for (const cell of row) {
                    if (cell && cell.type === 'k' && cell.color === turn) {
                        styles[cell.square] = { backgroundColor: 'rgba(229, 57, 53, 0.55)' };
                    }
                }
            }
        }

        if (selected && isPlayerTurn) {
            styles[selected] = { backgroundColor: 'rgba(66, 153, 225, 0.42)' };
            for (const move of position.moves({ square: selected, verbose: true })) {
                const isCapture = move.isCapture() || move.isEnPassant();
                styles[move.to] = {
                    ...styles[move.to],
                    backgroundImage: isCapture
                        ? 'radial-gradient(circle, transparent 56%, rgba(0, 0, 0, 0.28) 58%, rgba(0, 0, 0, 0.28) 72%, transparent 74%)'
                        : 'radial-gradient(circle, rgba(0, 0, 0, 0.26) 22%, transparent 24%)',
                };
            }
        }

        return styles;
    }, [current.lastMove, isPlayerTurn, position, selected]);

    const handleStart = useCallback(async () => {
        if (starting) return;
        setSetupError(null);
        setStarting(true);
        setDownloadPercent(0);
        try {
            if (!(await isStockfishDownloaded())) {
                await downloadStockfishAssets((loaded, total) => {
                    if (total > 0) setDownloadPercent(Math.round((loaded / total) * 100));
                });
            }
            if (!mountedRef.current) return;
            setPlayerColor(colorChoice === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : colorChoice);
            setLine([startEntry(timeConfig.baseMs)]);
            setSelected(null);
            setPromotion(null);
            setEngineError(null);
            setEngineStatus('starting');
            setTimedOut(false);
            setViewIndex(null);
            setNow(Date.now());
            setPhase('playing');
        } catch {
            if (mountedRef.current) {
                setSetupError('دانلود موتور شطرنج انجام نشد. اتصال اینترنت را بررسی کنید.');
            }
        } finally {
            if (mountedRef.current) setStarting(false);
        }
    }, [colorChoice, starting, timeConfig.baseMs]);

    const backToSetup = useCallback(() => {
        engineRef.current?.stop();
        clearSavedAiGame();
        setPhase('setup');
        setLine([startEntry(timeConfig.baseMs)]);
        setSelected(null);
        setPromotion(null);
        setEngineError(null);
        setTimedOut(false);
        setViewIndex(null);
    }, [timeConfig.baseMs]);

    const undo = useCallback(() => {
        engineRef.current?.stop();
        setSelected(null);
        setPromotion(null);
        setEngineError(null);
        setTimedOut(false);
        setViewIndex(null);
        setNow(Date.now());
        setLine((prev) => {
            if (prev.length <= 1) return prev;
            let next = prev.slice(0, -1);
            while (next.length > 1 && new Chess(next[next.length - 1].fen).turn() !== playerCode) {
                next = next.slice(0, -1);
            }
            const nowMs = Date.now();
            return next.map((entry, index) => (index === next.length - 1 ? { ...entry, at: nowMs } : entry));
        });
    }, [playerCode]);

    const retryEngine = useCallback(() => {
        setEngineError(null);
        setEngineStatus('starting');
        setAttempt((value) => value + 1);
    }, []);

    const canPlay = phase === 'playing' && isPlayerTurn && !promotion && !hasEngineError;
    const canUndo = playerColor === 'white' ? line.length >= 2 : line.length >= 3;
    const engineErrorText = engineError ? ERROR_TEXT[engineError] ?? DEFAULT_ENGINE_ERROR : DEFAULT_ENGINE_ERROR;

    const winnerColor: PlayColor | null = !gameOver
        ? null
        : timedOut
            ? aiColor
            : latestPosition.isCheckmate()
                ? latestPosition.turn() === playerCode
                    ? aiColor
                    : playerColor
                : null;

    const resultTitle = winnerColor ? `${winnerColor === 'white' ? 'سفید' : 'سیاه'} برنده شد` : 'مساوی';

    const resultSub = (() => {
        if (timedOut) return 'اتمام زمان';
        if (latestPosition.isCheckmate()) return 'کیش و مات';
        if (latestPosition.isStalemate()) return 'پات';
        if (latestPosition.isInsufficientMaterial()) return 'مهره کافی نیست';
        if (threefoldRepetition) return 'تکرار حرکت';
        if (latestPosition.isDrawByFiftyMoves()) return 'قانون ۵۰ حرکت';
        return 'مساوی';
    })();

    const movePairs: { num: number; white?: string; whitePly: number; black?: string; blackPly: number }[] = [];
    const playedMoves = line.slice(1);
    for (let i = 0; i < playedMoves.length; i += 2) {
        movePairs.push({
            num: i / 2 + 1,
            white: playedMoves[i]?.san ?? undefined,
            whitePly: i + 1,
            black: playedMoves[i + 1]?.san ?? undefined,
            blackPly: i + 2,
        });
    }

    return (
        <motion.div
            key={phase}
            className="profile chess chess-ai"
            variants={screenVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            <div className="profile__header">
                <div className="profile__header-side">
                    <button onClick={onExitGame} className="profile__header-back back-icon-btn" aria-label="بازگشت">
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">شطرنج با ربات</h1>
            </div>

            <div className="chess__body">
                <div className="chess__stage">
                    {phase === 'setup' ? (
                        <div className="chess-card chess-ai__setup">
                            <div className="chess-card__header">
                                <Avatar name={aiName} size="lg" plain src={BOT_AVATAR} />
                                <div>
                                    <div className="chess-card__title">{aiName}</div>
                                    <div className="chess-card__sub">بازی با ربات شطرنج</div>
                                </div>
                            </div>

                            <div className="chess-section">
                                <div className="chess-section__label">زمان شما</div>
                                <div className="chess-chips">
                                    {AI_TIME_OPTIONS.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={cx('chess-chip', timeValue === option.value && 'chess-chip--active')}
                                            onClick={() => setTimeValue(option.value)}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="chess-section">
                                <div className="chess-section__label">سطح</div>
                                <div className="chess-chips">
                                    {AI_DIFFICULTY_ORDER.map((id) => (
                                        <button
                                            key={id}
                                            type="button"
                                            className={cx('chess-chip', difficulty === id && 'chess-chip--active')}
                                            onClick={() => setDifficulty(id)}
                                        >
                                            {AI_DIFFICULTIES[id].label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="chess-section">
                                <div className="chess-section__label">مهره شما</div>
                                <div className="chess-chips">
                                    {([
                                        { value: 'white', label: 'سفید' },
                                        { value: 'random', label: 'تصادفی' },
                                        { value: 'black', label: 'سیاه' },
                                    ] as const).map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={cx('chess-chip', colorChoice === option.value && 'chess-chip--active')}
                                            onClick={() => setColorChoice(option.value)}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {setupError && <div className="chess-ai__setup-error">{setupError}</div>}

                            <button type="button" className="chess-primary-btn" onClick={handleStart} disabled={starting}>
                                {starting ? (
                                    <>
                                        <span className="chess-ai__spinner" aria-hidden="true" />
                                        <span>
                                            {downloadPercent > 0
                                                ? `در حال دانلود موتور… ${toPersianDigits(downloadPercent)}٪`
                                                : 'در حال آماده‌سازی موتور…'}
                                        </span>
                                    </>
                                ) : (
                                    <span>شروع بازی</span>
                                )}
                            </button>

                        </div>
                    ) : (
                        <>
                            <div className="chess__player">
                                <div className="chess__player-info">
                                    <Avatar name={aiName} size="sm" plain src={BOT_AVATAR} />
                                    <div className="chess__player-text">
                                        <div className="chess__player-line">
                                            <span className="chess__player-name">{aiName}</span>
                                            <span className="chess__player-elo">({difficultyConfig.label})</span>
                                            <span className={cx('chess__color-dot', `chess__color-dot--${aiColor}`)} />
                                            {winnerColor === aiColor && <span className="chess__winner-badge">برنده</span>}
                                        </div>
                                        <CapturedRow pieces={captured[playerColor]} color={playerColor} />
                                    </div>
                                </div>
                                {thinking && (
                                    <div className="chess-ai__thinking" role="status" aria-label="ربات در حال فکر کردن است">
                                        <span className="chess-ai__spinner" aria-hidden="true" />
                                    </div>
                                )}
                            </div>

                            <div className="chess__board-wrap">
                                <Chessboard
                                    key={boardKey}
                                    options={{
                                        position: fen,
                                        boardOrientation: playerColor,
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
                                        canDragPiece: ({ piece }) => canPlay && piece.pieceType.startsWith(playerCode),
                                        onPieceDrag: ({ square }) => {
                                            draggingRef.current = true;
                                            if (square) setSelected(square as Square);
                                        },
                                        onPieceDragCancel: () => {
                                            draggingRef.current = false;
                                            setSelected(null);
                                        },
                                        onPieceDrop: ({ sourceSquare, targetSquare }) => {
                                            draggingRef.current = false;
                                            if (!targetSquare || sourceSquare === targetSquare) return false;
                                            return tryPlayerMove(sourceSquare as Square, targetSquare as Square);
                                        },
                                        onSquareClick: handleSquareClick,
                                    }}
                                />

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
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                {(['q', 'r', 'b', 'n'] as const).map((piece) => (
                                                    <button
                                                        key={piece}
                                                        type="button"
                                                        className="chess__promotion-btn"
                                                        aria-label={`ارتقا به ${PROMOTION_LABELS[piece]}`}
                                                        onClick={() => commitPlayerMove(promotion.from, promotion.to, piece)}
                                                    >
                                                        <span className={cx('chess__promotion-piece', `chess__promotion-piece--${playerColor}`)}>
                                                            {defaultPieces[`${playerCode}${piece.toUpperCase()}`]()}
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
                                    <Avatar name={currentUser.name} size="sm" src={currentUser.avatar} />
                                    <div className="chess__player-text">
                                        <div className="chess__player-line">
                                            <span className="chess__player-name">{currentUser.name}</span>
                                            <span className={cx('chess__color-dot', `chess__color-dot--${playerColor}`)} />
                                            {winnerColor === playerColor && <span className="chess__winner-badge">برنده</span>}
                                        </div>
                                        <CapturedRow pieces={captured[aiColor]} color={aiColor} />
                                    </div>
                                </div>
                                {playerClock !== null && (
                                    <div className={cx('chess__clock', !gameOver && isPlayerTurn && 'chess__clock--active')}>
                                        {formatClock(playerClock)}
                                    </div>
                                )}
                            </div>

                            {movePairs.length > 0 && (
                                <div className="chess__moves">
                                    <div className="chess__moves-track">
                                        {movePairs.map((pair) => {
                                            const whiteActive = activeIndex === pair.whitePly;
                                            const blackActive = activeIndex === pair.blackPly;
                                            return (
                                                <span key={pair.num} className="chess__move-pair">
                                                    <span className="chess__move-num">{toPersianDigits(pair.num)}.</span>
                                                    {pair.white && (
                                                        <button
                                                            ref={whiteActive ? activeMoveRef : null}
                                                            type="button"
                                                            disabled={!gameOver}
                                                            className={cx(
                                                                'chess__move-btn',
                                                                gameOver && 'chess__move-btn--interactive',
                                                                whiteActive && 'chess__move-btn--active',
                                                            )}
                                                            onClick={() => {
                                                                if (gameOver) setViewIndex(pair.whitePly);
                                                            }}
                                                        >
                                                            {pair.white}
                                                        </button>
                                                    )}
                                                    {pair.black && (
                                                        <button
                                                            ref={blackActive ? activeMoveRef : null}
                                                            type="button"
                                                            disabled={!gameOver}
                                                            className={cx(
                                                                'chess__move-btn',
                                                                gameOver && 'chess__move-btn--interactive',
                                                                blackActive && 'chess__move-btn--active',
                                                            )}
                                                            onClick={() => {
                                                                if (gameOver) setViewIndex(pair.blackPly);
                                                            }}
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

                            {gameOver && (
                                <div className="chess__panel">
                                    <div className="chess__result-title">{resultTitle}</div>
                                    <div className="chess__result-sub">{resultSub}</div>
                                </div>
                            )}

                            {hasEngineError && (
                                <div className="chess__panel chess-ai__error" role="alert">
                                    <div className="chess__result-title">موتور شطرنج در دسترس نیست</div>
                                    <div className="chess__result-sub">{engineErrorText}</div>
                                    <div className="chess__actions">
                                        <button type="button" className="chess-primary-btn" onClick={retryEngine}>
                                            تلاش دوباره
                                        </button>
                                        <button type="button" className="chess-secondary-btn" onClick={onExitGame}>
                                            خروج
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="chess__actions chess-ai__controls">
                                <button type="button" className="chess-primary-btn" onClick={backToSetup}>
                                    <RotateCcw size={16} />
                                    <span>بازی جدید</span>
                                </button>
                                <button type="button" className="chess-secondary-btn" onClick={undo} disabled={!canUndo}>
                                    <Undo2 size={16} />
                                    <span>بازگشت حرکت</span>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
