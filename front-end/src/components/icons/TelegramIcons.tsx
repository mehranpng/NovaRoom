type IconProps = {
  size?: number;
  className?: string;
};

export function DownloadIcon({ size = 24, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M26.116 16.783c.432-.432.432-1.134 0-1.566s-1.133-.432-1.565 0l-7.444 7.444V6.667c0-.611-.496-1.107-1.107-1.107-.61 0-1.107.496-1.107 1.107V22.66L7.45 15.217c-.432-.432-1.133-.432-1.565 0s-.432 1.134 0 1.566l9.333 9.333c.208.208.49.324.783.324s.575-.117.783-.324z" />
    </svg>
  );
}

export function PlayIcon({ size = 28, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M6.667 6.208v9.794c0 1.494.87 1.89 2.835 1.89q8.877.085 13.231 0 .8-.015 2.23-.305c1.173-.737 1.173-2.438 0-3.194L9.579 4.62c-1.267-.812-2.911.095-2.911 1.588m0 9.794v9.788c0 1.493 1.644 2.4 2.91 1.588l15.387-9.791c1.172-.737 1.172-2.438 0-3.194q-1.482-.283-2.23-.28-4.38.006-13.232 0c-1.966 0-2.835.396-2.835 1.89" />
    </svg>
  );
}

export function PauseIcon({ size = 28, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M22.095 5.333a3.057 3.057 0 0 0-3.047 3.048v15.237a3.057 3.057 0 0 0 3.047 3.048 3.057 3.057 0 0 0 3.048-3.048V8.381a3.057 3.057 0 0 0-3.048-3.048m-9.143 3.048a3.057 3.057 0 0 0-3.047-3.048 3.057 3.057 0 0 0-3.048 3.048v15.237a3.057 3.057 0 0 0 3.048 3.048 3.057 3.057 0 0 0 3.047-3.048V8.381" />
    </svg>
  );
}

export function CloseIcon({ size = 26, className }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M23.217 7.217c.432-.432 1.134-.432 1.566 0s.432 1.134 0 1.566L17.565 16l7.218 7.217c.432.432.432 1.134 0 1.566s-1.134.432-1.566 0L16 17.565l-7.217 7.218c-.432.432-1.134.432-1.566 0s-.432-1.134 0-1.566L14.435 16 7.217 8.783c-.432-.432-.432-1.134 0-1.566s1.134-.432 1.566 0L16 14.435z" />
    </svg>
  );
}
