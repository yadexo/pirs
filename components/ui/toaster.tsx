"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "!bg-surface-raised !text-ink !border !border-border !shadow-raised",
          description: "!text-ink-muted",
        },
      }}
    />
  );
}

export { toast } from "sonner";
