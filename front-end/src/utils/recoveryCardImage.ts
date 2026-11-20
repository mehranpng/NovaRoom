export const downloadRecoveryCardImage = (words: string[], username?: string): boolean => {
    if (typeof document === 'undefined' || words.length !== 12) return false;
    const width = 1080;
    const height = 1320;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const drawRoundedRect = (x: number, y: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    };

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, width, height);

    drawRoundedRect(48, 48, width - 96, height - 96, 40);
    ctx.fillStyle = '#111a2e';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#24324d';
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'center';
    ctx.font = '700 40px Vazir, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('عبارت بازیابی ۱۲ کلمه‌ای نواروم', width / 2, 138);

    const safeUsername = String(username || '').trim();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 26px Vazir, -apple-system, BlinkMacSystemFont, sans-serif';
    const metaLine = safeUsername ? `@${safeUsername}` : 'NovaRoom E2EE Recovery';
    ctx.fillText(metaLine, width / 2, 190);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '400 24px Vazir, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('این ۱۲ کلمه را به ترتیب دقیق در جای امن نگهداری کنید', width / 2, 248);

    const startX = 96;
    const startY = 304;
    const gapX = 28;
    const gapY = 22;
    const colWidth = (width - startX * 2 - gapX) / 2;
    const rowHeight = 116;

    for (let i = 0; i < 12; i += 1) {
        const col = i < 6 ? 0 : 1;
        const row = i % 6;
        const x = startX + col * (colWidth + gapX);
        const y = startY + row * (rowHeight + gapY);

        drawRoundedRect(x, y, colWidth, rowHeight, 24);
        ctx.fillStyle = '#18243d';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#2b3c5e';
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.fillStyle = '#64748b';
        ctx.font = '700 24px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(`${String(i + 1).padStart(2, '0')}.`, x + 28, y + 67);

        ctx.fillStyle = '#f8fafc';
        ctx.font = '600 32px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(words[i].toLowerCase(), x + 88, y + 68);
    }

    drawRoundedRect(96, 1146, width - 192, 86, 22);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#fca5a5';
    ctx.font = '500 22px Vazir, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('این تصویر را با هیچ‌کس به اشتراک نگذارید', width / 2, 1198);

    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    const fileSlug = safeUsername ? safeUsername.replace(/[^a-zA-Z0-9_-]/g, '') : 'account';
    link.download = `novaroom-recovery-${fileSlug || 'account'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
};
