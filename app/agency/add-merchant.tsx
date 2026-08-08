"use client";

import * as React from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useActionState } from "react";
import { Drawer } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { createMerchantAction } from "@/lib/actions/merchants";

const field =
  "h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary";
const label = "mb-1.5 block text-[12px] font-medium";

export function AddMerchantButton() {
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState(createMerchantAction, undefined);

  const created = state && "success" in state ? state : null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add Merchant
      </Button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={created ? "Merchant created" : "Add merchant"}
        subtitle={created ? undefined : "Creates the sub-account and its first owner login."}
      >
        {created ? (
          <div className="space-y-4">
            <p className="text-[13px] text-ink-muted">
              Share these one-time credentials with the merchant. The password is shown only once.
            </p>
            <div className="rounded-[10px] bg-app p-3 text-[12px]">
              <p>
                Email: <span className="font-mono">{created.email}</span>
              </p>
              <p className="mt-1">
                Temporary password: <span className="font-mono">{created.tempPassword}</span>
              </p>
            </div>
            <Link href={`/m/${created.merchantId}`} className="inline-block text-[13px] font-medium text-primary underline">
              Go to merchant →
            </Link>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <div>
              <label htmlFor="name" className={label}>
                Business name
              </label>
              <input id="name" name="name" required className={field} />
            </div>
            <div>
              <label htmlFor="contactEmail" className={label}>
                Contact email
              </label>
              <input id="contactEmail" name="contactEmail" type="email" required className={field} />
              <p className="mt-1 text-[11px] text-ink-muted">Becomes the owner login for this sub-account.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="phone" className={label}>
                  Phone
                </label>
                <input id="phone" name="phone" className={field} />
              </div>
              <div>
                <label htmlFor="country" className={label}>
                  Country
                </label>
                <input id="country" name="country" className={field} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="currency" className={label}>
                  Currency
                </label>
                <select id="currency" name="currency" defaultValue="EUR" className={field}>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <div>
                <label htmlFor="timezone" className={label}>
                  Timezone
                </label>
                <select id="timezone" name="timezone" defaultValue="Europe/Amsterdam" className={field}>
                  <option value="Europe/Amsterdam">Europe/Amsterdam</option>
                  <option value="Europe/London">Europe/London</option>
                  <option value="America/New_York">America/New_York</option>
                </select>
              </div>
            </div>
            {state && "error" in state && state.error && (
              <p className="text-[12px] text-[var(--accent-red)]">{state.error}</p>
            )}
            <Button type="submit" loading={pending} className="w-full">
              Create merchant
            </Button>
          </form>
        )}
      </Drawer>
    </>
  );
}
