"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Panel, Pagination, Pill, Drawer } from "@/components/ui/primitives";
import { ClientItems } from "./client-items";
import { PersonalDiscount } from "./personal-discount";
import { ClientOrders } from "./client-orders";
import { ClientAccountPanel } from "./client-account";
import { ClientMembershipPanel } from "./client-membership";
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

export function ClientsTable({
  merchantId,
  canRefund,
  canEditAccount,
  canAdjustPoints,
  canManageMembership,
  currency,
  rows,
  q,
  sort,
  status,
  page,
  pageCount,
}: {
  merchantId: string;
  /** Passed down rather than guessed at: the server knows the permissions. */
  canRefund: boolean;
  /** Whether this staff member may move a client's balances. */
  canEditAccount: boolean;
  canAdjustPoints: boolean;
  canManageMembership: boolean;
  currency: string;
  rows: ClientRow[];
  q: string;
  sort: string;
  status: string;
  page: number;
  pageCount: number;
}) {
  const router = useRouter();
  const t = useTranslations("portal.clients.clientsTable");
  const locale = useLocale();
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-US", { dateStyle: "medium" }) : "-");
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
            placeholder={t("searchPlaceholder")}
            className="h-8 w-56 rounded-[10px] border border-border bg-surface pl-8 pr-3 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </form>
        <select
          value={status}
          onChange={(e) => navigate({ status: e.target.value, page: 1 })}
          className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none"
        >
          <option value="all">{t("all")}</option>
          <option value="client">{t("clients")}</option>
          <option value="lead">{t("leads")}</option>
        </select>
        <select
          value={sort}
          onChange={(e) => navigate({ sort: e.target.value, page: 1 })}
          className="h-8 rounded-[10px] border border-border bg-surface px-2 text-[12px] outline-none"
        >
          <option value="alphabetical">{t("alphabetical")}</option>
          <option value="newest">{t("newest")}</option>
          <option value="visits">{t("mostVisits")}</option>
          <option value="last-visit">{t("lastVisitSort")}</option>
        </select>
      </div>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState title={t("noClientsYet")} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-faint">
                    <th className="px-5 py-2.5 font-medium">{t("colName")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("colPhone")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("colEmail")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("colVisits")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("colLastVisit")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("colJoined")}</th>
                    <th className="px-5 py-2.5 font-medium">{t("colMembershipStatus")}</th>
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
                        {r.isMember ? <Pill tone="green">{t("member")}</Pill> : <Pill tone="neutral">{t("none")}</Pill>}
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

      <ClientDrawer
        merchantId={merchantId}
        canRefund={canRefund}
        canEditAccount={canEditAccount}
        canAdjustPoints={canAdjustPoints}
        canManageMembership={canManageMembership}
        currency={currency}
        client={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function ClientDrawer({
  merchantId,
  canRefund,
  canEditAccount,
  canAdjustPoints,
  canManageMembership,
  currency,
  client,
  onClose,
}: {
  merchantId: string;
  /** Whether this staff member may manage sales, and so refund. */
  canRefund: boolean;
  canEditAccount: boolean;
  canAdjustPoints: boolean;
  canManageMembership: boolean;
  currency: string;
  client: ClientRow | null;
  onClose: () => void;
}) {
  const t = useTranslations("portal.clients.clientsTable");
  const locale = useLocale();
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-US", { dateStyle: "medium" }) : "-");
  const [tab, setTab] = React.useState<"profile" | "account" | "membership" | "orders" | "items" | "messages">("profile");

  const TAB_LABEL: Record<typeof tab, string> = {
    profile: t("tabProfile"),
    account: t("tabAccount"),
    membership: t("tabMembership"),
    orders: t("tabOrders"),
    items: t("tabItems"),
    messages: t("tabMessages"),
  };

  React.useEffect(() => {
    if (client) setTab("profile");
  }, [client]);

  return (
    <Drawer open={!!client} onClose={onClose} title={client?.name ?? ""} subtitle={client?.email} width="max-w-[560px]">
      {client && (
        <>
          <div className="mb-4 flex gap-4 border-b border-border">
            {(["profile", "account", "membership", "orders", "items", "messages"] as const).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setTab(tabKey)}
                className={`-mb-px border-b-2 pb-2 text-[13px] ${
                  tab === tabKey ? "border-primary font-medium text-primary" : "border-transparent text-ink-muted"
                }`}
              >
                {TAB_LABEL[tabKey]}
              </button>
            ))}
          </div>

          {tab === "profile" ? (
            <dl className="space-y-3 text-[13px]">
              <Row label={t("colPhone")} value={dash(client.phone)} />
              <Row label={t("colVisits")} value={String(client.visits)} />
              <Row label={t("lastVisit")} value={date(client.lastVisit)} />
              <Row label={t("colJoined")} value={date(client.joined)} />
              <Row label={t("loyaltyPoints")} value={t("pointsValue", { points: client.points })} />
              <Row label={t("credit")} value={formatMoney(client.creditCents)} />
              <Row label={t("membership")} value={client.isMember ? t("active") : t("none")} />
            </dl>
          ) : tab === "account" ? (
            <ClientAccountPanel
              merchantId={merchantId}
              customerProfileId={client.id}
              currency={currency}
              canEdit={canEditAccount}
              canAdjustPoints={canAdjustPoints}
            />
          ) : tab === "membership" ? (
            <ClientMembershipPanel merchantId={merchantId} customerProfileId={client.id} canManage={canManageMembership} />
          ) : tab === "orders" ? (
            <ClientOrders merchantId={merchantId} customerProfileId={client.id} canRefund={canRefund} />
          ) : tab === "items" ? (
            <div className="space-y-4">
              <PersonalDiscount merchantId={merchantId} customerProfileId={client.id} clientName={client.name} />
              <ClientItems merchantId={merchantId} customerProfileId={client.id} />
            </div>
          ) : (
            <p className="py-8 text-center text-[12px] text-ink-muted">{t("noMessagesYet")}</p>
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
