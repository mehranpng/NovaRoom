import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, ChevronLeft, Copy, Search, Settings, Users } from 'lucide-react';
import type { User } from '../types';
import { Avatar, extractFileIdFromAvatar, getAvatarDisplayUrl } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { ImageMediaViewer } from './ImageMediaViewer';
import { screenVariants } from '../utils/screenMotion';
import { formatLastSeen, resolveVerified, toPersianDigits } from '../utils/format';
import { copyText } from '../utils/clipboard';

export type GroupMember = {
    name: string;
    username: string;
    avatar: string;
    bio: string;
    chatId: string;
    verified?: boolean;
    online?: boolean;
    lastSeen?: number | string | null;
    lastSeenCategory?: 'recently' | 'within_week' | 'within_month' | 'long_time_ago' | null;
    isMember?: boolean;
    isBanned?: boolean;
};

type GroupMembersViewProps = {
    contact: User;
    currentUserId: string;
    canManageGroup: boolean;
    groupMembers: Record<string, GroupMember>;
    membersLoading: boolean;
    chatStats: { totalMembers: number; onlineMembers: number } | null;
    token: string;
    interactiveOnlineUsers?: Record<string, number>;
    onBack: () => void;
    onEditGroup: () => void;
    onOpenProfile: () => void;
    onViewMember: (memberId: string) => void;
    onBanMember?: (targetChatId: string) => Promise<void> | void;
};

export function GroupMembersView({
    contact,
    currentUserId,
    canManageGroup,
    groupMembers,
    membersLoading,
    chatStats,
    token,
    interactiveOnlineUsers,
    onBack,
    onEditGroup,
    onOpenProfile,
    onViewMember,
    onBanMember,
}: GroupMembersViewProps) {
    const [memberSearch, setMemberSearch] = useState('');
    const [openedGroupAvatar, setOpenedGroupAvatar] = useState<{ url: string; fileId: string; fileName: string } | null>(null);
    const [menuState, setMenuState] = useState<{ member: GroupMember; x: number; y: number } | null>(null);
    const [pendingRemoveMember, setPendingRemoveMember] = useState<GroupMember | null>(null);
    const [removingMember, setRemovingMember] = useState(false);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => () => {
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    }, []);

    const isAvatarRoute = new URLSearchParams(location.search).get('avatar') === '1';

    const openGroupAvatarViewer = async () => {
        const rawAvatar = String(contact.avatar || '').trim();
        if (!rawAvatar || !token) return;
        try {
            const avatarUrl = await getAvatarDisplayUrl(rawAvatar);
            if (!avatarUrl) return;
            setOpenedGroupAvatar({
                url: avatarUrl,
                fileId: extractFileIdFromAvatar(rawAvatar),
                fileName: `${contact.name || 'group'}.jpg`,
            });
            const params = new URLSearchParams(location.search);
            params.set('avatar', '1');
            navigate({ pathname: location.pathname, search: `?${params.toString()}` });
        } catch (error) {
            console.error(error);
            alert('نمایش تصویر گروه ممکن نبود');
        }
    };

    const closeGroupAvatarViewer = () => {
        const params = new URLSearchParams(location.search);
        if (params.has('avatar')) {
            navigate(-1);
            return;
        }
        setOpenedGroupAvatar(null);
    };

    const membersList = Object.values(groupMembers).filter((m) => m.isMember !== false);
    const filtered = memberSearch.trim()
        ? membersList.filter(m => m.name.toLowerCase().includes(memberSearch.toLowerCase()) || m.username.toLowerCase().includes(memberSearch.toLowerCase()))
        : membersList;

    const isMemberOnline = (m: GroupMember) => Boolean((interactiveOnlineUsers && m.chatId && interactiveOnlineUsers[m.chatId]) || m.online);

    const lastSeenValue = (m: GroupMember): number => {
        if (typeof m.lastSeen === 'number') return m.lastSeen;
        if (typeof m.lastSeen === 'string') {
            const parsed = Date.parse(m.lastSeen);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        return 0;
    };

    const memberRank = (m: GroupMember): number => {
        if (isMemberOnline(m)) return 0;
        if (m.lastSeen != null) return 1;
        if (m.lastSeenCategory === 'recently') return 2;
        if (m.lastSeenCategory) return 3;
        return 4;
    };

    const sortedFiltered = [...filtered].sort((a, b) => {
        if (a.chatId === currentUserId) return -1;
        if (b.chatId === currentUserId) return 1;
        const rankDiff = memberRank(a) - memberRank(b);
        if (rankDiff !== 0) return rankDiff;
        if (memberRank(a) === 1) return lastSeenValue(b) - lastSeenValue(a);
        return 0;
    });
    const onlineCount = membersList.filter(isMemberOnline).length;
    const isInviteLink = (s: string) => s.startsWith('novaroom://') || s.startsWith('senoroom://');
    const inviteLink = contact.username && isInviteLink(contact.username) ? contact.username : null;

    return (
        <motion.div
            className="contact-info"
            variants={screenVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
        >
            <div className="contact-info__header contact-info__header--centered">
                <button className="contact-info__back back-icon-btn" onClick={onBack} type="button"><ChevronLeft size={22} /></button>
                <div className="contact-info__title">اطلاعات گروه</div>
                <div className="contact-info__spacer" />
                {canManageGroup && (
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label="تنظیمات گروه"
                        title="تنظیمات گروه"
                        onClick={onEditGroup}
                    >
                        <Settings size={19} />
                    </button>
                )}
            </div>

            <div className="contact-info__content">
                <div className="contact-info__avatar">
                    <button
                        type="button"
                        onClick={openGroupAvatarViewer}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: contact.avatar ? 'zoom-in' : 'default' }}
                        aria-label="Open group avatar"
                    >
                        <Avatar name={contact.name} size="xl" src={contact.avatar} />
                    </button>
                    <div className="contact-info__name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{contact.name}</div>
                    <div className="contact-info__status" style={{ direction: 'rtl' }}>
                        <span className="status-online-text">{toPersianDigits(Math.max(onlineCount, Number(chatStats?.onlineMembers || 0)))} آنلاین</span>
                        <span style={{ color: 'var(--text-muted)' }}> • </span>
                        <span style={{ color: 'var(--text-secondary)' }}>{toPersianDigits(membersList.length)} عضو</span>
                    </div>
                </div>

                {inviteLink && (
                    <div className="contact-info__card">
                        <div className="contact-info__label">لینک دعوت</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div className="contact-info__mono" style={{ fontSize: 13, wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Users size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
                                {inviteLink}
                            </div>
                            <button type="button" className="icon-btn" style={{ flexShrink: 0 }} onClick={() => void copyText(inviteLink).catch(() => { })}>
                                <Copy size={18} />
                            </button>
                        </div>
                    </div>
                )}

                <div className="contact-info__card" style={{ padding: '8px 12px', position: 'relative' }}>
                    <Search size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, pointerEvents: 'none' }} />
                    <input type="text" placeholder="جستجو در اعضا..." value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', border: 'none', background: 'transparent', outline: 'none', paddingRight: 26, fontSize: 14, color: 'var(--text-primary)', fontFamily: 'Vazir, sans-serif', direction: 'rtl' }} />
                </div>
                <div className="contact-info__members-title" style={{ textAlign: 'right' }}>اعضا</div>
                <div className="contact-info__card" style={{ padding: 0, overflow: 'hidden' }}>
                    {membersLoading && membersList.length === 0 ? (
                        Array.from({ length: 6 }).map((_, idx) => (
                            <div key={`members-loading-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: idx > 0 ? '1px solid var(--border-primary)' : 'none' }}>
                                <span className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                                <div style={{ flex: 1 }}>
                                    <div className="skeleton" style={{ height: 12, width: idx % 2 === 0 ? '52%' : '64%', borderRadius: 6, marginBottom: 8 }} />
                                    <div className="skeleton" style={{ height: 10, width: idx % 2 === 0 ? '30%' : '38%', borderRadius: 6 }} />
                                </div>
                            </div>
                        ))
                    ) : sortedFiltered.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)', fontSize: 14 }}>عضوی یافت نشد</div>
                    ) : (
                        sortedFiltered.map((member, idx) => {
                            const canBanThisMember = Boolean(
                                canManageGroup
                                && onBanMember
                                && member.chatId
                                && member.chatId !== currentUserId
                                && member.chatId !== contact.createdBy
                            );

                            const openMemberMenu = (x: number, y: number) => {
                                setMenuState({ member, x, y });
                            };

                            return (
                                <div key={member.chatId}
                                    onClick={() => {
                                        if (longPressTriggeredRef.current) {
                                            longPressTriggeredRef.current = false;
                                            return;
                                        }
                                        if (member.chatId === currentUserId) onOpenProfile();
                                        else onViewMember(member.chatId);
                                    }}
                                    onContextMenu={(e) => {
                                        if (!canBanThisMember) return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openMemberMenu(e.clientX, e.clientY);
                                    }}
                                    onTouchStart={(e) => {
                                        if (!canBanThisMember) return;
                                        longPressTriggeredRef.current = false;
                                        const touch = e.touches[0];
                                        if (!touch) return;
                                        const { clientX, clientY } = touch;
                                        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
                                        longPressTimerRef.current = window.setTimeout(() => {
                                            longPressTimerRef.current = null;
                                            longPressTriggeredRef.current = true;
                                            if (navigator.vibrate) navigator.vibrate(18);
                                            openMemberMenu(clientX, clientY);
                                            window.setTimeout(() => {
                                                longPressTriggeredRef.current = false;
                                            }, 700);
                                        }, 450);
                                    }}
                                    onTouchMove={() => {
                                        if (!longPressTimerRef.current) return;
                                        window.clearTimeout(longPressTimerRef.current);
                                        longPressTimerRef.current = null;
                                    }}
                                    onTouchEnd={() => {
                                        if (!longPressTimerRef.current) return;
                                        window.clearTimeout(longPressTimerRef.current);
                                        longPressTimerRef.current = null;
                                    }}
                                    onTouchCancel={() => {
                                        if (!longPressTimerRef.current) return;
                                        window.clearTimeout(longPressTimerRef.current);
                                        longPressTimerRef.current = null;
                                    }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer', borderTop: idx > 0 ? '1px solid var(--border-primary)' : 'none', transition: 'background 0.15s' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                    <Avatar name={member.name} size="md" src={member.avatar} online={isMemberOnline(member)} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                                            {member.name}
                                            {resolveVerified(member.verified) && <VerifiedBadge size={14} />}
                                        </div>
                                        <div style={{ fontSize: 13, marginTop: 2 }}>
                                            {isMemberOnline(member) ? (
                                                <span className="status-online-text">آنلاین</span>
                                            ) : (
                                                <span style={{ color: 'var(--text-secondary)' }}>
                                                    {formatLastSeen(member, { isInteractiveOnline: isMemberOnline(member) })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {contact.createdBy && member.chatId === contact.createdBy && (
                                        <span className="contact-info__owner-badge">مالک</span>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
            {menuState && createPortal(
                <div
                    className="fixed inset-0"
                    style={{ position: 'fixed', inset: 0, zIndex: 220 }}
                    onPointerDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        setMenuState(null);
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                    }}
                >
                    <div
                        className="popover popover--mini"
                        dir="rtl"
                        style={{
                            position: 'fixed',
                            top: Math.min(menuState.y, window.innerHeight - 72),
                            left: Math.min(Math.max(12, menuState.x - 90), window.innerWidth - 240),
                            right: 'auto',
                            zIndex: 221,
                            minWidth: 210,
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="popover__item popover__item--danger"
                            onClick={(e) => {
                                e.stopPropagation();
                                const member = menuState.member;
                                setMenuState(null);
                                if (member.chatId) setPendingRemoveMember(member);
                            }}
                        >
                            <Ban size={16} />
                            حذف و مسدودسازی از گروه
                        </button>
                    </div>
                </div>,
                document.body,
            )}

            <AnimatePresence>
                {pendingRemoveMember && (
                    <motion.div
                        className="chat-room-modal-overlay"
                        style={{ zIndex: 230 }}
                        onClick={() => {
                            if (removingMember) return;
                            setPendingRemoveMember(null);
                        }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                    >
                        <motion.div
                            className="chat-room-confirm-modal"
                            role="dialog"
                            aria-modal="true"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, y: 12, scale: 0.985 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.985 }}
                            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <h3 className="chat-room-confirm-modal__title">حذف از گروه؟</h3>
                            <p className="chat-room-confirm-modal__text">
                                {`«${pendingRemoveMember.name || 'این کاربر'}» از گروه حذف و مسدود شود؟`}
                            </p>
                            <div className="chat-room-confirm-modal__actions">
                                <button
                                    className="chat-room-confirm-modal__btn"
                                    type="button"
                                    disabled={removingMember}
                                    onClick={() => setPendingRemoveMember(null)}
                                >
                                    انصراف
                                </button>
                                <button
                                    className="chat-room-confirm-modal__btn chat-room-confirm-modal__btn--danger"
                                    type="button"
                                    disabled={removingMember}
                                    onClick={async () => {
                                        const targetId = pendingRemoveMember.chatId;
                                        if (!targetId || !onBanMember) return;
                                        setRemovingMember(true);
                                        try {
                                            await onBanMember(targetId);
                                            setPendingRemoveMember(null);
                                        } finally {
                                            setRemovingMember(false);
                                        }
                                    }}
                                >
                                    {removingMember ? 'در حال حذف...' : 'حذف'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {openedGroupAvatar && isAvatarRoute && (
                <ImageMediaViewer
                    imageUrl={openedGroupAvatar.url}
                    token={token}
                    downloadFile={{ fileId: openedGroupAvatar.fileId, fileName: openedGroupAvatar.fileName }}
                    onClose={closeGroupAvatarViewer}
                />
            )}
        </motion.div>
    );
}
