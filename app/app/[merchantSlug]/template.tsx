import type { ReactNode } from "react";

/**
 * Gives every tab and screen the same short fade-and-rise on arrival. Next
 * creates a new instance of a template (unlike a layout) on every navigation,
 * including between sibling tabs that share the same layout — which is
 * exactly the moment this should restart.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="ca-page-enter">{children}</div>;
}
