import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { screenVariants } from '../../utils/screenMotion';
import { AdminLinksSection } from './AdminLinksSection';
import './admin.css';

interface AdminLinksPageProps {
    onBack: () => void;
}

export function AdminLinksPage({ onBack }: AdminLinksPageProps) {
    return (
        <motion.div className="profile" variants={screenVariants} initial="hidden" animate="visible" exit="exit">
            <div className="profile__header">
                <div className="profile__header-side">
                    <button type="button" onClick={onBack} className="profile__header-back back-icon-btn adm-tap" aria-label="بازگشت">
                        <ChevronLeft size={22} />
                    </button>
                </div>
                <h1 className="profile__header-title">ساخت لینک ثبت‌ نام</h1>
            </div>
            <AdminLinksSection />
        </motion.div>
    );
}
