"use client";

import { useTransition } from "react";
import { setTenantStatusAction, updateSubscriptionStatusAction } from "@/lib/actions/platform";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

export function TenantActionsPanel({
  tenantId,
  status,
  subscriptionStatus,
}: {
  tenantId: string;
  status: "ACTIVE" | "SUSPENDED" | "PENDING";
  subscriptionStatus: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "ACTIVE" ? (
        <Button
          variant="danger"
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              await setTenantStatusAction(tenantId, "SUSPENDED");
              toast.success("Tenant suspended");
            })
          }
        >
          Suspend tenant
        </Button>
      ) : (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              await setTenantStatusAction(tenantId, "ACTIVE");
              toast.success("Tenant reactivated");
            })
          }
        >
          Reactivate tenant
        </Button>
      )}

      <Select
        defaultValue={subscriptionStatus}
        className="w-44"
        onChange={(e) =>
          startTransition(async () => {
            await updateSubscriptionStatusAction(tenantId, e.target.value as never);
            toast.success("Subscription status updated");
          })
        }
      >
        <option value="TRIAL">Trial</option>
        <option value="ACTIVE">Active</option>
        <option value="PAST_DUE">Past due</option>
        <option value="CANCELLED">Cancelled</option>
      </Select>
    </div>
  );
}
