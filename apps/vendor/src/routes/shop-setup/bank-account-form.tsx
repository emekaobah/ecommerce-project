import { Button, Container, Heading, Input, Label, Select, Text } from "@medusajs/ui"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { client } from "../../lib/client"
import type { Bank, Onboarding } from "./types"

/**
 * The account the shop is paid into. Paystack resolves the number at the bank to the holder's
 * name, which is shown once saved; a number the bank doesn't have is refused with the reason.
 */
export const BankAccountForm = ({
  onboarding,
  onSaved,
}: {
  onboarding: Onboarding
  onSaved: (onboarding: Onboarding) => void
}) => {
  const { t } = useTranslation()
  const account = onboarding.bank_account
  const [bankCode, setBankCode] = useState(account?.bank_code ?? "")
  const [accountNumber, setAccountNumber] = useState(account?.account_number ?? "")
  const banks = useQuery<Bank[]>({
    queryKey: ["onboarding-banks"],
    queryFn: async () => (await client.vendor.onboarding.banks.query()).banks,
  })
  const save = useMutation({
    mutationFn: async () =>
      (await client.vendor.onboarding.bankAccount.mutate({ bank_code: bankCode, account_number: accountNumber.trim() }))
        .onboarding,
    onSuccess: onSaved,
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{t("shopSetup.steps.bank_account")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {account
            ? t("shopSetup.bank.resolved", { name: account.account_name, bank: account.bank_name })
            : t("shopSetup.bank.description")}
        </Text>
      </div>
      <form
        className="grid max-w-2xl grid-cols-1 gap-4 px-6 py-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <div className="flex flex-col gap-y-2">
          <Label htmlFor="bank-code" weight="plus">
            {t("shopSetup.bank.bank")}
          </Label>
          <Select value={bankCode} onValueChange={setBankCode} disabled={!banks.data}>
            <Select.Trigger id="bank-code">
              <Select.Value placeholder={t("shopSetup.choose")} />
            </Select.Trigger>
            <Select.Content>
              {banks.data?.map((bank) => (
                <Select.Item key={bank.code} value={bank.code}>
                  {bank.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div className="flex flex-col gap-y-2">
          <Label htmlFor="account-number" weight="plus">
            {t("shopSetup.bank.accountNumber")}
          </Label>
          <Input
            id="account-number"
            inputMode="numeric"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
          />
        </div>
        {(banks.isError || save.isError) && (
          <Text size="small" className="text-ui-fg-error md:col-span-2">
            {(save.error ?? banks.error)?.message}
          </Text>
        )}
        <div className="md:col-span-2">
          <Button type="submit" size="small" isLoading={save.isPending} disabled={!bankCode || !accountNumber.trim()}>
            {t("shopSetup.bank.save")}
          </Button>
        </div>
      </form>
    </Container>
  )
}
