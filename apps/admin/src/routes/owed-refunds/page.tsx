import { ArrowUturnLeft } from "@medusajs/icons"
import { Button, Container, Drawer, Heading, Label, Select, StatusBadge, Table, Text, Textarea, toast } from "@medusajs/ui"
import type { InferClientOutput } from "@mercurjs/client"
import type { RouteConfig } from "@mercurjs/dashboard-sdk"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { client } from "../../lib/client"

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the sidebar entry from this export
export const config: RouteConfig = {
  label: "Owed refunds",
  icon: ArrowUturnLeft,
  // The sidebar matches this against the parent item's path, not its id.
  nested: "/orders",
}

// eslint-disable-next-line react-refresh/only-export-components -- React Router reads the breadcrumb from this export
export const handle = {
  breadcrumb: () => "Owed refunds",
}

type OwedRefund = InferClientOutput<typeof client.admin.owedRefunds.query>["owed_refunds"][number]
type Method = "bank_transfer" | "other"

const QUERY_KEY = ["owed-refunds"]
const money = (amount: number, currency: string) => `${currency.toUpperCase()} ${amount.toLocaleString()}`

/**
 * Refunds orders owe their buyers that Paystack refused or can't make (#16): what each owes,
 * its failed attempts and Paystack's last word. Staff retry one now, or send it by hand and
 * mark it settled, which stops its retries.
 */
const OwedRefundsPage = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [settling, setSettling] = useState<OwedRefund | null>(null)
  const owed = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await client.admin.owedRefunds.query({})).owed_refunds,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  const retry = useMutation({
    mutationFn: async (orderId: string) => (await client.admin.owedRefunds.$id.retry.mutate({ $id: orderId })).owed_refund,
    onSuccess: (left) => {
      if (left) toast.warning(t("owedRefunds.stillOwed", { error: left.last_error ?? "" }))
      else toast.success(t("owedRefunds.refunded"))
      void refresh()
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading>{t("owedRefunds.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("owedRefunds.description")}
        </Text>
      </div>
      <div className="px-6 py-4">
        {owed.isError && (
          <Text size="small" className="text-ui-fg-error">
            {t("owedRefunds.loadError")}
          </Text>
        )}
        {owed.data && !owed.data.length && (
          <Text size="small" className="text-ui-fg-subtle">
            {t("owedRefunds.empty")}
          </Text>
        )}
        {owed.data && owed.data.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("owedRefunds.order")}</Table.HeaderCell>
                <Table.HeaderCell>{t("owedRefunds.buyer")}</Table.HeaderCell>
                <Table.HeaderCell>{t("owedRefunds.amount")}</Table.HeaderCell>
                <Table.HeaderCell>{t("owedRefunds.attempts")}</Table.HeaderCell>
                <Table.HeaderCell>{t("owedRefunds.lastError")}</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {owed.data.map((o) => (
                <Table.Row key={o.order_id} className="h-auto align-top">
                  <Table.Cell>
                    <Link to={`/orders/${o.order_id}`} className="text-ui-fg-interactive hover:underline">
                      #{o.display_id}
                    </Link>
                    {o.shop && <Text size="xsmall" className="text-ui-fg-subtle">{o.shop}</Text>}
                  </Table.Cell>
                  <Table.Cell className="whitespace-normal">
                    <Text size="small">{o.buyer.name ?? "–"}</Text>
                    {o.buyer.email && <Text size="xsmall" className="text-ui-fg-subtle">{o.buyer.email}</Text>}
                  </Table.Cell>
                  <Table.Cell>{money(o.amount, o.currency_code)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      {o.attempts}
                      <StatusBadge color={o.state === "manual" ? "orange" : "blue"}>{t(`owedRefunds.states.${o.state}`)}</StatusBadge>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-normal">
                    <Text size="small">{o.last_error ?? "–"}</Text>
                    {o.next_attempt_at && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {t("owedRefunds.nextAttempt", { at: new Date(o.next_attempt_at).toLocaleString() })}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex justify-end gap-x-2">
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={retry.isPending}
                        isLoading={retry.isPending && retry.variables === o.order_id}
                        onClick={() => retry.mutate(o.order_id)}
                      >
                        {t("owedRefunds.retry")}
                      </Button>
                      <Button size="small" variant="secondary" onClick={() => setSettling(o)}>
                        {t("owedRefunds.settle")}
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
      {settling && (
        <SettleDrawer
          owed={settling}
          onClose={() => setSettling(null)}
          onSettled={() => {
            setSettling(null)
            void refresh()
          }}
        />
      )}
    </Container>
  )
}

/** Records how Oja's team sent a refund by hand, with a note; it is then no longer retried. */
function SettleDrawer({ owed, onClose, onSettled }: Readonly<{ owed: OwedRefund; onClose: () => void; onSettled: () => void }>) {
  const { t } = useTranslation()
  const [method, setMethod] = useState<Method>("bank_transfer")
  const [note, setNote] = useState("")
  const settle = useMutation({
    mutationFn: async () => client.admin.owedRefunds.$id.settle.mutate({ $id: owed.order_id, method, note: note.trim() }),
    onSuccess: () => {
      toast.success(t("owedRefunds.settled"))
      onSettled()
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{t("owedRefunds.settleTitle", { order: owed.display_id })}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4">
          <Text size="small">{t("owedRefunds.settleAmount", { amount: money(owed.amount, owed.currency_code) })}</Text>
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="settle-method" size="small">
              {t("owedRefunds.method")}
            </Label>
            <Select value={method} onValueChange={(value) => setMethod(value as Method)}>
              <Select.Trigger id="settle-method">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="bank_transfer">{t("owedRefunds.methods.bank_transfer")}</Select.Item>
                <Select.Item value="other">{t("owedRefunds.methods.other")}</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="settle-note" size="small">
              {t("owedRefunds.note")}
            </Label>
            <Textarea
              id="settle-note"
              placeholder={t("owedRefunds.notePlaceholder")}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {t("owedRefunds.settleHint")}
          </Text>
        </Drawer.Body>
        <Drawer.Footer>
          <Button size="small" variant="secondary" onClick={onClose}>
            {t("owedRefunds.cancel")}
          </Button>
          <Button size="small" disabled={!note.trim() || settle.isPending} isLoading={settle.isPending} onClick={() => settle.mutate()}>
            {t("owedRefunds.settleConfirm")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

export default OwedRefundsPage
