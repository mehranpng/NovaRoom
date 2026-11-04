// Hash size can be overridden at build time with VITE_CHESS_AI_HASH_MB (8-64).
export type AiDifficulty = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert';

export interface AiDifficultyConfig {
    label: string;
    skillLevel: number;
    movetimeMs: number;
}

const envHashMb = Number(import.meta.env.VITE_CHESS_AI_HASH_MB);

export const AI_HASH_MB = Number.isFinite(envHashMb) && envHashMb >= 8
    ? Math.min(64, Math.round(envHashMb))
    : 16;

export const AI_DEFAULT_DIFFICULTY: AiDifficulty = 'easy';

export const AI_DIFFICULTY_ORDER: AiDifficulty[] = ['beginner', 'easy', 'medium', 'hard', 'expert'];

export const AI_DIFFICULTIES: Record<AiDifficulty, AiDifficultyConfig> = {
    beginner: { label: 'مبتدی', skillLevel: 0, movetimeMs: 350 },
    easy: { label: 'آسان', skillLevel: 3, movetimeMs: 450 },
    medium: { label: 'متوسط', skillLevel: 8, movetimeMs: 750 },
    hard: { label: 'سخت', skillLevel: 14, movetimeMs: 1400 },
    expert: { label: 'حرفه‌ای', skillLevel: 20, movetimeMs: 1900 },
};
