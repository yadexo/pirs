"use client";

import { useActionState } from "react";
import { updateNotificationPreferencesAction } from "@/lib/actions/notifications";
import { SubmitButton } from "@/components/auth/submit-button";
import type { CustomerProfile } from "@prisma/client";

export function PreferencesForm({ profile }: { profile: CustomerProfile }) {
  const [, formAction] = useActionState(updateNotificationPreferencesAction, undefined);

  return (
    <form action={formAction} className="space-y-3">
      <label className="flex items-center justify-between text-sm">
        Email notifications
        <input type="checkbox" name="emailConsent" defaultChecked={profile.emailConsent} />
      </label>
      <label className="flex items-center justify-between text-sm">
        SMS notifications
        <input type="checkbox" name="smsConsent" defaultChecked={profile.smsConsent} />
      </label>
      <label className="flex items-center justify-between text-sm">
        Push notifications
        <input type="checkbox" name="pushConsent" defaultChecked={profile.pushConsent} />
      </label>
      <label className="flex items-center justify-between text-sm">
        Marketing & promotions
        <input type="checkbox" name="marketingConsent" defaultChecked={profile.marketingConsent} />
      </label>
      <SubmitButton className="w-auto">Save preferences</SubmitButton>
    </form>
  );
}
