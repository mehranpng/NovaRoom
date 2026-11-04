import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Copy, Pencil, Search, Users } from 'lucide-react';
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
};

type GroupMembersViewProps = {
    contact: User;
    currentUserId: string;
    isVerifiedUser: boolean;
    groupMembers: Record<string, GroupMember>;
    membersLoading: boolean;
    chatStats: { totalMembers: number; onlineMembers: number } | null;
    token: string;
    interactiveOnlineUsers?: Record<string, number>;
    onBack: () => void;
    onEditGroup: () => void;
    onOpenProfile: () => void;
    onViewMember: (memberId: string) => void;
};

export function GroupMembersView({
    contact,
    currentUserId,
    isVerifiedUser,
    groupMembers,
    membersLoading,
    chatStats,
    token,
    interactiveOnlineUsers,
    onBack,
    onEditGroup,
    onOpenProfile,
    onViewMember,
}: GroupMembersViewProps) {
    const [memberSearch, setMemberSearch] = useState('');
    const [openedGroupAvatar, setOpenedGroupAvatar] = useState<{ url: string; fileId: string; fileName: string } | null>(null);
    const navigate = useNavigate();
    const location = useLocation();

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

    const membersList = Object.values(groupMembers);
    const filtered = memberSearch.trim()
        ? membersList.filter(m => m.name.toLowerCase().includes(memberSearch.toLowerCase()) || m.username.toLowerCase().includes(memberSearch.toLowerCase()))
        : membersList;

    const isMemberOnline = (m: GroupMember) => Boolean((interactiveOnlineUsers && m.chatId && interactiveOnlineUsers[m.chatId]) || m.online);

    const sortedFiltered = [...filtered].sort((a, b) => {
        if (a.chatId === currentUserId && b.chatId !== currentUserId) return -1;
        if (a.chatId !== currentUserId && b.chatId === currentUserId) return 1;
        const aOnline = isMemberOnline(a);
        const bOnline = isMemberOnline(b);
        if (aOnline && !bOnline) return -1;
        if (!aOnline && bOnline) return 1;
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
                {isVerifiedUser && (
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label="Edit group"
                        title="ویرایش گروه"
                        onClick={onEditGroup}
                    >
                        <Pencil size={18} />
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

                <div className="contact-info__card" style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Search size={15} style={{ opacity: 0.5, flexShrink: 0 }} />
                        <input type="text" placeholder="جستجو در اعضا..." value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 14, color: 'var(--text-primary)', fontFamily: 'Vazir, sans-serif', direction: 'rtl' }} />
                    </div>
                </div>
                <div className="contact-info__members-title">اعضا ({toPersianDigits(membersList.length)})</div>
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
                        sortedFiltered.map((member, idx) => (
                            <div key={member.chatId}
                                onClick={() => {
                                    if (member.chatId === currentUserId) onOpenProfile();
                                    else onViewMember(member.chatId);
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
                            </div>
                        ))
                    )}
                </div>
            </div>
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
