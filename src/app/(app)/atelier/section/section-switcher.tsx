"use client";

import { useRouter } from "next/navigation";

export function SectionSwitcher({
  sections,
  value,
}: {
  sections: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();

  return (
    <select
      value={value}
      onChange={(e) => router.push(`/atelier/section?section=${e.target.value}`)}
      className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
    >
      {sections.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
