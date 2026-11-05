import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, UserRound } from 'lucide-react';
import { apiFetch } from '../../config/api';
import type { ChessColor, ChessGameView, ChessLeaderboardEntry } from '../../types';
import { seedChessGames } from '../../utils/chessCache';
import { cx } from '../../utils/cx';
import { toPersianDigits } from '../../utils/format';
import { screenVariants } from '../../utils/screenMotion';
import { Avatar } from '../Avatar';
import { VerifiedBadge } from '../VerifiedBadge';

interface ChessUserProfileProps {
    entry: ChessLeaderboardEntry;
    onBack: () => void;
    onOpenContactInfo: () => void;
    onOpenGame: (gameId: string) => void;
}

const HISTORY_PAGE_SIZE = 30;
const PROFILE_FRESH_MS = 10_000;

interface ProfileSnapshot {
    history: ChessGameView[];
    hasMore: boolean;
    scrollTop: number;
    updatedAt: number;
}

const profileSnapshots = new Map<string, ProfileSnapshot>();

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
};

const formatTimeControl = (tc: string) => (tc === 'unlimited' ? 'بدون زمان' : toPersianDigits(tc));

export function ChessUserProfile({
    entry,
    onBack,
    onOpenContactInfo,
    onOpenGame,
}: ChessUserProfileProps) {
    const targetUser = entry.user;
    const cachedProfile = profileSnapshots.get(targetUser.chatId);
    const [history, setHistory] = useState<ChessGameView[]>(() => cachedProfile?.history ?? []);
    const [hasMore, setHasMore] = useState(() => cachedProfile?.hasMore ?? false);
    const [loading, setLoading] = useState(() => !cachedProfile);
    const [loadingMore, setLoadingMore] = useState(false);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const loadingMoreRef = useRef(false);
    const scrollRestoredRef = useRef(false);

    useLayoutEffect(() => {
        if (scrollRestoredRef.current) return;
        const el = contentRef.current;
        const top = profileSnapshots.get(targetUser.chatId)?.scrollTop;
        if (!el || top == null) return;
        el.scrollTop = top;
        scrollRestoredRef.current = true;
    }, [targetUser.chatId]);

    const rememberScroll = () => {
        const snapshot = profileSnapshots.get(targetUser.chatId);
        if (!snapshot) return;
        snapshot.scrollTop = contentRef.current?.scrollTop ?? 0;
    };

    useEffect(() => {
        const cached = profileSnapshots.get(targetUser.chatId);
        if (cached && (cached.history.length > HISTORY_PAGE_SIZE || Date.now() - cached.updatedAt < PROFILE_FRESH_MS)) return;
        let cancelled = false;
        apiFetch(`/chess/games/history?userId=${encodeURIComponent(targetUser.chatId)}&skip=0&limit=${HISTORY_PAGE_SIZE}`)
            .then((res) => {
                if (cancelled) return;
                const games: ChessGameView[] = Array.isArray(res?.games) ? res.games : [];
                const nextHasMore = Boolean(res?.hasMore);
                seedChessGames(games);
                setHistory(games);
                setHasMore(nextHasMore);
                profileSnapshots.set(targetUser.chatId, {
                    history: games,
                    hasMore: nextHasMore,
                    scrollTop: profileSnapshots.get(targetUser.chatId)?.scrollTop ?? 0,
                    updatedAt: Date.now(),
                });
            })
            .catch(() => {
                if (cancelled) return;
                if (!profileSnapshots.has(targetUser.chatId)) {
                    setHistory([]);
                    setHasMore(false);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [targetUser.chatId]);

    const loadMore = useCallback(async () => {
        if (loadingMoreRef.current || !hasMore) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        try {
            const res = await apiFetch(
                `/chess/games/history?userId=${encodeURIComponent(targetUser.chatId)}&skip=${history.length}&limit=${HISTORY_PAGE_SIZE}`,
            );
            const nextGames: ChessGameView[] = Array.isArray(res?.games) ? res.games : [];
            const nextHasMore = Boolean(res?.hasMore);
            seedChessGames(nextGames);
            setHistory((prev) => {
                const seen = new Set(prev.map((g) => g.id));
                const merged = [...prev, ...nextGames.filter((g) => !seen.has(g.id))];
                profileSnapshots.set(targetUser.chatId, {
                    history: merged,
                    hasMore: nextHasMore,
                    scrollTop: profileSnapshots.get(targetUser.chatId)?.scrollTop ?? 0,
                    updatedAt: Date.now(),
                });
                return merged;
            });
            setHasMore(nextHasMore);
        } catch {
            setHasMore(false);
        } finally {
            loadingMoreRef.current = false;
            setLoadingMore(false);
        }
    }, [hasMore, history.length, targetUser.chatId]);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el || !hasMore) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    void loadMore();
                }
            },
            { rootMargin: '180px' },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, loadMore]);

    const outcomeForTarget = (g: ChessGameView) => {
        const userColor: ChessColor = g.players.black === targetUser.chatId ? 'black' : 'white';
        const winResult = userColor === 'white' ? '1-0' : '0-1';
        if (g.result === winResult) return { label: 'برد', cls: 'chess-history__badge--win' };
        if (g.result === '1/2-1/2') return { label: 'مساوی', cls: 'chess-history__badge--draw' };
        return { label: 'باخت', cls: 'chess-history__badge--loss' };
    };

    return (
        <motion.div
            className="profile chess-lobby"
            variants={screenVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            <div className="profile__header">
                <div className="profile__header-side">
                    <button
                        type="button"
                        className="profile__header-back back-icon-btn"
                        onClick={onBack}
                        aria-label="بازگشت"
                    >
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">پروفایل شطرنج</h1>
            </div>

            <div className="profile__content" ref={contentRef}>
                <div className="chess-lobby__inner">
                    <div className="chess-card chess-user-profile__card">
                        <div className="chess-user-profile__header">
                            <Avatar name={targetUser.name} size="lg" src={targetUser.avatar} />
                            <div className="chess-user-profile__identity">
                                <div className="chess-user-profile__name-row">
                                    <span className="chess-user-profile__name">{targetUser.name}</span>
                                    {targetUser.verified && <VerifiedBadge size={16} />}
                                    <span
                                        className={cx(
                                            'chess-leaderboard__rank',
                                            entry.rank <= 3 && `chess-leaderboard__rank--${entry.rank}`,
                                        )}
                                    >
                                        {toPersianDigits(entry.rank)}
                                    </span>
                                </div>
                                {targetUser.username && (
                                    <div className="chess-user-profile__username" dir="ltr">
                                        @{targetUser.username}
                                    </div>
                                )}
                            </div>
                            <span className="chess-leaderboard__elo">
                                {`امتیاز: ${toPersianDigits(entry.elo)}`}
                            </span>
                        </div>

                        <div className="chess-user-profile__stats">
                            <div className="chess-user-profile__stat">
                                <span className="chess-user-profile__stat-value chess-leaderboard__wld--win">
                                    {toPersianDigits(entry.wins)}
                                </span>
                                <span className="chess-user-profile__stat-label">برد</span>
                            </div>
                            <div className="chess-user-profile__stat">
                                <span className="chess-user-profile__stat-value">
                                    {toPersianDigits(entry.draws)}
                                </span>
                                <span className="chess-user-profile__stat-label">مساوی</span>
                            </div>
                            <div className="chess-user-profile__stat">
                                <span className="chess-user-profile__stat-value chess-leaderboard__wld--loss">
                                    {toPersianDigits(entry.losses)}
                                </span>
                                <span className="chess-user-profile__stat-label">باخت</span>
                            </div>
                        </div>

                        <button
                            type="button"
                            className="chess-primary-btn chess-secondary-btn--icon"
                            onClick={() => {
                                rememberScroll();
                                onOpenContactInfo();
                            }}
                        >
                            <UserRound size={17} />
                            <span>مشاهده پروفایل کاربر</span>
                        </button>
                    </div>

                    <div className="chess-card">
                        <div className="chess-section__label">سابقه بازی‌ها</div>
                        {loading ? (
                            <div className="chess-history__list">
                                <div className="skeleton" style={{ height: 54, width: '100%', borderRadius: 999 }} />
                                <div className="skeleton" style={{ height: 54, width: '100%', borderRadius: 999 }} />
                                <div className="skeleton" style={{ height: 54, width: '100%', borderRadius: 999 }} />
                            </div>
                        ) : history.length === 0 ? (
                            <div className="chess-history__empty">هنوز بازی‌ای ثبت نشده است</div>
                        ) : (
                            <div className="chess-history__list">
                                {history.map((g) => {
                                    const oppColor: ChessColor = g.players.black === targetUser.chatId ? 'white' : 'black';
                                    const oppId = g.players[oppColor];
                                    const oppInfo = (oppId && g.playerInfo?.[oppId]) || null;
                                    const outcome = outcomeForTarget(g);
                                    const reason = g.reason ? REASON_LABELS[g.reason] || '' : '';
                                    const userColor: ChessColor = oppColor === 'black' ? 'white' : 'black';
                                    const ratingChange = g.ratingChanges?.[userColor] ?? null;
                                    return (
                                        <div
                                            key={g.id}
                                            className="chess-history__item"
                                            onClick={() => {
                                                rememberScroll();
                                                onOpenGame(g.id);
                                            }}
                                        >
                                            <div className="chess-history__main">
                                                {oppInfo?.isGuest ? (
                                                    <span className="chess__player-placeholder">
                                                        <UserRound size={18} />
                                                    </span>
                                                ) : (
                                                    <Avatar
                                                        name={oppInfo?.name || 'حریف'}
                                                        size="sm"
                                                        src={oppInfo?.avatar}
                                                    />
                                                )}
                                                <div className="chess-history__meta">
                                                    <div className="chess-history__name">
                                                        {oppInfo?.name || 'حریف'}
                                                    </div>
                                                    <div className="chess-history__sub">
                                                        {formatTimeControl(g.timeControl)}
                                                        {reason ? ` • ${reason}` : ''}
                                                        {` • ${toPersianDigits(Math.ceil(g.ply / 2))} حرکت`}
                                                        {ratingChange && (
                                                            <span
                                                                className={cx(
                                                                    'chess-history__rating',
                                                                    ratingChange.delta > 0 && 'chess-history__rating--up',
                                                                    ratingChange.delta < 0 && 'chess-history__rating--down',
                                                                )}
                                                            >
                                                                {` • ${ratingChange.delta > 0 ? '+' : ratingChange.delta < 0 ? '−' : ''}${toPersianDigits(Math.abs(ratingChange.delta))}`}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="chess-history__actions">
                                                <span className={cx('chess-history__badge', outcome.cls)}>
                                                    {outcome.label}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                                {loadingMore && (
                                    <>
                                        <div className="skeleton" style={{ height: 54, width: '100%', borderRadius: 999 }} />
                                        <div className="skeleton" style={{ height: 54, width: '100%', borderRadius: 999 }} />
                                    </>
                                )}
                                {hasMore && <div ref={sentinelRef} style={{ height: 4 }} />}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
