import { cn } from "@/lib/utils";

export function UserAvatar({ name, size = "md", muted = false }: { name: string; size?: "md" | "lg"; muted?: boolean }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "lg" ? "h-14 w-14 text-lg" : "h-8 w-8 text-xs",
        muted ? "bg-surface-muted text-foreground-muted" : "bg-brand-soft text-brand"
      )}
    >
      {initials || "?"}
    </span>
  );
}
