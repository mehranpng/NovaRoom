export type AiDifficulty = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert';

export interface AiDifficultyConfig {
    label: string;
    skillLevel: number;
    depth: number;
    multiPv: number;
    minRankRatio: number;
    movetimeMs: number;
}

const envHashMb = Number(import.meta.env.VITE_CHESS_AI_HASH_MB);

export const AI_HASH_MB = Number.isFinite(envHashMb) && envHashMb >= 8
    ? Math.min(64, Math.round(envHashMb))
    : 16;

export const AI_DEFAULT_DIFFICULTY: AiDifficulty = 'easy';

export const AI_DIFFICULTY_ORDER: AiDifficulty[] = ['beginner', 'easy', 'medium', 'hard', 'expert'];

export const AI_DIFFICULTIES: Record<AiDifficulty, AiDifficultyConfig> = {
    beginner: { label: 'مبتدی', skillLevel: 0, depth: 1, multiPv: 20, minRankRatio: 0.5, movetimeMs: 350 },
    easy: { label: 'آسان', skillLevel: 2, depth: 1, multiPv: 10, minRankRatio: 0.3, movetimeMs: 450 },
    medium: { label: 'متوسط', skillLevel: 6, depth: 3, multiPv: 4, minRankRatio: 0, movetimeMs: 750 },
    hard: { label: 'سخت', skillLevel: 12, depth: 8, multiPv: 1, minRankRatio: 0, movetimeMs: 1400 },
    expert: { label: 'حرفه‌ای', skillLevel: 20, depth: 16, multiPv: 1, minRankRatio: 0, movetimeMs: 1900 },
};
