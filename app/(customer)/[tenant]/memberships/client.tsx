"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { joinMembershipAction, pauseMembershipAction, resumeMembershipAction, cancelMembershipAction } from "@/lib/actions/memberships";

export function JoinButton({ tenantSlug, planId, isAuthenticated, loginHref }: { tenantSlug: string; planId: string; isAuthenticated: boolean; loginHref: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!isAuthenticated) {
    return (
      <Button className="w-full" onClick={() => router.push(loginHref)}>
        Sign in to join
      </Button>
    );
  }

  return (
    <Button
      className="w-full"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await joinMembershipAction(tenantSlug, planId);
          if (result && "error" in result) toast.error(result.error);
        })
      }
    >
      Join membership
    </Button>
  );
}

export function MembershipControls({ tenantSlug, membershipId, paused }: { tenantSlug: string; membershipId: string; paused: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-2">
      {paused ? (
        <Button
          size="sm"
          variant="outline"
          loading={pending}
          onClick={() => startTransition(() => resumeMembershipAction(tenantSlug, membershipId))}
        >
          Resume
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          loading={pending}
          onClick={() => startTransition(() => pauseMembershipAction(tenantSlug, membershipId))}
        >
          Pause
        </Button>
      )}
      <Button
        size="sm"
        variant="danger"
        loading={pending}
        onClick={() => {
          if (confirm("Cancel your membership? This cannot be undone.")) {
            startTransition(() => cancelMembershipAction(tenantSlug, membershipId));
          }
        }}
      >
        Cancel
      </Button>
    </div>
  );
}
