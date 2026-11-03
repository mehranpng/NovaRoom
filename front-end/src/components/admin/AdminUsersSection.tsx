import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Search, Users, X } from 'lucide-react';
import type { MutableRefObject } from 'react';
import { apiFetch } from '../../config/api';
import { screenVariants } from '../../utils/screenMotion';
import { cx } from '../../utils/cx';
import { useScrollFade } from '../../hooks/useScrollFade';
import { notify } from '../../utils/notificationBus';
import { Avatar } from '../Avatar';
import { VerifiedBadge } from '../VerifiedBadge';
import { AdminUserDetail } from './AdminUserDetail';
import type { AdminUserItem } from './adminTypes';
import './admin.css';

const userFilters = [
    { id: 'all', label: 'همه' },
    { id: 'verified', label: 'تایید شده' },
    { id: 'unverified', label: 'تایید نشده' },
    { id: 'admins', label: 'ادمین‌ها' },
    { id: 'admin1', label: 'ادمین ۱' },
    { id: 'regular', label: 'کاربران عادی' },
    { id: 'online', label: 'آنلاین' },
];

interface AdminUsersSectionProps {
    backRef: MutableRefObject<() => boolean>;
}

export function AdminUsersSection({ backRef }: AdminUsersSectionProps) {
    const { scrolled, handleScroll } = useScrollFade();
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [items, setItems] = useState<AdminUserItem[]>([]);
    const [total, setTotal] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef(false);
    const requestIdRef = useRef(0);
    const nextCursorRef = useRef<string | null>(null);
    const hasMoreRef = useRef(false);
    const queryRef = useRef('');
    const filterRef = useRef('all');

    const loadUsers = useCallback(async (reset: boolean) => {
        const requestId = reset ? requestIdRef.current + 1 : requestIdRef.current;
        if (reset) {
            requestIdRef.current = requestId;
            loadingRef.current = false;
        } else if (loadingRef.current) {
            return;
        }
        loadingRef.current = true;
        setLoading(true);

        const params = new URLSearchParams();
        params.set('limit', '20');
        params.set('filter', filterRef.current);
        if (queryRef.current) params.set('q', queryRef.current);
        if (!reset && nextCursorRef.current) params.set('cursor', nextCursorRef.current);

        try {
            const data = await apiFetch(`/admin/users?${params.toString()}`);
            if (requestId !== requestIdRef.current) return;
            const nextItems = Array.isArray(data?.items) ? data.items : [];
            setItems((prev) => (reset ? nextItems : [...prev, ...nextItems]));
            nextCursorRef.current = data?.nextCursor ?? null;
            hasMoreRef.current = Boolean(data?.hasMore);
            if (reset) setTotal(typeof data?.total === 'number' ? data.total : null);
        } catch {
            if (requestId === requestIdRef.current && reset) {
                notify({ type: 'error', message: 'دریافت لیست کاربران ممکن نشد' });
            }
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
                loadingRef.current = false;
            }
        }
    }, []);

    useEffect(() => {
        queryRef.current = query;
        filterRef.current = filter;
        const timer = window.setTimeout(() => {
            void loadUsers(true);
        }, 350);
        return () => window.clearTimeout(timer);
    }, [query, filter, loadUsers]);

    useEffect(() => {
        const root = scrollRef.current;
        const sentinel = sentinelRef.current;
        if (!root || !sentinel) return;
        const observer = new IntersectionObserver((entries) => {
            if (!entries[0]?.isIntersecting) return;
            if (!hasMoreRef.current || loadingRef.current || selectedChatId) return;
            void loadUsers(false);
        }, { root, rootMargin: '200px' });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [loadUsers, selectedChatId]);

    useEffect(() => {
        backRef.current = () => {
            if (!selectedChatId) return false;
            setSelectedChatId(null);
            return true;
        };
    }, [backRef, selectedChatId]);

    useEffect(() => () => {
        backRef.current = () => false;
    }, [backRef]);

    const updateItem = useCallback((chatId: string, patch: Partial<AdminUserItem>) => {
        setItems((prev) => prev.map((item) => (item.chatId === chatId ? { ...item, ...patch } : item)));
    }, []);

    return (
        <>
            <div className={cx('header-fade', 'header-fade--screen', scrolled && 'header-fade--visible')} aria-hidden="true" />

            <div
                ref={scrollRef}
                className={cx('adm-content', selectedChatId && 'adm-content--hidden')}
                onScroll={handleScroll}
            >
                <div className="adm-search">
                    <Search size={18} className="adm-search__icon" />
                    <input
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="جستجو با آیدی چت یا نام کاربری"
                        dir="rtl"
                        aria-label="جستجوی کاربر"
                    />
                    {query && (
                        <button
                            type="button"
                            className="adm-search__clear adm-tap"
                            onClick={() => setQuery('')}
                            aria-label="پاک کردن جستجو"
                        >
                            <X size={18} />
                        </button>
                    )}
                </div>

                <div className="adm-chips">
                    {userFilters.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            className={cx('adm-chip', 'adm-tap', filter === option.id && 'adm-chip--active')}
                            onClick={() => setFilter(option.id)}
                            aria-pressed={filter === option.id}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                {total !== null && <div className="adm-count">{total} کاربر</div>}

                {items.map((item) => (
                    <button
                        key={item.chatId}
                        type="button"
                        className="adm-row adm-tap"
                        onClick={() => setSelectedChatId(item.chatId)}
                    >
                        <Avatar name={item.name || item.username} src={item.avatar} size="sm" />
                        <span className="adm-row__text">
                            <span className="adm-row__name">
                                <span>{item.name || item.username}</span>
                                {item.verified && <VerifiedBadge size={14} />}
                            </span>
                            <span className="adm-row__username">@{item.username}</span>
                        </span>
                        {item.adminLevel === 'admin0' && <span className="adm-badge">ادمین ۰</span>}
                        {item.adminLevel === 'admin1' && <span className="adm-badge">ادمین ۱</span>}
                        <ChevronLeft size={18} className="adm-row__chevron" />
                    </button>
                ))}

                {loading && items.length === 0 && (
                    <>
                        {[1, 2, 3, 4].map((index) => (
                            <div key={index} className="adm-skeleton adm-skeleton--row" />
                        ))}
                    </>
                )}

                {!loading && items.length === 0 && (
                    <div className="adm-empty">
                        <Users size={28} />
                        <span>کاربری پیدا نشد</span>
                    </div>
                )}

                <div ref={sentinelRef} className="adm-sentinel" />
            </div>

            {selectedChatId && (
                <motion.div
                    key={selectedChatId}
                    variants={screenVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="adm-section"
                >
                    <AdminUserDetail chatId={selectedChatId} onUpdated={updateItem} />
                </motion.div>
            )}
        </>
    );
}
