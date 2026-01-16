type AuraLogoProps = {
  className?: string;
};

export function AuraLogo({ className }: AuraLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      aria-hidden="true"
      role="img"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="18" fill="currentColor" />
      <circle cx="32" cy="32" r="24" stroke="currentColor" strokeWidth="2" />
      <path
        d="M20 36c6-8 18-8 24 0"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="26" r="3.5" fill="currentColor" />
    </svg>
  );
}
