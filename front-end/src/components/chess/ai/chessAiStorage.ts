import type { AiDifficulty } from './difficulty';

export interface SavedAiLineEntry {
    fen: string;
    lastMove: { from: string; to: string } | null;
    san: string | null;
    playerMs: number;
    at: number;
}

export interface SavedAiGame {
    version: 2;
    difficulty: AiDifficulty;
    playerColor: 'white' | 'black';
    timeValue: string;
    line: SavedAiLineEntry[];
}

const STORAGE_KEY = 'novaroom_chess_ai_game_v1';

export function loadSavedAiGame(): SavedAiGame | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as SavedAiGame;
        if (parsed?.version !== 2 || !Array.isArray(parsed.line) || parsed.line.length < 2) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function saveAiGame(game: SavedAiGame): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
    } catch {
        void 0;
    }
}

export function clearSavedAiGame(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        void 0;
    }
}

export function hasSavedAiGame(): boolean {
    return loadSavedAiGame() !== null;
}
