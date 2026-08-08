"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { ShoppingBag } from "lucide-react";

export function AddToBasketButton({
  action,
  isAuthenticated,
  loginHref,
  label = "Add to basket",
}: {
  action: () => Promise<void>;
  isAuthenticated: boolean;
  loginHref: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!isAuthenticated) {
    return (
      <Button className="w-full" onClick={() => router.push(loginHref)}>
        <ShoppingBag className="h-4 w-4" /> Sign in to purchase
      </Button>
    );
  }

  return (
    <Button
      className="w-full"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await action();
            toast.success("Added to basket");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Something went wrong");
          }
        })
      }
    >
      <ShoppingBag className="h-4 w-4" /> {label}
    </Button>
  );
}
