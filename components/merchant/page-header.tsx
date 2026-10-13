import * as React from "react";

/**
 * A portal page's header: title, one line of context, actions on the right.
 *
 * Redeem and Scan QR used to live here and are now in the shell's top bar —
 * they are things somebody at the desk does from whatever page they happen to
 * be on, so they should not come and go with the page. What is left is the
 * page's own identity and at most one black button.
 */
export function MerchantPageHeader({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  /** One line saying what this page is for, or what the numbers cover. */
  description?: React.ReactNode;
  /** The page's own actions. At most one of them is a Primary. */
  children?: React.ReactNode;
}) {
  return (
    <header className="pk-head">
      <div className="min-w-0">
        <h1>{title}</h1>
        {description && <p className="sub">{description}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}
