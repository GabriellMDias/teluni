import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
export function DocLink({
  id = "",
  hash,
  children,
  className,
  current,
  group,
}: {
  id?: string;
  hash?: string;
  children: ReactNode;
  className?: string;
  current?: boolean;
  group?: string;
}) {
  return (
    <Link
      to="/docs/$"
      params={{ _splat: id }}
      hash={hash}
      search={group ? { group } : {}}
      activeOptions={{ exact: true }}
      className={className}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
