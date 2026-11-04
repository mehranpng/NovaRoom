const TEHRAN_TZ = 'Asia/Tehran';

const tehranYmdFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const persianJalaliDayMonthFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: TEHRAN_TZ,
    month: 'long',
    day: 'numeric',
});
const persianJalaliFullSlashFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
const persianJalaliYearFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
});
const persianWeekdayFmt = new Intl.DateTimeFormat('fa-IR', {
    timeZone: TEHRAN_TZ,
    weekday: 'long',
});
const persianTimeFmt = new Intl.DateTimeFormat('fa-IR', {
    timeZone: TEHRAN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

export function toPersianDigits(value: string | number): string {
    return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
}

export function resolveVerified(val: unknown): boolean {
    if (val === null || val === undefined) return false;
    if (val === false || val === 0 || val === 'false' || val === '0') return false;
    return true;
}

export function normalizeTs(ts: unknown): number {
    if (ts == null) return Date.now();
    if (typeof ts === 'string') {
        const n = Date.parse(ts);
        return Number.isFinite(n) ? n : Date.now();
    }
    if (typeof ts === 'number') {
        return ts < 1_000_000_000_000 ? ts * 1000 : ts;
    }
    if (ts instanceof Date) return ts.getTime();
    return Date.now();
}

const iranYMD = (ts: unknown): string => tehranYmdFmt.format(new Date(normalizeTs(ts)));

const iranDayNumber = (ts: unknown): number => Math.floor(Date.parse(`${iranYMD(ts)}T00:00:00Z`) / 86400000);

export function sameDay(a: unknown, b: unknown): boolean {
    return iranYMD(a) === iranYMD(b);
}

export function messageDayKey(ts: unknown): number {
    return iranDayNumber(ts);
}

export function formatDayLabel(ts: unknown): string {
    const today = iranDayNumber(Date.now());
    const thatDay = iranDayNumber(ts);
    const diffDays = today - thatDay;
    if (diffDays === 0) return 'امروز';
    if (diffDays === 1) return 'دیروز';
    if (diffDays <= 6) {
        return persianWeekdayFmt.format(new Date(normalizeTs(ts)));
    }
    const currentJalaliYear = persianJalaliYearFmt.format(new Date());
    const targetJalaliYear = persianJalaliYearFmt.format(new Date(normalizeTs(ts)));
    if (currentJalaliYear === targetJalaliYear) {
        return persianJalaliDayMonthFmt.format(new Date(normalizeTs(ts)));
    }
    return persianJalaliFullSlashFmt.format(new Date(normalizeTs(ts)));
}

export function formatMessageTime(ts: unknown): string {
    return persianTimeFmt.format(new Date(normalizeTs(ts)));
}

export function formatLastSeen(
    user?: {
        online?: boolean;
        lastSeen?: number | string | null;
        lastSeenCategory?: 'recently' | 'within_week' | 'within_month' | 'long_time_ago' | null;
        blockedByOther?: boolean;
        blockedByMe?: boolean;
    } | null,
    options?: {
        isContactBlocked?: boolean;
        isInteractiveOnline?: boolean;
    }
): string {
    if (!user) return 'آفلاین';
    if (options?.isContactBlocked || user.blockedByOther || user.blockedByMe) {
        return 'آخرین بازدید مدت‌ها پیش';
    }
    if (options?.isInteractiveOnline || user.online) {
        return 'آنلاین';
    }
    if (user.lastSeenCategory) {
        if (user.lastSeenCategory === 'recently') return 'آخرین بازدید به تازگی';
        if (user.lastSeenCategory === 'within_week') return 'آخرین بازدید یک هفته پیش';
        if (user.lastSeenCategory === 'within_month') return 'آخرین بازدید یک ماه پیش';
        if (user.lastSeenCategory === 'long_time_ago') return 'آخرین بازدید مدت‌ها پیش';
    }
    if (!user.lastSeen) {
        return 'آفلاین';
    }
    const diffMs = Math.max(0, Date.now() - normalizeTs(user.lastSeen));
    if (diffMs < 60_000) {
        return 'آخرین بازدید به تازگی';
    }
    const diffMinutes = Math.floor(diffMs / 60_000);
    if (diffMinutes < 60) {
        return `آخرین بازدید ${toPersianDigits(diffMinutes)} دقیقه پیش`;
    }
    const diffHours = Math.floor(diffMs / 3_600_000);
    if (diffHours < 24) {
        return `آخرین بازدید ${toPersianDigits(diffHours)} ساعت پیش`;
    }
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffDays < 7) {
        return `آخرین بازدید ${toPersianDigits(diffDays)} روز پیش`;
    }
    if (diffDays < 30) {
        const diffWeeks = Math.max(1, Math.floor(diffDays / 7));
        return `آخرین بازدید ${toPersianDigits(diffWeeks)} هفته پیش`;
    }
    const diffMonths = Math.max(1, Math.floor(diffDays / 30));
    return `آخرین بازدید ${toPersianDigits(diffMonths)} ماه پیش`;
}
