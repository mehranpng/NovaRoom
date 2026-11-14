import { AnimatePresence, motion } from 'framer-motion';
import { Download, Share, PlusSquare, MoreVertical, X } from 'lucide-react';
import { closePwaGuide, isIosDevice, usePwaInstall } from '../utils/pwaInstall';

export function PwaInstallModal() {
    const { guideOpen, isMobileWeb } = usePwaInstall();
    const isIos = isIosDevice();

    return (
        <AnimatePresence>
            {guideOpen && isMobileWeb && (
                <motion.div
                    className="chat-room-modal-overlay"
                    style={{ zIndex: 160 }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    onClick={closePwaGuide}
                >
                    <motion.div
                        className="pwa-guide"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="pwa-guide-title"
                        onClick={(e) => e.stopPropagation()}
                        initial={{ opacity: 0, y: 14, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <button
                            type="button"
                            className="pwa-guide__close"
                            onClick={closePwaGuide}
                            aria-label="بستن"
                        >
                            <X size={18} />
                        </button>

                        <div className="pwa-guide__header">
                            <img className="pwa-guide__logo" src="/logo/icon-192.png" alt="" />
                            <div className="pwa-guide__heading">
                                <h3 className="pwa-guide__title" id="pwa-guide-title">
                                    نصب اپلیکیشن نواروم
                                </h3>
                                <p className="pwa-guide__subtitle">
                                    برای دسترسی سریع‌تر و تجربه‌ای بهتر، نواروم را روی صفحه اصلی نصب کنید.
                                </p>
                            </div>
                        </div>

                        <div className="pwa-guide__steps">
                            {isIos ? (
                                <>
                                    <div className="pwa-guide__step">
                                        <span className="pwa-guide__step-number">۱</span>
                                        <span className="pwa-guide__step-text">
                                            در نوار پایین مرورگر روی دکمه <b>Share</b> بزنید.
                                        </span>
                                        <span className="pwa-guide__step-icon" aria-hidden="true">
                                            <Share size={17} />
                                        </span>
                                    </div>
                                    <div className="pwa-guide__step">
                                        <span className="pwa-guide__step-number">۲</span>
                                        <span className="pwa-guide__step-text">
                                            گزینه <b>Add to Home Screen</b> را انتخاب کرده و <b>Add</b> را بزنید.
                                        </span>
                                        <span className="pwa-guide__step-icon" aria-hidden="true">
                                            <PlusSquare size={17} />
                                        </span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="pwa-guide__step">
                                        <span className="pwa-guide__step-number">۱</span>
                                        <span className="pwa-guide__step-text">
                                            روی منوی سه نقطه مرورگر بزنید.
                                        </span>
                                        <span className="pwa-guide__step-icon" aria-hidden="true">
                                            <MoreVertical size={17} />
                                        </span>
                                    </div>
                                    <div className="pwa-guide__step">
                                        <span className="pwa-guide__step-number">۲</span>
                                        <span className="pwa-guide__step-text">
                                            گزینه <b>Install app</b> یا <b>Add to Home screen</b> و سپس <b>Install</b> را انتخاب کنید.
                                        </span>
                                        <span className="pwa-guide__step-icon" aria-hidden="true">
                                            <Download size={17} />
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>

                        <button
                            type="button"
                            className="pwa-guide__submit"
                            onClick={closePwaGuide}
                        >
                            متوجه شدم
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
