import type { Gender } from '../types/family';

interface GenderIndicatorProps {
  gender: Gender;
  compact?: boolean;
}

/**
 * Accessible gender indicator combining distinct visual accent (Blue for Male, Pink for Female)
 * with an explicit icon and readable text label (never relying on color alone).
 */
export function GenderIndicator({ gender, compact = false }: GenderIndicatorProps) {
  const isMale = gender === 'male';
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${
        compact ? 'text-[11px]' : 'text-xs'
      } ${isMale ? 'text-blue-700' : 'text-pink-700'}`}
    >
      {isMale ? (
        <svg
          className="w-3.5 h-3.5 shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="6.5" cy="9.5" r="4" />
          <path d="M9.5 6.5L14 2" />
          <path d="M10.5 2H14V5.5" />
        </svg>
      ) : (
        <svg
          className="w-3.5 h-3.5 shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="8" cy="6" r="4" />
          <path d="M8 10V15" />
          <path d="M5.5 12.5H10.5" />
        </svg>
      )}
      <span>{isMale ? 'Male' : 'Female'}</span>
    </span>
  );
}
