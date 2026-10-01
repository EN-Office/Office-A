import type { SVGProps } from "react";

const paths = {
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  trash: "M4 7h16M9 7V4.8c0-.4.4-.8.8-.8h4.4c.4 0 .8.4.8.8V7M6.5 7l.9 12.2c0 .5.5.8 1 .8h7.2c.5 0 1-.3 1-.8L17.5 7",
  chevronLeft: "M14.5 6l-6 6 6 6",
  chevronRight: "M9.5 6l6 6-6 6",
  chevronDown: "M6 9.5l6 6 6-6",
  download: "M12 4v11M7 10.5l5 5 5-5M5 20h14",
  upload: "M12 20V9M7 13.5l5-5 5 5M5 4h14",
  arrowUpRight: "M7 17L17 7M9 7h8v8",
  sun: "M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4L7 17M17 7l1.4-1.4M12 8.2a3.8 3.8 0 100 7.6 3.8 3.8 0 000-7.6z",
  moon: "M19.5 14.5A7.5 7.5 0 019.5 4.5a7.5 7.5 0 1010 10z",
  search: "M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8",
  childAdd: "M6 4v9a3 3 0 003 3h6M15 12.5l3.5 3.5-3.5 3.5",
  sort: "M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5",
  dashboard: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z",
  grid: "M4 5h16M4 12h16M4 19h16M9 5v14M15 5v14",
  tree: "M5 4h5v4H5zM14 10h5v4h-5zM14 17h5v4h-5zM7.5 8v4.5H14M7.5 12v7H14",
  folder: "M3.5 6.5c0-.6.4-1 1-1h4.8l2 2.2h8.2c.6 0 1 .4 1 1v9.8c0 .6-.4 1-1 1h-15c-.6 0-1-.4-1-1z",
  settings: "M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 01-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 01-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 010-2.4L4.6 9.9l2-3.4 1.9.7a7 7 0 012-1.2L10.8 3h4l.3 2.4a7 7 0 012 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 010 2.4z",
} as const;

export type IconName = keyof typeof paths | "grip";

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  if (name === "grip") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
        {[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.4} />))}
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
