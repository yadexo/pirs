"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import { createCampaignAction, sendCampaignAction } from "@/lib/actions/notifications";
import { toast } from "@/components/ui/toaster";
import type { CustomerTag } from "@prisma/client";
import { Plus, Send } from "lucide-react";

export function NewCampaignForm({ tags }: { tags: CustomerTag[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createCampaignAction, undefined);
  const [segment, setSegment] = useState("ALL");
  if (state && "success" in state && state.success && open) setOpen(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New campaign
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New notification campaign">
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="name">Campaign name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="channel">Channel</Label>
              <Select id="channel" name="channel">
                <option value="IN_APP">In-app</option>
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="PUSH">Push</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="segment">Segment</Label>
              <Select id="segment" name="segment" value={segment} onChange={(e) => setSegment(e.target.value)}>
                <option value="ALL">All customers</option>
                <option value="NEW">New customers</option>
                <option value="MEMBERS">Members</option>
                <option value="NON_MEMBERS">Non-members</option>
                <option value="TAGGED">Tagged</option>
              </Select>
            </div>
          </div>
          {segment === "TAGGED" && (
            <div>
              <Label htmlFor="segmentTagId">Tag</Label>
              <Select id="segmentTagId" name="segmentTagId">
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="subject">Subject (email) / title</Label>
            <Input id="subject" name="subject" />
          </div>
          <div>
            <Label htmlFor="body">Message</Label>
            <Textarea id="body" name="body" rows={4} required />
          </div>
          <FieldError>{state?.error}</FieldError>
          <SubmitButton>Save as draft</SubmitButton>
        </form>
      </Dialog>
    </>
  );
}

export function SendCampaignButton({ campaignId }: { campaignId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await sendCampaignAction(campaignId);
          toast.success(`Sent to ${result.audienceSize} customer${result.audienceSize === 1 ? "" : "s"}`);
        })
      }
    >
      <Send className="h-4 w-4" /> Send now
    </Button>
  );
}
