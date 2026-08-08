"use client";

import { useTransition } from "react";
import { markNotificationReadAction } from "@/lib/actions/notifications";
import { cn } from "@/lib/utils";

export function NotificationRow({
  id,
  title,
  body,
  createdAt,
  read,
}: {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending || read}
      onClick={() => startTransition(() => markNotificationReadAction(id))}
      className={cn("block w-full border-b border-border px-4 py-3 text-left last:border-0", !read && "bg-brand-primary/5")}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        {!read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-primary" />}
      </div>
      <p className="text-sm text-ink-muted">{body}</p>
      <p className="mt-1 text-xs text-ink-subtle">{createdAt}</p>
    </button>
  );
}
