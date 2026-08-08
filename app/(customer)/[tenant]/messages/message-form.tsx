"use client";

import { useActionState, useRef, useEffect } from "react";
import { sendCustomerMessageAction } from "@/lib/actions/messages";
import { Textarea, FieldError } from "@/components/ui/input";
import { SubmitButton } from "@/components/auth/submit-button";

export function MessageForm({ tenantSlug, conversationId }: { tenantSlug: string; conversationId: string }) {
  const action = sendCustomerMessageAction.bind(null, tenantSlug, conversationId);
  const [state, formAction] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state && "success" in state && state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex items-end gap-2">
      <Textarea name="body" rows={2} placeholder="Type a message…" required className="flex-1" />
      <SubmitButton className="w-auto">Send</SubmitButton>
      {state?.error && <FieldError>{state.error}</FieldError>}
    </form>
  );
}
