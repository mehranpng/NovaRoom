import type { TelegramIconName } from '../components/TelegramIcon';

export type TelegramBackdropColor = 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'gray' | 'pink';

export function getSessionDeviceMeta(deviceName: string): { icon: TelegramIconName; color: TelegramBackdropColor } {
    const lower = deviceName.toLowerCase();
    if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ios') || lower.includes('mac') || lower.includes('apple')) {
        return { icon: 'device-apple', color: 'blue' };
    }
    if (lower.includes('android')) {
        return { icon: 'device-android', color: 'green' };
    }
    if (lower.includes('windows')) {
        return { icon: 'device-windows', color: 'blue' };
    }
    if (lower.includes('ubuntu')) {
        return { icon: 'device-ubuntu', color: 'red' };
    }
    if (lower.includes('linux')) {
        return { icon: 'device-linux', color: 'orange' };
    }
    if (lower.includes('chrome') || lower.includes('firefox') || lower.includes('safari') || lower.includes('edge') || lower.includes('web')) {
        return { icon: 'web-filled', color: 'purple' };
    }
    return { icon: 'device-unknown', color: 'gray' };
}
