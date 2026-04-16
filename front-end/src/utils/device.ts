export function detectDeviceName(): string {
    if (typeof navigator === 'undefined') return 'Unknown Device';
    const ua = (navigator.userAgent || '').toLowerCase();
    const platform = (navigator.platform || '').toLowerCase();

    const os = ua.includes('android')
        ? 'Android'
        : /iphone|ipad|ipod/.test(ua)
            ? 'iOS'
            : ua.includes('windows')
                ? 'Windows'
                : ua.includes('mac os') || platform.includes('mac')
                    ? 'macOS'
                    : ua.includes('linux')
                        ? 'Linux'
                        : 'Unknown OS';

    const browser = ua.includes('edg/')
        ? 'Edge'
        : ua.includes('opr/') || ua.includes('opera')
            ? 'Opera'
            : ua.includes('firefox/')
                ? 'Firefox'
                : ua.includes('safari') && !ua.includes('chrome')
                    ? 'Safari'
                    : ua.includes('chrome/')
                        ? 'Chrome'
                        : 'Unknown Browser';

    return `${os} • ${browser}`;
}
