import { cn } from '@/utils/cn';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  className?: string;
}

const colors = [
  'bg-gradient-to-br from-violet-500 to-purple-600',
  'bg-gradient-to-br from-blue-500 to-cyan-600',
  'bg-gradient-to-br from-emerald-500 to-teal-600',
  'bg-gradient-to-br from-orange-500 to-red-600',
  'bg-gradient-to-br from-pink-500 to-rose-600',
  'bg-gradient-to-br from-indigo-500 to-blue-600',
  'bg-gradient-to-br from-amber-500 to-yellow-600',
  'bg-gradient-to-br from-teal-500 to-green-600',
];

function getColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const sizeMap = {
  sm: 'w-10 h-10 text-sm',
  md: 'w-12 h-12 text-base',
  lg: 'w-16 h-16 text-xl',
  xl: 'w-24 h-24 text-3xl',
};

const dotSizeMap = {
  sm: 'w-2.5 h-2.5 border-[1.5px]',
  md: 'w-3 h-3 border-2',
  lg: 'w-4 h-4 border-2',
  xl: 'w-5 h-5 border-[3px]',
};

export function Avatar({ name, size = 'md', online, className }: AvatarProps) {
  return (
    <div className={cn('relative shrink-0', className)}>
      <div
        className={cn(
          'flex items-center justify-center rounded-full font-semibold text-white shadow-sm',
          sizeMap[size],
          getColor(name)
        )}
      >
        {getInitials(name)}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-white',
            dotSizeMap[size],
            online ? 'bg-emerald-500' : 'bg-gray-400'
          )}
        />
      )}
    </div>
  );
}
