"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, Pill } from "@/components/ui/primitives";
import { TextField, type FieldErrors } from "@/components/merchant/form";
import {
  inviteAdminAction,
  setAdminActiveAction,
  type InvitedAdmin,
} from "@/lib/actions/platform-admins";
import type { ActionResult } from "@/lib/merchant-action";

export interface AdminRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  lastLoginAt: string | null;
  twoFactorConfirmed: boolean;
}

export function AdminsSection({
  admins,
  currentUserId,
}: {
  admins: AdminRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [inviting, setInviting] = React.useState(false);
  const [invited, setInvited] = React.useState<InvitedAdmin | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>();
  const [pending, setPending] = React.useState(false);

  async function run(p: Promise<ActionResult>, success: string) {
    const res = await p;
    if ("error" in res) return toast.error(res.error);
    toast.success(success);
    router.refresh();
  }

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await inviteAdminAction(new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res) {
      setErrors(res.fieldErrors);
      return toast.error(res.error);
    }
    setErrors(undefined);
    setInvited({
      email: res.email,
      loginUrl: res.loginUrl,
      emailed: res.emailed,
    });
    router.refresh();
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div />
        <Button
          size="sm"
          onClick={() => {
            setInviting(true);
            setInvited(null);
            setErrors(undefined);
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Invite admin
        </Button>
      </div>
      <ul className="divide-y divide-border rounded-card border border-border">
        {admins.map((a) => {
          const name =
            a.firstName && a.lastName ? `${a.firstName} ${a.lastName}` : null;
          const isSelf = a.id === currentUserId;
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">
                  {name ?? a.email}
                </p>
                {name && (
                  <p className="truncate text-[11px] text-ink-muted">
                    {a.email}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {a.status === "INVITED" && <Pill tone="amber">Invited</Pill>}
                {a.status === "DISABLED" && (
                  <Pill tone="neutral">Disabled</Pill>
                )}
                {a.status === "ACTIVE" && (
                  <Pill tone={a.twoFactorConfirmed ? "primary" : "amber"}>
                    {a.twoFactorConfirmed ? "2FA on" : "2FA pending"}
                  </Pill>
                )}
                <span className="text-[11px] text-ink-faint">
                  {a.lastLoginAt
                    ? `Last seen ${new Date(a.lastLoginAt).toLocaleDateString("en-US", { dateStyle: "medium" })}`
                    : "Never signed in"}
                </span>
                {a.status !== "INVITED" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isSelf && a.status === "ACTIVE"}
                    title={
                      isSelf && a.status === "ACTIVE"
                        ? "You can't deactivate your own account"
                        : undefined
                    }
                    onClick={() =>
                      run(
                        setAdminActiveAction(a.id, a.status !== "ACTIVE"),
                        a.status === "ACTIVE"
                          ? "Access removed"
                          : "Access restored",
                      )
                    }
                  >
                    {a.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Drawer
        open={inviting}
        onClose={() => setInviting(false)}
        title={invited ? "Invitation sent" : "Invite admin"}
      >
        {invited ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              {invited.emailed
                ? `An invite email with a one-time link was sent to ${invited.email}.`
                : "The invite email could not be sent — share this link yourself. It works once, for 24 hours."}
            </p>
            {!invited.emailed && <CopyBox value={invited.loginUrl} />}
            <p className="text-[12px] text-ink-muted">
              The link works once, for 24 hours.
            </p>
            <Button onClick={() => setInviting(false)} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={invite} noValidate className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="First name"
                name="firstName"
                errors={errors}
                required
              />
              <TextField
                label="Last name"
                name="lastName"
                errors={errors}
                required
              />
            </div>
            <TextField
              label="Email"
              name="email"
              type="email"
              errors={errors}
              required
            />
            <Button type="submit" disabled={pending} className="w-full">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Send invite
            </Button>
          </form>
        )}
      </Drawer>
    </>
  );
}

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-border bg-app p-2">
      <code className="min-w-0 flex-1 truncate text-[12px]">{value}</code>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
