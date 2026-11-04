export type EngineStatus = 'idle' | 'starting' | 'ready' | 'searching' | 'error' | 'closed';

export type EngineStatusListener = (status: EngineStatus, error: string | null) => void;

export interface SearchMetrics {
    depth: number;
    seldepth: number;
    nodes: number;
    nps: number;
    timeMs: number;
    scoreCp: number | null;
    mateIn: number | null;
}

export interface SearchResult {
    bestmove: string | null;
    metrics: SearchMetrics;
    elapsedMs: number;
}

export interface EngineSnapshot {
    status: EngineStatus;
    initMs: number | null;
    hashMb: number;
    error: string | null;
    search: (SearchMetrics & { elapsedMs: number; movetimeMs: number }) | null;
}

interface SearchRequest {
    fen: string;
    movetimeMs: number;
    skillLevel: number;
}

interface PendingSearch {
    request: SearchRequest;
    resolve: (result: SearchResult | null) => void;
    reject: (error: Error) => void;
}

interface ActiveSearch extends PendingSearch {
    startedAt: number;
    cancelled: boolean;
    metrics: SearchMetrics;
    timer: number;
}

const emptyMetrics = (): SearchMetrics => ({
    depth: 0,
    seldepth: 0,
    nodes: 0,
    nps: 0,
    timeMs: 0,
    scoreCp: null,
    mateIn: null,
});

const readNumber = (line: string, label: string): number | null => {
    const match = new RegExp(`(?:^| )${label} (\\d+)`).exec(line);
    return match ? Number(match[1]) : null;
};

export class StockfishEngine {
    private worker: Worker | null = null;
    private status: EngineStatus = 'idle';
    private initMs: number | null = null;
    private hashMb = 16;
    private error: string | null = null;
    private initPromise: Promise<void> | null = null;
    private initTimer: number | null = null;
    private waitingReady = false;
    private active: ActiveSearch | null = null;
    private pending: PendingSearch | null = null;
    private listener: EngineStatusListener | null;

    constructor(worker: Worker, onStatus?: EngineStatusListener) {
        this.worker = worker;
        this.listener = onStatus ?? null;
    }

    init(hashMb: number): Promise<void> {
        if (this.status === 'ready' || this.status === 'searching') return Promise.resolve();
        if (this.initPromise) return this.initPromise;

        this.hashMb = hashMb;
        this.error = null;
        this.setStatus('starting');

        const startedAt = performance.now();
        this.initPromise = new Promise<void>((resolve, reject) => {
            let settled = false;
            const worker = this.worker;
            if (!worker) {
                this.fail('worker_create_failed');
                reject(new Error('worker_create_failed'));
                return;
            }

            const fail = (message: string) => {
                const wasInitializing = !settled;
                settled = true;
                worker.terminate();
                if (this.worker === worker) this.worker = null;
                this.fail(message);
                if (wasInitializing) reject(new Error(message));
            };

            worker.onerror = (event) => {
                fail(event.message ? `worker_error:${event.message}` : 'worker_error');
            };
            worker.onmessageerror = () => fail('worker_message_error');
            worker.onmessage = (event) => {
                const line = typeof event.data === 'string' ? event.data : '';
                if (!line) return;

                if (!settled) {
                    if (line === 'uciok') {
                        worker.postMessage(`setoption name Hash value ${hashMb}`);
                        worker.postMessage('setoption name Threads value 1');
                        worker.postMessage('isready');
                    } else if (line === 'readyok') {
                        settled = true;
                        this.clearInitTimer();
                        this.initMs = performance.now() - startedAt;
                        this.setStatus('ready');
                        resolve();
                    }
                    return;
                }

                this.handleLine(line);
            };

            this.initTimer = window.setTimeout(() => fail('engine_init_timeout'), 20000);
            worker.postMessage('uci');
        });

        return this.initPromise;
    }

    search(request: SearchRequest): Promise<SearchResult | null> {
        if (
            !this.worker ||
            this.status === 'idle' ||
            this.status === 'starting' ||
            this.status === 'error' ||
            this.status === 'closed'
        ) {
            return Promise.reject(new Error('engine_not_ready'));
        }

        return new Promise<SearchResult | null>((resolve, reject) => {
            if (this.active) {
                if (this.pending) this.pending.resolve(null);
                this.pending = { request, resolve, reject };
                this.stopActive();
                return;
            }

            if (this.waitingReady) {
                if (this.pending) this.pending.resolve(null);
                this.pending = { request, resolve, reject };
                return;
            }

            this.start(request, resolve, reject);
        });
    }

    stop(): void {
        if (this.pending) {
            this.pending.resolve(null);
            this.pending = null;
        }
        this.stopActive();
    }

    newGame(): void {
        const worker = this.worker;
        if (!worker) return;
        if (this.pending) {
            this.pending.resolve(null);
            this.pending = null;
        }
        this.stopActive();
        this.waitingReady = true;
        worker.postMessage('ucinewgame');
        worker.postMessage('isready');
    }

    destroy(): void {
        this.clearInitTimer();
        if (this.pending) {
            this.pending.resolve(null);
            this.pending = null;
        }
        if (this.active) {
            window.clearTimeout(this.active.timer);
            this.active.resolve(null);
            this.active = null;
        }
        this.worker?.terminate();
        this.worker = null;
        this.waitingReady = false;
        this.setStatus('closed');
    }

    getSnapshot(): EngineSnapshot {
        const active = this.active;
        return {
            status: this.status,
            initMs: this.initMs,
            hashMb: this.hashMb,
            error: this.error,
            search: active
                ? {
                      ...active.metrics,
                      elapsedMs: Math.round(performance.now() - active.startedAt),
                      movetimeMs: active.request.movetimeMs,
                  }
                : null,
        };
    }

    private start(
        request: SearchRequest,
        resolve: (result: SearchResult | null) => void,
        reject: (error: Error) => void,
    ): void {
        const worker = this.worker;
        if (!worker) {
            resolve(null);
            return;
        }

        this.active = {
            request,
            resolve,
            reject,
            startedAt: performance.now(),
            cancelled: false,
            metrics: emptyMetrics(),
            timer: 0,
        };
        this.active.timer = window.setTimeout(
            () => this.fail('search_timeout'),
            request.movetimeMs + 5000,
        );
        this.setStatus('searching');

        worker.postMessage(`setoption name Skill Level value ${request.skillLevel}`);
        worker.postMessage(`position fen ${request.fen}`);
        worker.postMessage(`go movetime ${request.movetimeMs}`);
    }

    private stopActive(): void {
        const active = this.active;
        if (!active || active.cancelled) return;
        active.cancelled = true;
        window.clearTimeout(active.timer);
        active.timer = window.setTimeout(() => this.fail('engine_stop_timeout'), 3000);
        this.worker?.postMessage('stop');
    }

    private handleLine(line: string): void {
        if (line === 'readyok') {
            if (this.waitingReady) {
                this.waitingReady = false;
                this.setStatus('ready');
                this.startPending();
            }
            return;
        }

        if (line.startsWith('bestmove')) {
            this.handleBestmove(line);
            return;
        }

        if (line.startsWith('info ')) {
            this.handleInfo(line);
        }
    }

    private handleInfo(line: string): void {
        const active = this.active;
        if (!active) return;

        const depth = readNumber(line, 'depth');
        const seldepth = readNumber(line, 'seldepth');
        const nodes = readNumber(line, 'nodes');
        const nps = readNumber(line, 'nps');
        const time = readNumber(line, 'time');
        const score = /(?:^| )score (cp|mate) (-?\d+)/.exec(line);

        active.metrics = {
            depth: depth ?? active.metrics.depth,
            seldepth: seldepth ?? active.metrics.seldepth,
            nodes: nodes ?? active.metrics.nodes,
            nps: nps ?? active.metrics.nps,
            timeMs: time ?? active.metrics.timeMs,
            scoreCp: score?.[1] === 'cp' ? Number(score[2]) : active.metrics.scoreCp,
            mateIn: score?.[1] === 'mate' ? Number(score[2]) : active.metrics.mateIn,
        };
    }

    private handleBestmove(line: string): void {
        const active = this.active;
        if (!active) return;

        window.clearTimeout(active.timer);
        this.active = null;

        const token = /^bestmove\s+(\S+)/.exec(line)?.[1] ?? '';
        if (active.cancelled) {
            active.resolve(null);
        } else {
            active.resolve({
                bestmove: token && token !== '(none)' ? token : null,
                metrics: active.metrics,
                elapsedMs: Math.round(performance.now() - active.startedAt),
            });
        }

        this.setStatus('ready');
        this.startPending();
    }

    private startPending(): void {
        if (!this.pending || this.active || this.waitingReady || !this.worker) return;
        if (this.status === 'error' || this.status === 'closed') return;
        const next = this.pending;
        this.pending = null;
        this.start(next.request, next.resolve, next.reject);
    }

    private fail(message: string): void {
        this.clearInitTimer();
        this.waitingReady = false;
        this.error = message;

        if (this.pending) {
            this.pending.resolve(null);
            this.pending = null;
        }
        if (this.active) {
            window.clearTimeout(this.active.timer);
            this.active.resolve(null);
            this.active = null;
        }

        this.worker?.terminate();
        this.worker = null;
        this.initPromise = null;
        this.setStatus('error');
    }

    private clearInitTimer(): void {
        if (this.initTimer !== null) {
            window.clearTimeout(this.initTimer);
            this.initTimer = null;
        }
    }

    private setStatus(status: EngineStatus): void {
        this.status = status;
        this.listener?.(status, this.error);
    }
}
