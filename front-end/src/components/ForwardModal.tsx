import { useMemo, useState } from 'react';
import { Search, ChevronRight, Bookmark } from 'lucide-react';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import type { Chat } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';

interface ForwardModalProps {
    isOpen: boolean;
    chats: Chat[];
    currentUserId: string;
    currentUserVerified?: boolean;
    forwardCount?: number;
    title?: string;
    hideSavedMessages?: boolean;
    onClose: () => void;
    onForward?: (chatId: string) => void;
    onSelectTargetChat?: (chatId: string) => void;
    onSelectChat?: (chatId: string) => void;
}

const toPersianDigits = (num: number | string) =>
    String(num).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[parseInt(d, 10)]);

export function ForwardModal({ isOpen, chats, currentUserId, currentUserVerified = false, forwardCount, title, hideSavedMessages = false, onClose, onForward, onSelectTargetChat, onSelectChat }: ForwardModalProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const dragControls = useDragControls();

    const handlePickChat = (chatId: string) => {
        if (onSelectTargetChat) {
            onSelectTargetChat(chatId);
            onClose();
            return;
        }
        onForward?.(chatId);
        if (onSelectChat) onSelectChat(chatId);
        onClose();
    };

    const savedMessagesChat = {
        id: `saved_messages_${currentUserId}`,
        name: 'پیام‌های ذخیره شده',
        username: 'saved',
        online: false,
        verified: false,
    };

    const sortedChats = useMemo(() => {
        return [...chats].sort((a, b) => {
            const aTime = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
            const bTime = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
            return bTime - aTime;
        });
    }, [chats]);

    const availableChats = sortedChats.filter((chat) => {
        if (chat.id.startsWith('saved_messages_')) return false;
        if (chat.id === 'official-channel' && !currentUserVerified) return false;
        if (!chat.otherUser) return false;
        if (chat.id === 'official-channel') return true;
        if (!chat.lastMessage) return false;
        return true;
    });

    const normalizedQuery = searchQuery.toLowerCase();
    const filteredChats = searchQuery
        ? availableChats.filter((chat) =>
            chat.otherUser?.name?.toLowerCase().includes(normalizedQuery) ||
            chat.otherUser?.username?.toLowerCase().includes(normalizedQuery)
        )
        : availableChats;

    const showSavedMessages = !searchQuery && !hideSavedMessages;
    const isGroupChat = (chat: Chat) =>
        chat.chatType === 'group' || chat.id.startsWith('grp_') || Boolean(chat.otherUser?.isGroup);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="forward-sheet-overlay"
                    onClick={onClose}
                    initial={false}
                    exit={{ opacity: 1 }}
                    transition={{ duration: 0.28 }}
                >
                    <motion.div
                        className="forward-sheet"
                        role="dialog"
                        aria-modal="true"
                        aria-label="فوروارد پیام"
                        onClick={(e) => e.stopPropagation()}
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        drag="y"
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.7 }}
                        onDragEnd={(_, info) => {
                            if (info.offset.y > 90 || info.velocity.y > 600) onClose();
                        }}
                    >
                        <div
                            className="forward-sheet__drag-area"
                            onPointerDown={(e) => dragControls.start(e)}
                        >
                            <div className="forward-sheet__grabber" aria-hidden="true" />

                            <div className="forward-sheet__header">
                                <h2>{title ?? (forwardCount && forwardCount > 1 ? `فوروارد ${toPersianDigits(forwardCount)} پیام` : 'فوروارد پیام')}</h2>
                            </div>
                        </div>

                        <div className="forward-sheet__search">
                            <Search size={17} />
                            <input
                                type="text"
                                placeholder="جستجو در گفتگو‌ها..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <div className="forward-sheet__results">
                            {showSavedMessages && (
                                <button
                                    className="forward-sheet__item"
                                    onClick={() => handlePickChat(savedMessagesChat.id)}
                                    type="button"
                                >
                                    <Avatar name="" size="md" online={false} savedMessages />
                                    <div className="forward-sheet__item-info">
                                        <div className="forward-sheet__item-name">{savedMessagesChat.name}</div>
                                    </div>
                                    <Bookmark size={17} className="forward-sheet__item-icon" />
                                </button>
                            )}

                            {filteredChats.length === 0 && !showSavedMessages ? (
                                <div className="forward-sheet__empty">
                                    {searchQuery ? 'گفتگویی یافت نشد' : 'گفتگوی فعالی وجود ندارد'}
                                </div>
                            ) : (
                                filteredChats.map((chat) => {
                                    const user = chat.otherUser;
                                    if (!user) return null;

                                    return (
                                        <button
                                            key={chat.id}
                                            className="forward-sheet__item"
                                            onClick={() => handlePickChat(chat.id)}
                                            type="button"
                                        >
                                            <Avatar
                                                name={user.name || user.username}
                                                size="md"
                                                online={user.online}
                                                src={chat.id === 'official-channel' ? '/logo/ch.png' : user.avatar}
                                            />
                                            <div className="forward-sheet__item-info">
                                                <div className="forward-sheet__item-name">
                                                    <span>{user.name}</span>
                                                    {user.verified && <VerifiedBadge size={14} />}
                                                </div>
                                                <div className="forward-sheet__item-username">{isGroupChat(chat) ? user.username : `@${user.username}`}</div>
                                            </div>
                                            <ChevronRight size={17} className="forward-sheet__item-icon" />
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
