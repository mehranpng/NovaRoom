const PARTICLE_STEP = 3;
const PADDING = 36;
const DURATION = 680;
const COLLAPSE_DELAY = 160;
const COLLAPSE_DURATION = 240;

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    g: number;
    b: number;
    a: number;
    size: number;
    delay: number;
    life: number;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function fillBackground(ctx: CanvasRenderingContext2D, source: HTMLElement, width: number, height: number) {
    if (source.classList.contains('message-bubble--emoji-only')) {
        return;
    }
    const style = window.getComputedStyle(source);
    const radius = parseFloat(style.borderTopLeftRadius) || 16;
    drawRoundedRect(ctx, 0, 0, width, height, radius);

    const bgImage = style.backgroundImage;
    const bg = style.backgroundColor;
    const hasSolidBg = Boolean(bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');

    if (!hasSolidBg && (!bgImage || bgImage === 'none')) {
        return;
    }

    if (bgImage && bgImage.includes('gradient')) {
        const colorMatches = bgImage.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g);
        if (colorMatches && colorMatches.length >= 2) {
            const grad = ctx.createLinearGradient(0, 0, width, height);
            grad.addColorStop(0, colorMatches[0]);
            grad.addColorStop(1, colorMatches[colorMatches.length - 1]);
            ctx.fillStyle = grad;
            ctx.fill();
            return;
        }
    }

    if (hasSolidBg) {
        ctx.fillStyle = bg;
        ctx.fill();
    }
}

function drawTextNodes(ctx: CanvasRenderingContext2D, root: HTMLElement, baseRect: DOMRect) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let current = walker.nextNode();

    while (current) {
        const text = current.textContent || '';
        const parent = current.parentElement;
        if (parent && text.trim().length > 0 && !parent.closest('.message-bubble__selection-Check')) {
            const parentStyle = window.getComputedStyle(parent);
            if (parentStyle.display !== 'none' && parentStyle.visibility !== 'hidden' && parseFloat(parentStyle.opacity || '1') > 0) {
                const fontWeight = parentStyle.fontWeight || '400';
                const fontSize = parentStyle.fontSize || '14px';
                const fontFamily = parentStyle.fontFamily || 'sans-serif';
                ctx.font = `${fontWeight} ${fontSize} ${fontFamily}`;
                ctx.fillStyle = parentStyle.color || '#ffffff';
                ctx.textBaseline = 'top';

                const tokens = text.match(/\S+|\s+/g) || [];
                let offset = 0;
                for (const token of tokens) {
                    const start = offset;
                    const end = offset + token.length;
                    offset = end;
                    if (!token.trim()) continue;
                    try {
                        range.setStart(current, start);
                        range.setEnd(current, end);
                        const rect = range.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            const drawX = rect.left - baseRect.left;
                            const drawY = rect.top - baseRect.top;
                            ctx.fillText(token, drawX, drawY);
                        }
                    } catch {
                        void 0;
                    }
                }
            }
        }
        current = walker.nextNode();
    }
}

function renderSnapshot(source: HTMLElement, width: number, height: number): HTMLCanvasElement {
    const snap = document.createElement('canvas');
    snap.width = Math.max(1, Math.floor(width));
    snap.height = Math.max(1, Math.floor(height));
    const ctx = snap.getContext('2d');
    if (!ctx) return snap;

    const baseRect = source.getBoundingClientRect();
    fillBackground(ctx, source, width, height);

    const mediaEls = source.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLCanvasElement>('img, video, canvas');
    mediaEls.forEach((media) => {
        const r = media.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        try {
            ctx.drawImage(media, r.left - baseRect.left, r.top - baseRect.top, r.width, r.height);
        } catch {
            void 0;
        }
    });

    drawTextNodes(ctx, source, baseRect);

    const svgs = source.querySelectorAll<SVGElement>('svg');
    svgs.forEach((svg) => {
        const r = svg.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const svgStyle = window.getComputedStyle(svg);
        ctx.fillStyle = svgStyle.color || 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.arc(
            r.left - baseRect.left + r.width / 2,
            r.top - baseRect.top + r.height / 2,
            Math.max(2, Math.min(r.width, r.height) * 0.28),
            0,
            Math.PI * 2
        );
        ctx.fill();
    });

    return snap;
}

function buildParticles(snap: HTMLCanvasElement, width: number, height: number): Particle[] {
    const ctx = snap.getContext('2d');
    if (!ctx) return [];
    let data: Uint8ClampedArray;
    try {
        data = ctx.getImageData(0, 0, snap.width, snap.height).data;
    } catch {
        return [];
    }

    const particles: Particle[] = [];
    const step = Math.max(2, Math.min(5, Math.round(Math.sqrt((width * height) / 2600)) || PARTICLE_STEP));

    for (let y = 0; y < snap.height; y += step) {
        for (let x = 0; x < snap.width; x += step) {
            const idx = (y * snap.width + x) * 4;
            const a = data[idx + 3];
            if (a < 24) continue;
            const normX = x / Math.max(1, snap.width);
            const angle = (Math.random() - 0.5) * Math.PI * 1.4;
            const speed = 18 + Math.random() * 44;
            particles.push({
                x: x + PADDING,
                y: y + PADDING,
                vx: Math.cos(angle) * speed + 14,
                vy: Math.sin(angle) * speed - (12 + Math.random() * 24),
                r: data[idx],
                g: data[idx + 1],
                b: data[idx + 2],
                a: a / 255,
                size: step * (0.9 + Math.random() * 0.45),
                delay: Math.min(1, Math.max(0, normX * 0.75 + (Math.random() - 0.5) * 0.22)),
                life: 0.45 + Math.random() * 0.25,
            });
        }
    }
    return particles;
}

function disintegrateElement(el: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
        if (el.dataset.disintegrating === '1') {
            resolve();
            return;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            resolve();
            return;
        }

        el.dataset.disintegrating = '1';

        const snap = renderSnapshot(el, rect.width, rect.height);
        const particles = buildParticles(snap, rect.width, rect.height);
        if (particles.length === 0) {
            resolve();
            return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement('canvas');
        const cw = rect.width + PADDING * 2;
        const ch = rect.height + PADDING * 2;
        canvas.width = Math.floor(cw * dpr);
        canvas.height = Math.floor(ch * dpr);
        canvas.style.position = 'fixed';
        canvas.style.left = `${rect.left - PADDING}px`;
        canvas.style.top = `${rect.top - PADDING}px`;
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '9999';
        document.body.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
        }

        const rowTarget = (el.closest('.message-item') as HTMLElement | null) || el;
        const initialRowHeight = rowTarget.getBoundingClientRect().height;
        rowTarget.style.height = `${initialRowHeight}px`;
        rowTarget.style.overflow = 'hidden';
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';

        let collapseStarted = false;
        let resolved = false;
        const finishResolve = () => {
            if (resolved) return;
            resolved = true;
            resolve();
        };

        const start = performance.now();
        const tick = (now: number) => {
            const elapsed = now - start;
            if (!collapseStarted && elapsed >= COLLAPSE_DELAY) {
                collapseStarted = true;
                rowTarget.style.transition = `height ${COLLAPSE_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1), margin ${COLLAPSE_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1), padding ${COLLAPSE_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${COLLAPSE_DURATION}ms ease`;
                rowTarget.style.height = '0px';
                rowTarget.style.marginTop = '0px';
                rowTarget.style.marginBottom = '0px';
                rowTarget.style.paddingTop = '0px';
                rowTarget.style.paddingBottom = '0px';
                rowTarget.style.opacity = '0';
            }

            if (elapsed >= COLLAPSE_DELAY + COLLAPSE_DURATION) {
                finishResolve();
            }

            if (!ctx) {
                canvas.remove();
                finishResolve();
                return;
            }
            ctx.clearRect(0, 0, cw, ch);
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                const t = (elapsed - p.delay * 230) / 1000;
                if (t <= 0) {
                    ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${p.a})`;
                    ctx.fillRect(p.x, p.y, p.size, p.size);
                    continue;
                }
                const progress = t / p.life;
                if (progress >= 1) continue;
                const alpha = p.a * (1 - progress * progress);
                const x = p.x + p.vx * t;
                const y = p.y + p.vy * t + 26 * t * t;
                ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha})`;
                ctx.fillRect(x, y, p.size * (1 - progress * 0.3), p.size * (1 - progress * 0.3));
            }

            if (elapsed < DURATION) {
                requestAnimationFrame(tick);
            } else {
                canvas.remove();
                finishResolve();
            }
        };

        requestAnimationFrame(tick);
    });
}

export async function animateMessageDisintegration(elements: HTMLElement[]): Promise<void> {
    const valid = elements.filter((el) => el && el.isConnected && el.dataset.disintegrating !== '1');
    if (valid.length === 0) return;
    await Promise.all(valid.map((el) => disintegrateElement(el)));
}
