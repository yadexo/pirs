"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Panel, Pagination, Pill, Drawer } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/utils";

export interface ClientRow {
  id: string;
  name: string;
  phone: string | null;
  email: string;
  visits: number;
  lastVisit: string | null;
  joined: string;
  isMember: boolean;
  points: number;
  creditCents: number;
}

const dash = (v: string | null | undefined) => (v && v.length > 0 ? v : "-");
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" }) : "-");

export function ClientsTable({
  merchantId,
  rows,
  q,
  sort,
  status,
  page,
  pageCount,
}: {
  merchantId: string;
  rows: ClientRow[];
  q: string;
  sort: string;
  status: string;
  page: number;
  pageCount: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<ClientRow | null>(null);

  function navigate(next: Partial<{ q: string; sort: string; status: string; page: number }>) {
    const sp = new URLSearchParams();
    const merged = { q, sort, status, page, ...next };
    if (merged.q) sp.set("q", merged.q);
    if (merged.sort !== "alphabetical") sp.set("sort", merged.sort);
    if (merged.status !== "all") sp.set("status", merged.status);
    if (merged.page > 1) sp.set("page", String(merged.page));
    router.push(`/m/${merchantId}/clients${sp.toString() ? `?${sp}` : ""}`);
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ q: new FormData(e.currentTarget).get("q") as string, page: 1 });
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search clients..."
            className="h-8 w-56 rounded-[10px] border border-border bg-surface pl-8 pr-3 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </form>
        <select
          value={status}
          onChange={(e) => navigate({ status: e.target.value, page: 1 })}
          className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none"
        >
          <option value="all">All</option>
          <option value="client">Clients</option>
          <option value="lead">Leads</option>
        </select>
        <select
          value={sort}
          onChange={(e) => navigate({ sort: e.target.value, page: 1 })}
          className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none"
        >
          <option value="alphabetical">Alphabetical</option>
          <option value="newest">Newest</option>
          <option value="visits">Most visits</option>
          <option value="last-visit">Last visit</option>
        </select>
      </div>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState title="No clients yet" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-faint">
                    <th className="px-5 py-2.5 font-medium">Name</th>
                    <th className="px-5 py-2.5 font-medium">Phone</th>
                    <th className="px-5 py-2.5 font-medium">Email</th>
                    <th className="px-5 py-2.5 font-medium">Visits</th>
                    <th className="px-5 py-2.5 font-medium">Last Visit</th>
                    <th className="px-5 py-2.5 font-medium">Joined</th>
                    <th className="px-5 py-2.5 font-medium">Membership Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="cursor-pointer border-b border-border text-[12px] last:border-b-0 hover:bg-app"
                    >
                      <td className="px-5 py-3 font-semibold">{r.name}</td>
                      <td className="px-5 py-3 text-ink-muted">{dash(r.phone)}</td>
                      <td className="px-5 py-3 text-ink-muted">{dash(r.email)}</td>
                      <td className="tabular px-5 py-3">{r.visits}</td>
                      <td className="px-5 py-3 text-ink-muted">{date(r.lastVisit)}</td>
                      <td className="px-5 py-3 text-ink-muted">{date(r.joined)}</td>
                      <td className="px-5 py-3">
                        {r.isMember ? <Pill tone="green">Member</Pill> : <Pill tone="neutral">None</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount} onPage={(p) => navigate({ page: p })} />
          </>
        )}
      </Panel>

      <ClientDrawer client={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ClientDrawer({ client, onClose }: { client: ClientRow | null; onClose: () => void }) {
  const [tab, setTab] = React.useState<"profile" | "messages">("profile");

  React.useEffect(() => {
    if (client) setTab("profile");
  }, [client]);

  return (
    <Drawer open={!!client} onClose={onClose} title={client?.name ?? ""} subtitle={client?.email} width="max-w-xl">
      {client && (
        <>
          <div className="mb-4 flex gap-4 border-b border-border">
            {(["profile", "messages"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 pb-2 text-[13px] capitalize ${
                  tab === t ? "border-primary font-medium text-primary" : "border-transparent text-ink-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "profile" ? (
            <dl className="space-y-3 text-[13px]">
              <Row label="Phone" value={dash(client.phone)} />
              <Row label="Visits" value={String(client.visits)} />
              <Row label="Last visit" value={date(client.lastVisit)} />
              <Row label="Joined" value={date(client.joined)} />
              <Row label="Loyalty points" value={`${client.points} pts`} />
              <Row label="Account credit" value={formatMoney(client.creditCents)} />
              <Row label="Membership" value={client.isMember ? "Active" : "None"} />
            </dl>
          ) : (
            <p className="py-8 text-center text-[12px] text-ink-muted">No messages yet</p>
          )}
        </>
      )}
    </Drawer>
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
