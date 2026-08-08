"use client";

import { useActionState } from "react";
import { Input, Label, Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";

export function LeadNoteFormClient({
  action,
  currentNotes,
}: {
  action: (prevState: unknown, formData: FormData) => Promise<{ error?: string; success?: boolean } | undefined>;
  currentNotes: string | null;
}) {
  const [state, formAction] = useActionState(action, undefined);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={currentNotes ?? ""} />
      </div>
      <div>
        <Label htmlFor="nextFollowUpAt">Next follow-up date</Label>
        <Input id="nextFollowUpAt" name="nextFollowUpAt" type="date" />
      </div>
      <FieldError>{state?.error}</FieldError>
      <SubmitButton className="w-auto">Save</SubmitButton>
    </form>
  );
}
