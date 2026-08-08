"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  upsertLoyaltyProgrammeAction,
  createLoyaltyRewardAction,
  archiveLoyaltyRewardAction,
} from "@/lib/actions/loyalty";
import { toast } from "@/components/ui/toaster";
import type { LoyaltyProgramme, Service, Product } from "@prisma/client";
import { Plus, Archive } from "lucide-react";

export function ProgrammeSettingsForm({ programme }: { programme: LoyaltyProgramme | null }) {
  const [state, formAction] = useActionState(upsertLoyaltyProgrammeAction, undefined);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="name">Programme name</Label>
        <Input id="name" name="name" defaultValue={programme?.name ?? "Rewards"} required />
      </div>
      <div>
        <Label htmlFor="pointsPerCents">Points per $1 spent</Label>
        <Input
          id="pointsPerCents"
          name="pointsPerCents"
          type="number"
          step="0.01"
          min="0"
          defaultValue={programme ? programme.pointsPerCents * 100 : 1}
        />
      </div>
      <div>
        <Label htmlFor="pointsPerVisit">Points per visit</Label>
        <Input id="pointsPerVisit" name="pointsPerVisit" type="number" min="0" defaultValue={programme?.pointsPerVisit ?? 0} />
      </div>
      <div>
        <Label htmlFor="referralPoints">Referral bonus points</Label>
        <Input id="referralPoints" name="referralPoints" type="number" min="0" defaultValue={programme?.referralPoints ?? 0} />
      </div>
      <div>
        <Label htmlFor="birthdayPoints">Birthday bonus points</Label>
        <Input id="birthdayPoints" name="birthdayPoints" type="number" min="0" defaultValue={programme?.birthdayPoints ?? 0} />
      </div>
      <div>
        <Label htmlFor="pointsExpiryDays">Points expire after (days)</Label>
        <Input id="pointsExpiryDays" name="pointsExpiryDays" type="number" min="1" placeholder="Never" defaultValue={programme?.pointsExpiryDays ?? undefined} />
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={programme?.active ?? true} />
        Programme active
      </label>
      <div className="sm:col-span-2">
        <FieldError>{state?.error}</FieldError>
        <SubmitButton className="w-auto">Save settings</SubmitButton>
      </div>
    </form>
  );
}

export function NewRewardForm({ services, products }: { services: Service[]; products: Product[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createLoyaltyRewardAction, undefined);
  const [rewardType, setRewardType] = useState("DISCOUNT_PERCENT");
  if (state && "success" in state && state.success && open) setOpen(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New reward
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New reward">
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="reward-name">Name</Label>
            <Input id="reward-name" name="name" required />
          </div>
          <div>
            <Label htmlFor="reward-description">Description</Label>
            <Textarea id="reward-description" name="description" rows={2} />
          </div>
          <div>
            <Label htmlFor="pointsCost">Points cost</Label>
            <Input id="pointsCost" name="pointsCost" type="number" min="1" required />
          </div>
          <div>
            <Label htmlFor="rewardType">Reward type</Label>
            <Select id="rewardType" name="rewardType" value={rewardType} onChange={(e) => setRewardType(e.target.value)}>
              <option value="DISCOUNT_PERCENT">Percentage discount</option>
              <option value="DISCOUNT_AMOUNT">Fixed amount discount</option>
              <option value="FREE_SERVICE">Free service</option>
              <option value="FREE_PRODUCT">Free product</option>
            </Select>
          </div>
          {rewardType === "DISCOUNT_PERCENT" && (
            <div>
              <Label htmlFor="discountPercent">Discount percent</Label>
              <Input id="discountPercent" name="discountPercent" type="number" min="1" max="100" required />
            </div>
          )}
          {rewardType === "DISCOUNT_AMOUNT" && (
            <div>
              <Label htmlFor="discountAmount">Discount amount (USD)</Label>
              <Input id="discountAmount" name="discountAmount" type="number" min="0.01" step="0.01" required />
            </div>
          )}
          {rewardType === "FREE_SERVICE" && (
            <div>
              <Label htmlFor="serviceId">Service</Label>
              <Select id="serviceId" name="serviceId" required>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {rewardType === "FREE_PRODUCT" && (
            <div>
              <Label htmlFor="productId">Product</Label>
              <Select id="productId" name="productId" required>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Create reward</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}

export function ArchiveRewardButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Archive className="h-4 w-4" />
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Archive reward?"
        confirmLabel="Archive"
        destructive
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            await archiveLoyaltyRewardAction(id);
            toast.success("Reward archived");
            setOpen(false);
          })
        }
      />
    </>
  );
}
