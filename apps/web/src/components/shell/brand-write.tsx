/** Wordmark AVICENNA yang digambar per huruf untuk layar pembuka login. */
export function BrandWrite({ className }: { className?: string }) {
  return (
    <span className={className}>
      <svg
        viewBox="0 0 720 150"
        className="tulis-nama h-auto w-[min(88vw,520px)] text-ink"
        fill="none"
        stroke="currentColor"
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-label="AVICENNA"
      >
        <path pathLength={1} d="M18 112 L53 34 L88 112 M33 82 L73 82" />
        <path pathLength={1} d="M112 34 L145 112 L178 34" />
        <path pathLength={1} d="M210 34 L210 112" />
        <path pathLength={1} d="M318 48 C307 28 258 27 247 65 C236 106 296 126 319 98" />
        <path pathLength={1} d="M350 34 L350 112 M350 34 L410 34 M350 73 L400 73 M350 112 L410 112" />
        <path pathLength={1} d="M438 112 L438 34 L504 112 L504 34" />
        <path pathLength={1} d="M532 112 L532 34 L598 112 L598 34" />
        <path pathLength={1} d="M622 112 L657 34 L692 112 M637 82 L677 82" />
      </svg>
    </span>
  );
}
