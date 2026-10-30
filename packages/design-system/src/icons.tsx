import { useId, type ReactNode, type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: ReactNode) {
  return function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const IconImage = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 16-5-5-8 9" />
  </>,
);
export const IconDownload = make(
  <>
    <path d="M12 4v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 20h14" />
  </>,
);
export const IconChevronDown = make(<path d="m6 9 6 6 6-6" />);
export const IconUndo = make(
  <>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </>,
);
export const IconRedo = make(
  <>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </>,
);
export const IconPlus = make(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);
export const IconTrash = make(
  <>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M9 7V4h6v3" />
  </>,
);
export const IconEdit = make(
  <>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
  </>,
);
export const IconFolder = make(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const IconWand = make(
  <>
    <path d="m4 20 11-11" />
    <path d="m14 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
    <path d="m19 11 .7 1.3L21 13l-1.3.7L19 15l-.7-1.3L17 13l1.3-.7z" />
  </>,
);
export const IconLayers = make(
  <>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </>,
);
export const IconCube = make(
  <>
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="m12 12 8-4.5M12 12v9M12 12 4 7.5" />
  </>,
);
export const IconCompare = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </>,
);
export const IconPalette = make(
  <>
    <path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
    <circle cx="7.5" cy="11" r="1" />
    <circle cx="10" cy="7" r="1" />
    <circle cx="15" cy="7" r="1" />
  </>,
);
export const IconGrip = make(
  <>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth={3} />
  </>,
);
export const IconFile = make(
  <>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5" />
  </>,
);
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);
export const IconBrush = make(
  <>
    <path d="M19 3 9.5 12.5" />
    <path d="m11 14-2.5-2.5" />
    <path d="M8.5 13.5c-2 0-3.5 1.5-3.5 3.5 0 1.5-1 2.5-2 3 3 .5 7-.5 7-4 0-1-.5-1.8-1.5-2.5z" />
  </>,
);
export const IconCheck = make(<path d="m5 12 5 5 9-10" />);
export const IconEye = make(
  <>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconEyeOff = make(
  <>
    <path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.7 3.6M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m3 3 18 18" />
  </>,
);

/** Brand mark: a print's colour strata rising into a hill under a light source. Mirrors apps/web/public/favicon.svg. */
export function LogoMark({ size = 24, ...props }: IconProps) {
  const clip = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden {...props}>
      <defs>
        <clipPath id={clip}>
          <path d="M4 26 C7 26 9.5 15.5 13.5 13 C16 11.4 17.2 7 20 7 C23.2 7 24.2 17.5 26 22.5 C26.8 24.8 27.4 26 28.5 26 Z" />
        </clipPath>
      </defs>
      <rect width="32" height="32" rx="8" fill="#1b1b1b" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#fff" strokeOpacity={0.1} />
      <circle cx="9.5" cy="9" r="2.4" fill="#ececec" />
      <g clipPath={`url(#${clip})`}>
        <rect y="21.4" width="32" height="10" fill="#3d2c52" />
        <rect y="16.8" width="32" height="4" fill="#8e3b5a" />
        <rect y="12.2" width="32" height="4" fill="#d9643f" />
        <rect width="32" height="11.6" fill="#f2b65e" />
      </g>
    </svg>
  );
}
