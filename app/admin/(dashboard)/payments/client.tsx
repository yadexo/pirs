"use client";

import { useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, FieldError, FieldHint } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { refundPaymentAction } from "@/lib/actions/payments";
import { formatMoney } from "@/lib/utils";

export function RefundButton({ paymentId, refundableCents }: { paymentId: string; refundableCents: number }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(refundPaymentAction, undefined);
  if (state && "success" in state && state.success && open) setOpen(false);

  if (refundableCents <= 0) return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Refund
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Issue refund">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="paymentId" value={paymentId} />
          <div>
            <Label htmlFor="amount">Amount (USD)</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              max={(refundableCents / 100).toFixed(2)}
              defaultValue={(refundableCents / 100).toFixed(2)}
              required
            />
            <FieldHint>Up to {formatMoney(refundableCents)} refundable.</FieldHint>
          </div>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" name="reason" required />
          </div>
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Issue refund</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}
