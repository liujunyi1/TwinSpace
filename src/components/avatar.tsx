import { initials } from "@/lib/utils";

export function Avatar({
  name,
  src,
  size = "md"
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizeClass = {
    sm: "h-10 w-10 text-xs",
    md: "h-12 w-12 text-sm",
    lg: "h-16 w-16 text-base",
    xl: "h-28 w-28 text-2xl"
  }[size];

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${name} 的头像`}
        className={`${sizeClass} rounded-[30%] object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} grid shrink-0 place-items-center rounded-[30%] bg-gradient-to-br from-lilac via-white to-skysoft font-semibold text-ink`}
      aria-label={`${name} 的头像`}
    >
      {initials(name)}
    </div>
  );
}
