"use client";

import { useActionState, useTransition, useRef, useEffect } from "react";
import { Textarea, FieldError, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  sendStaffMessageAction,
  assignConversationAction,
  updateConversationStatusAction,
  markConversationReadAction,
} from "@/lib/actions/messages";
import { toast } from "@/components/ui/toaster";
import type { StaffProfile } from "@prisma/client";

export function StaffMessageForm({ conversationId }: { conversationId: string }) {
  const action = sendStaffMessageAction.bind(null, conversationId);
  const [state, formAction] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state && "success" in state && state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <Textarea name="body" rows={2} placeholder="Reply to customer…" required />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" name="isInternalNote" /> Internal note only (not sent to customer)
        </label>
        <SubmitButton className="w-auto" size="sm">
          Send
        </SubmitButton>
      </div>
      <FieldError>{state?.error}</FieldError>
    </form>
  );
}

export function ConversationControls({ conversationId, staff, assignedStaffProfileId, status }: { conversationId: string; staff: StaffProfile[]; assignedStaffProfileId: string | null; status: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        defaultValue={assignedStaffProfileId ?? ""}
        disabled={pending}
        className="w-44"
        onChange={(e) =>
          startTransition(async () => {
            await assignConversationAction(conversationId, e.target.value);
            toast.success("Assigned");
          })
        }
      >
        <option value="">Unassigned</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.firstName} {s.lastName}
          </option>
        ))}
      </Select>
      <Select
        defaultValue={status}
        disabled={pending}
        className="w-32"
        onChange={(e) =>
          startTransition(async () => {
            await updateConversationStatusAction(conversationId, e.target.value as never);
            toast.success("Status updated");
          })
        }
      >
        <option value="OPEN">Open</option>
        <option value="PENDING">Pending</option>
        <option value="CLOSED">Closed</option>
      </Select>
    </div>
  );
}

export function MarkReadOnMount({ conversationId }: { conversationId: string }) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void markConversationReadAction(conversationId, "STAFF");
  }, [conversationId]);
  return null;
}
