import { isVisualEffectsEnabled } from '../hooks/useDarkMode';
import {
    SNAP_EFFECT_DURATION_MS,
    SNAP_GRAIN_FREQUENCY_DESKTOP,
    SNAP_GRAIN_FREQUENCY_MOBILE,
    SNAP_GRAIN_ROUNDNESS,
} from './snapConfig';

const SNAP_EFFECT_CONTAINER_ID = 'snap-effect-container';
const VISIBILITY_MARGIN = 50;

const userAgent = navigator.userAgent;
const isFirefox = /Firefox/i.test(userAgent);
const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(userAgent);
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);

let filterCounter = 0;

export function isSnapEffectSupported(): boolean {
    return isVisualEffectsEnabled() && !isFirefox && !isSafari;
}

function getContainer(): HTMLElement {
    const existing = document.getElementById(SNAP_EFFECT_CONTAINER_ID);
    if (existing) return existing;
    const container = document.createElement('div');
    container.id = SNAP_EFFECT_CONTAINER_ID;
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:12000';
    document.body.appendChild(container);
    return container;
}

function cloneWithStyles(source: HTMLElement, width: number, height: number): HTMLElement {
    const clone = source.cloneNode(true) as HTMLElement;
    const sources = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))];
    const targets = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];

    sources.forEach((from, index) => {
        const to = targets[index];
        if (!to) return;
        const computed = window.getComputedStyle(from);
        if (computed.display === 'none') {
            to.style.setProperty('display', 'none', 'important');
            return;
        }
        for (let i = 0; i < computed.length; i++) {
            const property = computed[i];
            to.style.setProperty(property, computed.getPropertyValue(property), 'important');
        }
    });

    [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))].forEach((node) => {
        node.removeAttribute('id');
        node.removeAttribute('data-message-id');
        node.removeAttribute('data-disintegrating');
    });

    clone.style.setProperty('position', 'static', 'important');
    clone.style.setProperty('inset', 'auto', 'important');
    clone.style.setProperty('margin', '0', 'important');
    clone.style.setProperty('transform', 'none', 'important');
    clone.style.setProperty('translate', 'none', 'important');
    clone.style.setProperty('visibility', 'visible', 'important');
    clone.style.setProperty('opacity', '1', 'important');
    clone.style.setProperty('pointer-events', 'none', 'important');
    clone.style.setProperty('width', `${width}px`, 'important');
    clone.style.setProperty('height', `${height}px`, 'important');
    clone.style.setProperty('box-sizing', 'border-box', 'important');

    return clone;
}

function buildSvgMarkup(filterId: string, seed: number, width: number, height: number, left: number, top: number): string {
    const duration = `${SNAP_EFFECT_DURATION_MS}ms`;
    const grainFrequency = isMobile ? SNAP_GRAIN_FREQUENCY_MOBILE : SNAP_GRAIN_FREQUENCY_DESKTOP;
    const displacement = Math.round(Math.min(width, height) * 3);
    const noise = SNAP_GRAIN_ROUNDNESS > 0
        ? `<feTurbulence type="fractalNoise" baseFrequency="${grainFrequency}" numOctaves="1" result="rawNoise" seed="${seed}"/>` +
            `<feGaussianBlur in="rawNoise" stdDeviation="${SNAP_GRAIN_ROUNDNESS}" result="dustNoise"/>`
        : `<feTurbulence type="fractalNoise" baseFrequency="${grainFrequency}" numOctaves="1" result="dustNoise" seed="${seed}"/>`;
    return `<svg class="snap-effect-ghost" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="left:${left}px;top:${top}px">` +
        `<defs><filter id="${filterId}" x="-150%" y="-150%" width="400%" height="400%" color-interpolation-filters="sRGB">` +
        noise +
        `<feComponentTransfer in="dustNoise" result="dustNoiseMask">` +
        `<feFuncA type="linear" slope="5" intercept="0">` +
        `<animate attributeName="slope" values="5; 2; 1; 0" dur="${duration}" fill="freeze"/>` +
        `</feFuncA>` +
        `</feComponentTransfer>` +
        `<feComposite in="SourceGraphic" in2="dustNoiseMask" operator="in" result="dustySource"/>` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="1" result="displacementNoise1" seed="${seed + 1}"/>` +
        `<feTurbulence type="fractalNoise" baseFrequency="1" numOctaves="2" result="displacementNoise2" seed="${seed + 2}"/>` +
        `<feMerge result="combinedNoise">` +
        `<feMergeNode in="displacementNoise1"/>` +
        `<feMergeNode in="displacementNoise2"/>` +
        `</feMerge>` +
        `<feDisplacementMap in="dustySource" in2="combinedNoise" scale="0" xChannelSelector="R" yChannelSelector="G">` +
        `<animate attributeName="scale" values="0; ${displacement}" dur="${duration}" fill="freeze"/>` +
        `</feDisplacementMap>` +
        `</filter></defs>` +
        `<g filter="url(#${filterId})">` +
        `<foreignObject class="snap-effect-element" width="${width}" height="${height}"></foreignObject>` +
        `</g>` +
        `</svg>`;
}

export function animateSnap(element: HTMLElement): boolean {
    if (!isSnapEffectSupported()) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (
        rect.right < -VISIBILITY_MARGIN
        || rect.left > window.innerWidth + VISIBILITY_MARGIN
        || rect.bottom < -VISIBILITY_MARGIN
        || rect.top > window.innerHeight + VISIBILITY_MARGIN
    ) {
        return false;
    }

    const seed = Math.floor(Date.now() / 1000);
    const filterId = `snap-effect-${filterCounter++}`;
    const container = getContainer();
    const markup = buildSvgMarkup(filterId, seed, rect.width, rect.height, rect.left, rect.top);

    const clone = cloneWithStyles(element, rect.width, rect.height);

    container.insertAdjacentHTML('beforeend', markup);
    const svg = container.lastElementChild as SVGElement | null;
    if (!svg) return false;
    const foreignObject = svg.querySelector('foreignObject');
    if (!foreignObject) {
        svg.remove();
        return false;
    }

    foreignObject.appendChild(clone);

    svg.addEventListener('animationend', (event) => {
        if (event.target === svg) svg.remove();
    }, { once: true });
    window.setTimeout(() => svg.remove(), SNAP_EFFECT_DURATION_MS + 500);

    return true;
}
