import { useMemo, useRef, useState } from 'react';
import { ClipboardPaste, RotateCcw } from 'lucide-react';
import { isValidRecoveryWord, parseRecoveryPasteText, suggestRecoveryWords } from '../utils/e2ee';
import { toPersianDigits } from '../utils/format';
import { cx } from '../utils/cx';

interface RecoveryPhraseInputsProps {
    words: string[];
    onChange: (nextWords: string[]) => void;
    disabled?: boolean;
    compact?: boolean;
}

export function RecoveryPhraseInputs({ words, onChange, disabled = false, compact = false }: RecoveryPhraseInputsProps) {
    const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const [touched, setTouched] = useState<Record<number, boolean>>({});

    const activePrefix = focusedIndex !== null ? (words[focusedIndex] || '').trim().toLowerCase() : '';
    const suggestions = useMemo(() => {
        if (!activePrefix || isValidRecoveryWord(activePrefix)) return [];
        return suggestRecoveryWords(activePrefix, 4);
    }, [activePrefix]);

    const applyBulkWords = (raw: string, startIndex = 0) => {
        const parsed = parseRecoveryPasteText(raw);
        if (parsed.length <= 1) return false;
        const next = [...words];
        if (parsed.length >= 12) {
            for (let i = 0; i < 12; i += 1) {
                next[i] = parsed[i] || '';
            }
            onChange(next);
            setTouched({});
            inputRefs.current[11]?.focus();
            return true;
        }
        for (let offset = 0; offset < parsed.length && startIndex + offset < 12; offset += 1) {
            next[startIndex + offset] = parsed[offset];
        }
        onChange(next);
        const focusTarget = Math.min(11, startIndex + parsed.length);
        inputRefs.current[focusTarget]?.focus();
        return true;
    };

    const handleSlotChange = (index: number, rawValue: string) => {
        if (/\s/.test(rawValue)) {
            const parts = parseRecoveryPasteText(rawValue);
            if (parts.length > 1) {
                applyBulkWords(rawValue, index);
                return;
            }
            const trimmed = rawValue.trim().toLowerCase();
            const next = [...words];
            next[index] = trimmed;
            onChange(next);
            if (trimmed && index < 11) {
                inputRefs.current[index + 1]?.focus();
            }
            return;
        }
        const next = [...words];
        next[index] = rawValue.toLowerCase();
        onChange(next);
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === ' ' || e.key === 'Enter') {
            if ((words[index] || '').trim()) {
                e.preventDefault();
                if (suggestions.length > 0 && !isValidRecoveryWord(words[index])) {
                    const next = [...words];
                    next[index] = suggestions[0];
                    onChange(next);
                }
                if (index < 11) {
                    inputRefs.current[index + 1]?.focus();
                }
            }
        } else if (e.key === 'Backspace' && !words[index] && index > 0) {
            e.preventDefault();
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData('text');
        if (text && /\s/.test(text.trim())) {
            e.preventDefault();
            applyBulkWords(text, index);
        }
    };

    const handlePasteFromClipboard = async () => {
        if (disabled || !navigator.clipboard?.readText) return;
        try {
            const text = await navigator.clipboard.readText();
            if (text) applyBulkWords(text, 0);
        } catch {
            return;
        }
    };

    const handleClearAll = () => {
        if (disabled) return;
        onChange(Array(12).fill(''));
        setTouched({});
        inputRefs.current[0]?.focus();
    };

    const hasAnyWord = words.some((w) => w.trim().length > 0);
    const filledCount = words.filter((w) => isValidRecoveryWord(w)).length;

    return (
        <div className={cx('nr-recovery-inputs', compact && 'nr-recovery-inputs--compact')}>
            <div className="nr-recovery-inputs__bar">
                <span className="nr-recovery-inputs__count">
                    {toPersianDigits(filledCount)} از ۱۲ کلمه معتبر
                </span>
                <div className="nr-recovery-inputs__actions">
                    {typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText) && (
                        <button
                            type="button"
                            className="nr-recovery-chip-btn"
                            onClick={() => void handlePasteFromClipboard()}
                            disabled={disabled}
                        >
                            <ClipboardPaste size={14} />
                            <span>جای‌گذاری</span>
                        </button>
                    )}
                    {hasAnyWord && (
                        <button
                            type="button"
                            className="nr-recovery-chip-btn"
                            onClick={handleClearAll}
                            disabled={disabled}
                        >
                            <RotateCcw size={14} />
                            <span>پاک کردن</span>
                        </button>
                    )}
                </div>
            </div>

            <div className="nr-recovery-grid" dir="ltr">
                {words.map((word, index) => {
                    const trimmed = word.trim().toLowerCase();
                    const invalid = Boolean(touched[index] && trimmed && !isValidRecoveryWord(trimmed));
                    const valid = Boolean(trimmed && isValidRecoveryWord(trimmed));
                    return (
                        <label
                            key={index}
                            className={cx(
                                'nr-recovery-slot',
                                focusedIndex === index && 'nr-recovery-slot--focused',
                                invalid && 'nr-recovery-slot--invalid',
                                valid && 'nr-recovery-slot--valid',
                            )}
                        >
                            <span className="nr-recovery-slot__num">{index + 1}</span>
                            <input
                                ref={(el) => {
                                    inputRefs.current[index] = el;
                                }}
                                type="text"
                                className="nr-recovery-slot__input"
                                value={word}
                                disabled={disabled}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                dir="ltr"
                                placeholder="..."
                                aria-label={`کلمه ${index + 1}`}
                                onFocus={() => setFocusedIndex(index)}
                                onBlur={() => {
                                    setTouched((prev) => ({ ...prev, [index]: true }));
                                    setFocusedIndex((prev) => (prev === index ? null : prev));
                                }}
                                onChange={(e) => handleSlotChange(index, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(index, e)}
                                onPaste={(e) => handlePaste(index, e)}
                            />
                        </label>
                    );
                })}
            </div>

            {suggestions.length > 0 && focusedIndex !== null && (
                <div className="nr-recovery-suggestions" dir="ltr">
                    {suggestions.map((word) => (
                        <button
                            key={word}
                            type="button"
                            className="nr-recovery-suggestion"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                const next = [...words];
                                next[focusedIndex] = word;
                                onChange(next);
                                if (focusedIndex < 11) {
                                    inputRefs.current[focusedIndex + 1]?.focus();
                                } else {
                                    inputRefs.current[focusedIndex]?.blur();
                                }
                            }}
                        >
                            {word}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
