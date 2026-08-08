"use client";

import { useActionState } from "react";
import { placeOrderAction } from "@/lib/actions/checkout";
import { FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";

export function PlaceOrderForm({
  tenantSlug,
  promoCode,
  useCreditDollars,
  rewardId,
  showSimulateFailure,
}: {
  tenantSlug: string;
  promoCode: string;
  useCreditDollars: string;
  rewardId: string;
  showSimulateFailure: boolean;
}) {
  const action = placeOrderAction.bind(null, tenantSlug);
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="promoCode" value={promoCode} />
      <input type="hidden" name="useCreditDollars" value={useCreditDollars} />
      <input type="hidden" name="rewardId" value={rewardId} />
      {showSimulateFailure && (
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" name="simulateFailure" />
          Simulate a declined payment (mock provider demo)
        </label>
      )}
      <FieldError>{state?.error}</FieldError>
      <SubmitButton>Place order</SubmitButton>
    </form>
  );
}
