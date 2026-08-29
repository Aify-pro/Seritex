"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/auth/nav";
import { motion } from "framer-motion";

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "text-brand"
                : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId="active-nav-pill"
                className="absolute inset-0 rounded-md bg-brand-soft"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            {item.icon}
            <span className="relative z-10">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
