"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormSection, SelectField, TextAreaField, TextField, type FieldErrors } from "@/components/merchant/form";
import { sendClinicBroadcastAction } from "@/lib/actions/clinic-broadcast";

/**
 * One notification to every client of this clinic who has turned notifications
 * on, on whatever devices they use.
 *
 * It is deliberately blunt — no segments, no scheduling. What it does have is
 * a count of the devices it actually reached, because "sent" on its own tells
 * a clinic nothing about whether anybody got it.
 */
export function BroadcastForm({ merchantId, devices, products }: { merchantId: string; devices: number; products: { id: string; name: string }[] }) {
  const [sending, setSending] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [sentTo, setSentTo] = React.useState<number | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setErrors({});
    const result = await sendClinicBroadcastAction(merchantId, new FormData(e.currentTarget));
    setSending(false);
    if ("error" in result) {
      setErrors(result.fieldErrors ?? {});
      toast.error(result.error);
      return;
    }
    setSentTo(result.devices);
    toast.success(result.devices === 1 ? "Sent to 1 device" : `Sent to ${result.devices} devices`);
    formRef.current?.reset();
  }

  return (
    <form ref={formRef} onSubmit={submit}>
      <FormSection title="Send a notification">
        <p className="text-[12px] text-ink-muted">
          {devices === 0
            ? "None of your clients have turned notifications on yet. They can, from the app's Home screen or Profile → Settings."
            : `${devices} ${devices === 1 ? "device has" : "devices have"} notifications on. Only your own clients are ever sent these.`}
        </p>
        <TextField label="Title" name="title" maxLength={60} placeholder="New in the shop" errors={errors} required />
        <TextAreaField
          label="Message"
          name="body"
          rows={3}
          maxLength={200}
          placeholder="Our new winter treatment is available to book from today."
          errors={errors}
          required
        />
        {products.length > 0 && (
          <SelectField
            label="Open a product (optional)"
            name="productId"
            errors={errors}
            options={[{ value: "", label: "Just open the shop" }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
          />
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={sending || devices === 0}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {sending ? "Sending…" : "Send now"}
          </Button>
          {sentTo !== null && (
            <span className="text-[12px] text-ink-muted">
              Last send reached {sentTo} {sentTo === 1 ? "device" : "devices"}.
            </span>
          )}
        </div>
        <p className="text-[12px] text-ink-muted">Up to 5 an hour, so a mistake can&apos;t become a stream of them.</p>
      </FormSection>
    </form>
  );
}
