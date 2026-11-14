import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { Loader2, Users } from 'lucide-react';
import type { GroupPreview } from '../types';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { toPersianDigits } from '../utils/format';

interface GroupJoinSheetProps {
    open: boolean;
    group: GroupPreview | null;
    joining?: boolean;
    error?: string;
    onClose: () => void;
    onConfirmJoin: (group: GroupPreview) => void;
}

export function GroupJoinSheet({ open, group, joining = false, error = '', onClose, onConfirmJoin }: GroupJoinSheetProps) {
    const [mounted] = useState(() => typeof document !== 'undefined');
    const dragControls = useDragControls();

    if (!mounted) return null;

    return createPortal(
        <AnimatePresence>
            {open && group && (
                <motion.div
                    className="forward-sheet-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    onClick={() => {
                        if (!joining) onClose();
                    }}
                >
                    <motion.div
                        className="forward-sheet group-join-sheet"
                        role="dialog"
                        aria-modal="true"
                        aria-label="عضویت در گروه"
                        dir="rtl"
                        initial={{ y: '110%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '110%' }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                        onClick={(e) => e.stopPropagation()}
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
                                <h2>عضویت در گروه</h2>
                            </div>
                        </div>

                        <div className="group-join-sheet__body">
                            <Avatar name={group.name} size="lg" src={group.avatar} />

                            <div className="group-join-sheet__name">
                                <span>{group.name}</span>
                                {group.verified && <VerifiedBadge size={16} />}
                            </div>

                            <div className="group-join-sheet__meta">
                                <Users size={15} />
                                <span>{toPersianDigits(group.totalMembers)} عضو</span>
                            </div>

                            {error && <div className="group-join-sheet__error">{error}</div>}

                            <button
                                type="button"
                                className="group-join-sheet__btn"
                                disabled={joining}
                                onClick={() => onConfirmJoin(group)}
                            >
                                {joining ? (
                                    <>
                                        <Loader2 size={17} className="animate-spin" />
                                        <span>در حال عضویت...</span>
                                    </>
                                ) : (
                                    <span>{group.alreadyMember ? 'ورود به گروه' : 'عضویت در گروه'}</span>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
