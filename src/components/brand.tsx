import type { CSSProperties } from "react";
export function Crest({
  small = false,
  className = "",
}: {
  small?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`crest ${className}`}
      width={small ? 36 : 60}
      height={small ? 42 : 70}
      viewBox="0 0 60 70"
      fill="none"
      aria-label="Mauve FC crest"
      role="img"
    >
      <path
        d="M4 4h52v34c0 14-14 23-26 29C18 61 4 52 4 38V4Z"
        fill="currentColor"
      />
      <path
        d="M9 9h42v28c0 11-11 19-21 24C20 56 9 48 9 37V9Z"
        stroke="var(--crest-line,#c1a1bf)"
      />
      <path
        d="M17 43V23l13 11 13-11v20h-7v-7l-6 5-6-5v7h-7Z"
        fill="var(--crest-line,#c1a1bf)"
      />
      <path
        d="M19 17h22M25 49h10"
        stroke="var(--crest-line,#c1a1bf)"
        strokeWidth="2"
      />
    </svg>
  );
}
export function OpponentBadge({
  code,
  color,
  small = false,
}: {
  code: string;
  color: string;
  small?: boolean;
}) {
  return (
    <span
      className={`opponent-badge ${small ? "small" : ""}`}
      style={{ "--opponent": color } as CSSProperties}
    >
      {code}
    </span>
  );
}
export function Jersey({
  number,
  className = "",
}: {
  number: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 220 220"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`shirt-${number}`}
          x1="30"
          y1="20"
          x2="190"
          y2="210"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#bd92b8" />
          <stop offset="1" stopColor="#785170" />
        </linearGradient>
      </defs>
      <ellipse cx="110" cy="204" rx="65" ry="7" fill="#42233f" opacity=".08" />
      <path
        d="m67 30-40 24-16 44 38 14 15-27v112h92V85l15 27 38-14-16-44-40-24-21 10h-44L67 30Z"
        fill={`url(#shirt-${number})`}
      />
      <path d="m88 30 22 13 22-13-7 20H95l-7-20Z" fill="#3a2238" />
      <path
        d="M67 30 52 71M153 30l15 41M64 185h92"
        stroke="#e3c9dd"
        strokeWidth="3"
        opacity=".5"
      />
      <text
        x="110"
        y="139"
        textAnchor="middle"
        fill="#f7f3eb"
        fontSize="63"
        fontWeight="700"
        fontFamily="Barlow Condensed,sans-serif"
      >
        {number}
      </text>
      <path d="M137 61h11v9l-5.5 5-5.5-5v-9Z" fill="#ead9e7" />
    </svg>
  );
}
