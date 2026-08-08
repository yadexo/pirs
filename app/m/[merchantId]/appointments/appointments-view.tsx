"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, List, Search } from "lucide-react";
import { Panel, Chip, Pill, Drawer } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { updateAppointmentStatusAction } from "@/lib/actions/appointments";
import { cn } from "@/lib/utils";

export interface AppointmentRow {
  id: string;
  client: string;
  service: string;
  staff: string;
  location: string;
  startAt: string;
  endAt: string;
  status: string;
  notes: string | null;
}

const CHIPS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "requested", label: "Requested" },
  { key: "confirmed", label: "Confirmed" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "no-show", label: "No-show" },
];

const tone = (s: string) =>
  s === "CONFIRMED" ? "green" : s === "REQUESTED" ? "amber" : s === "CANCELLED" || s === "NO_SHOW" ? "red" : "neutral";

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function AppointmentsView({
  merchantId,
  status,
  view,
  q,
  appointments,
}: {
  merchantId: string;
  status: string;
  view: "list" | "calendar";
  q: string;
  appointments: AppointmentRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<AppointmentRow | null>(null);
  const [pending, startTransition] = React.useTransition();

  function navigate(next: Partial<{ status: string; view: string; q: string }>) {
    const merged = { status, view, q, ...next };
    const sp = new URLSearchParams();
    if (merged.status !== "upcoming") sp.set("status", merged.status);
    if (merged.view !== "list") sp.set("view", merged.view);
    if (merged.q) sp.set("q", merged.q);
    router.push(`/m/${merchantId}/appointments${sp.toString() ? `?${sp}` : ""}`);
  }

  function act(id: string, next: "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW") {
    startTransition(async () => {
      await updateAppointmentStatusAction(id, next);
      toast.success(`Marked ${next.toLowerCase().replace("_", "-")}`);
      setSelected(null);
    });
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {CHIPS.map((c) => (
            <Chip key={c.key} active={status === c.key} onClick={() => navigate({ status: c.key })}>
              {c.label}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ q: new FormData(e.currentTarget).get("q") as string });
            }}
            className="relative"
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search..."
              className="h-8 w-44 rounded-[10px] border border-border bg-surface pl-8 pr-3 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </form>
          <div className="flex overflow-hidden rounded-[10px] border border-border">
            <button
              type="button"
              aria-label="List view"
              onClick={() => navigate({ view: "list" })}
              className={cn("px-2 py-1.5", view === "list" ? "bg-primary-soft text-primary" : "text-ink-faint")}
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Calendar view"
              onClick={() => navigate({ view: "calendar" })}
              className={cn("px-2 py-1.5", view === "calendar" ? "bg-primary-soft text-primary" : "text-ink-faint")}
            >
              <CalendarRange className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3">
        {appointments.length === 0 ? (
          <Panel>
            <EmptyState title="No appointments available" />
          </Panel>
        ) : view === "list" ? (
          <ul className="space-y-2">
            {appointments.map((a) => (
              <li key={a.id}>
                <Panel
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-app"
                  onClick={() => setSelected(a)}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">
                      {a.client} · {a.service}
                    </p>
                    <p className="truncate text-[11px] text-ink-muted">
                      {when(a.startAt)} · {a.staff} · {a.location}
                    </p>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Pill tone={tone(a.status)}>{a.status}</Pill>
                    {a.status === "REQUESTED" && (
                      <>
                        <Button size="sm" loading={pending} onClick={() => act(a.id, "CONFIRMED")}>
                          Confirm
                        </Button>
                        <Button size="sm" variant="outline" loading={pending} onClick={() => act(a.id, "CANCELLED")}>
                          Decline
                        </Button>
                      </>
                    )}
                    {a.status === "CONFIRMED" && (
                      <>
                        <Button size="sm" loading={pending} onClick={() => act(a.id, "COMPLETED")}>
                          Complete
                        </Button>
                        <Button size="sm" variant="outline" loading={pending} onClick={() => act(a.id, "NO_SHOW")}>
                          No-show
                        </Button>
                        <Button size="sm" variant="ghost" loading={pending} onClick={() => act(a.id, "CANCELLED")}>
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        ) : (
          <CalendarView appointments={appointments} onSelect={setSelected} />
        )}
      </div>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.client} · ${selected.service}` : ""}
        subtitle={selected ? when(selected.startAt) : undefined}
      >
        {selected && (
          <dl className="space-y-3 text-[13px]">
            <Row label="Status" value={selected.status} />
            <Row label="Staff" value={selected.staff} />
            <Row label="Location" value={selected.location} />
            <Row label="Ends" value={when(selected.endAt)} />
            <Row label="Notes" value={selected.notes || "-"} />
          </dl>
        )}
      </Drawer>
    </>
  );
}

/** Simple day-grouped calendar. Same data, same drawer — just a second rendering. */
function CalendarView({
  appointments,
  onSelect,
}: {
  appointments: AppointmentRow[];
  onSelect: (a: AppointmentRow) => void;
}) {
  const byDay = new Map<string, AppointmentRow[]>();
  for (const a of appointments) {
    const key = new Date(a.startAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    byDay.set(key, [...(byDay.get(key) ?? []), a]);
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {[...byDay.entries()].map(([day, items]) => (
        <Panel key={day} className="p-4">
          <p className="mb-2 text-[12px] font-medium text-ink-muted">{day}</p>
          <ul className="space-y-1.5">
            {items.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onSelect(a)}
                  className="w-full rounded-[10px] border border-border px-3 py-2 text-left hover:bg-app"
                >
                  <p className="text-[12px] font-medium">
                    {new Date(a.startAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {a.client}
                  </p>
                  <p className="text-[11px] text-ink-muted">{a.service}</p>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
