export function MediaBadge({ children, position = 'left', className = '' }: { children: React.ReactNode; position?: 'left' | 'right'; className?: string }) {
  return <div className={`media-badge${position === 'right' ? ' media-badge--right' : ''} ${className}`.trim()}>{children}</div>;
}
