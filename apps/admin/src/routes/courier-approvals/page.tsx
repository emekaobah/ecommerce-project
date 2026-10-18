import { TruckFast } from "@medusajs/icons"
import { Button, Container, Heading, Input, Label, Table, Text, toast } from "@medusajs/ui"
import type { RouteConfig } from "@mercurjs/dashboard-sdk"
import { formatMoney } from "@oja/domain"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { client } from "../../lib/client"

// eslint-disable-next-line react-refresh/only-export-components -- the dashboard SDK reads the sidebar entry from this export
export const config: RouteConfig = {
  label: "Courier approvals",
  icon: TruckFast,
  // The sidebar matches this against the parent item's path, not its id.
  nested: "/orders",
}

// eslint-disable-next-line react-refresh/only-export-components -- React Router reads the breadcrumb from this export
export const handle = {
  breadcrumb: () => "Courier approvals",
}

const QUERY_KEY = ["courier-approvals"]

/**
 * Couriers shops chose that cost more than the top-up cap above what the buyer paid for
 * delivery (#19), waiting for Oja's team: approving one books its label at its price now, paid
 * from the platform's wallet; declining one sends the shop back to choose another. Above them,
 * the cap itself, which Oja's team set.
 */
const CourierApprovalsPage = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const approvals = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => client.admin.courierApprovals.query({}),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  const decide = useMutation({
    mutationFn: ({ orderId, approve }: { orderId: string; approve: boolean }) =>
      approve
        ? client.admin.courierApprovals.$id.approve.mutate({ $id: orderId })
        : client.admin.courierApprovals.$id.decline.mutate({ $id: orderId }),
    onSuccess: (_, { approve }) => {
      toast.success(t(approve ? "courierApprovals.approved" : "courierApprovals.declined"))
      void refresh()
    },
    onError: (error) => {
      toast.error(error.message)
      void refresh()
    },
  })
  const waiting = approvals.data?.courier_approvals

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading>{t("courierApprovals.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("courierApprovals.description")}
        </Text>
      </div>
      {approvals.data && <TopUpCap cap={approvals.data.top_up_cap} onSaved={refresh} />}
      <div className="px-6 py-4">
        {approvals.isError && (
          <Text size="small" className="text-ui-fg-error">
            {t("courierApprovals.loadError")}
          </Text>
        )}
        {waiting && !waiting.length && (
          <Text size="small" className="text-ui-fg-subtle">
            {t("courierApprovals.empty")}
          </Text>
        )}
        {waiting && waiting.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("courierApprovals.order")}</Table.HeaderCell>
                <Table.HeaderCell>{t("courierApprovals.courier")}</Table.HeaderCell>
                <Table.HeaderCell>{t("courierApprovals.price")}</Table.HeaderCell>
                <Table.HeaderCell>{t("courierApprovals.difference")}</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {waiting.map((w) => (
                <Table.Row key={w.order_id} className="h-auto align-top">
                  <Table.Cell>
                    <Link to={`/orders/${w.order_id}`} className="text-ui-fg-interactive hover:underline">
                      #{w.display_id}
                    </Link>
                    {w.shop && <Text size="xsmall" className="text-ui-fg-subtle">{w.shop}</Text>}
                  </Table.Cell>
                  <Table.Cell className="whitespace-normal">
                    <Text size="small">{w.courier.courier_name}</Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t("courierApprovals.arrives", { at: new Date(w.courier.delivery_eta_time).toLocaleString() })}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{formatMoney(w.courier.amount, w.currency_code)}</Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {t("courierApprovals.paid", { amount: formatMoney(w.courier.checkout_amount, w.currency_code) })}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>{formatMoney(w.courier.difference, w.currency_code)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex justify-end gap-x-2">
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={decide.isPending}
                        isLoading={decide.isPending && decide.variables?.orderId === w.order_id && decide.variables.approve}
                        onClick={() => decide.mutate({ orderId: w.order_id, approve: true })}
                      >
                        {t("courierApprovals.approve")}
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={decide.isPending}
                        isLoading={decide.isPending && decide.variables?.orderId === w.order_id && !decide.variables.approve}
                        onClick={() => decide.mutate({ orderId: w.order_id, approve: false })}
                      >
                        {t("courierApprovals.decline")}
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

/** The top-up cap (#19): the most the platform pays above the buyer's delivery price for a shipment without approving it. */
function TopUpCap({ cap, onSaved }: Readonly<{ cap: number; onSaved: () => void }>) {
  const { t } = useTranslation()
  const [value, setValue] = useState(String(cap))
  const next = Number(value)
  const invalid = value.trim() === "" || !Number.isInteger(next) || next < 0
  const save = useMutation({
    mutationFn: () => client.admin.courierApprovals.cap.mutate({ top_up_cap: next }),
    onSuccess: () => {
      toast.success(t("courierApprovals.capSaved"))
      onSaved()
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <div className="flex flex-col gap-y-2 px-6 py-4">
      <Label htmlFor="top-up-cap" size="small" weight="plus">
        {t("courierApprovals.cap")}
      </Label>
      <div className="flex items-center gap-x-2">
        <Input id="top-up-cap" type="number" min={0} className="max-w-[200px]" value={value} onChange={(event) => setValue(event.target.value)} />
        <Button
          size="small"
          variant="secondary"
          disabled={invalid || next === cap || save.isPending}
          isLoading={save.isPending}
          onClick={() => save.mutate()}
        >
          {t("courierApprovals.saveCap")}
        </Button>
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        {t("courierApprovals.capHint")}
      </Text>
    </div>
  )
}

export default CourierApprovalsPage
