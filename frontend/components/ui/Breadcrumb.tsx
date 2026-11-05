import Link from "next/link";

export interface Crumb {
  label: string;
  /** ไม่มี = หน้าปัจจุบัน */
  href?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {items.map((item, index) => (
          <li key={item.label} className="flex min-w-0 items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-ink-subtle">
                ›
              </span>
            ) : null}
            {item.href ? (
              <Link href={item.href} className="font-medium text-navy-700 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="break-words text-ink-muted">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
