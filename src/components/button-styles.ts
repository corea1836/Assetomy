// DESIGN.md "버튼"의 Pill을 한 곳에서 만든다.
const BASE =
  "group inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[background-color,transform] duration-120 ease-standard active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:active:scale-100";

const SIZES = {
  md: "h-11 px-5 text-base",
  sm: "h-9 px-4 text-sm",
} as const;

const VARIANTS = {
  primary: "bg-primary text-white hover:bg-primary-hover active:bg-primary-active disabled:bg-primary-disabled",
  secondary: "bg-surface-strong text-ink hover:bg-hairline active:bg-hairline disabled:bg-surface-strong disabled:text-muted-soft",
} as const;

export function buttonClass(
  variant: keyof typeof VARIANTS,
  size: keyof typeof SIZES = "md",
): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}
