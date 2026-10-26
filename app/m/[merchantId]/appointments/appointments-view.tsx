"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, List, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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

const CHIP_KEYS = ["upcoming", "requested", "confirmed", "completed", "cancelled", "no-show"] as const;

const tone = (s: string) =>
  s === "CONFIRMED" ? "green" : s === "REQUESTED" ? "amber" : s === "CANCELLED" || s === "NO_SHOW" ? "red" : "neutral";

function when(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale === "nl" ? "nl-NL" : "en-US", { dateStyle: "medium", timeStyle: "short" });
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
  const t = useTranslations("portal.appointments");
  const locale = useLocale();
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
      toast.success(t("markedStatus", { status: t(`statusLabel.${next}`) }));
      setSelected(null);
    });
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {CHIP_KEYS.map((key) => (
            <Chip key={key} active={status === key} onClick={() => navigate({ status: key })}>
              {t(`chips.${key}`)}
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
              placeholder={t("search")}
              className="h-8 w-44 rounded-[10px] border border-border bg-surface pl-8 pr-3 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </form>
          <div className="flex overflow-hidden rounded-[10px] border border-border">
            <button
              type="button"
              aria-label={t("listView")}
              onClick={() => navigate({ view: "list" })}
              className={cn("px-2 py-1.5", view === "list" ? "bg-primary-soft text-primary" : "text-ink-faint")}
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={t("calendarView")}
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
            <EmptyState title={t("noAppointmentsAvailable")} />
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
                      {when(a.startAt, locale)} · {a.staff} · {a.location}
                    </p>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Pill tone={tone(a.status)}>{t(`statusLabel.${a.status}`)}</Pill>
                    {a.status === "REQUESTED" && (
                      <>
                        <Button size="sm" loading={pending} onClick={() => act(a.id, "CONFIRMED")}>
                          {t("confirm")}
                        </Button>
                        <Button size="sm" variant="outline" loading={pending} onClick={() => act(a.id, "CANCELLED")}>
                          {t("decline")}
                        </Button>
                      </>
                    )}
                    {a.status === "CONFIRMED" && (
                      <>
                        <Button size="sm" loading={pending} onClick={() => act(a.id, "COMPLETED")}>
                          {t("complete")}
                        </Button>
                        <Button size="sm" variant="outline" loading={pending} onClick={() => act(a.id, "NO_SHOW")}>
                          {t("noShow")}
                        </Button>
                        <Button size="sm" variant="ghost" loading={pending} onClick={() => act(a.id, "CANCELLED")}>
                          {t("cancel")}
                        </Button>
                      </>
                    )}
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        ) : (
          <CalendarView appointments={appointments} onSelect={setSelected} locale={locale} />
        )}
      </div>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.client} · ${selected.service}` : ""}
        subtitle={selected ? when(selected.startAt, locale) : undefined}
      >
        {selected && (
          <dl className="space-y-3 text-[13px]">
            <Row label={t("status")} value={t(`statusLabel.${selected.status}`)} />
            <Row label={t("staff")} value={selected.staff} />
            <Row label={t("location")} value={selected.location} />
            <Row label={t("ends")} value={when(selected.endAt, locale)} />
            <Row label={t("notes")} value={selected.notes || "-"} />
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
  locale,
}: {
  appointments: AppointmentRow[];
  onSelect: (a: AppointmentRow) => void;
  locale: string;
}) {
  const intlLocale = locale === "nl" ? "nl-NL" : "en-US";
  const byDay = new Map<string, AppointmentRow[]>();
  for (const a of appointments) {
    const key = new Date(a.startAt).toLocaleDateString(intlLocale, { weekday: "long", month: "short", day: "numeric" });
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
                    {new Date(a.startAt).toLocaleTimeString(intlLocale, locale === "nl" ? { hour: "2-digit", minute: "2-digit" } : { hour: "numeric", minute: "2-digit" })} · {a.client}
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
