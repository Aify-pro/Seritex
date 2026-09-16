"use client";

import { useRouter } from "next/navigation";

export function OdfSwitcher({
  options,
  value,
}: {
  options: { id: string; reference: string; companyName: string | null }[];
  value: string;
}) {
  const router = useRouter();

  return (
    <select
      value={value}
      onChange={(e) => router.push(`/atelier/stock?odf=${e.target.value}`)}
      className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.reference}
          {o.companyName ? ` · ${o.companyName}` : ""}
        </option>
      ))}
    </select>
  );
}
