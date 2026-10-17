import { useAuth } from '@clerk/expo';
import { formatMoney } from '@oja/domain';
import { Button, ErrorState, ListRow, LoadingState, RadioOption, Text, useTheme } from '@oja/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { isNotFound } from '@/api/errors';
import {
  useRefund,
  useRefundBanks,
  useResolveRefundAccount,
  useRetryRefund,
  type BuyerRefund,
  type RefundAccountInput,
} from '@/api/refunds';

/** A NUBAN account number is 10 digits. */
const ACCOUNT_LENGTH = 10;

/**
 * A refund Paystack couldn't return to the buyer's card (#13), opened from the push or email
 * asking for a bank account. The buyer picks their bank and enters an account number; Paystack
 * names the account's holder, and once the buyer confirms it the refund is sent there. Anyone's
 * account will do. The account number lives in this screen only: it goes to the API and on to
 * Paystack, and is never kept.
 */
export function RefundAccountScreen({ refundId }: Readonly<{ refundId: string }>) {
  const { userId } = useAuth();
  const refund = useRefund(userId, refundId);

  if (refund.error && !refund.data) {
    if (isNotFound(refund.error)) {
      return <ErrorState title="Refund not found" message="This refund isn't one of yours." />;
    }
    return <ErrorState title="Couldn't load this refund" message={refund.error.message} onRetry={() => void refund.refetch()} />;
  }
  if (!refund.data) return <LoadingState />;
  return refund.data.needs_account ? <AccountForm refund={refund.data} /> : <RefundState refund={refund.data} />;
}

/** Where a refund that doesn't need an account (any more) is. */
function RefundState({ refund }: Readonly<{ refund: BuyerRefund }>) {
  const theme = useTheme();
  const amount = formatMoney(refund.amount, refund.currency_code);
  const message = refund.handed_over
    ? `Our team is sending your ${amount} refund for order #${refund.order.display_id}, and will contact you if they need your details.`
    : refund.account
      ? `Your ${amount} refund is on its way to your ${refund.account.bank_name} account ending ${refund.account.last4}.`
      : refund.status === 'processed'
        ? `Your ${amount} refund has reached you.`
        : `Your ${amount} refund is on its way.`;
  const groupId = refund.order.order_group_id;
  return (
    <View style={{ flex: 1, padding: theme.space.md, gap: theme.space.lg, backgroundColor: theme.colors.background }}>
      <Text variant="heading">{`Refund for order #${refund.order.display_id}`}</Text>
      <Text>{message}</Text>
      {groupId ? <Button label="View the order" variant="secondary" onPress={() => router.replace(`/order/${groupId}`)} /> : null}
    </View>
  );
}

function AccountForm({ refund }: Readonly<{ refund: BuyerRefund }>) {
  const theme = useTheme();
  const { userId } = useAuth();
  const banks = useRefundBanks(userId, refund.id);
  const resolve = useResolveRefundAccount(refund.id);
  const retry = useRetryRefund(userId, refund.id);
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [choosingBank, setChoosingBank] = useState(false);
  const [search, setSearch] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  const bank = banks.data?.find((b) => b.code === bankCode) ?? null;
  const input: RefundAccountInput | null =
    bankCode && accountNumber.length === ACCOUNT_LENGTH ? { bank_code: bankCode, account_number: accountNumber } : null;
  const confirming = resolve.data && !resolve.isPending ? resolve.data : null;
  const amount = formatMoney(refund.amount, refund.currency_code);

  // Any change to the details asks Paystack for the holder's name again.
  const change = (update: () => void) => {
    resolve.reset();
    retry.reset();
    update();
  };
  const matching = (banks.data ?? []).filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase()));
  const inputStyle = [
    styles.input,
    theme.type.body,
    {
      minHeight: theme.touchTarget,
      borderRadius: theme.radius.md,
      borderColor: theme.colors.divider,
      paddingHorizontal: theme.space.md,
      color: theme.colors.ink,
      fontFamily: theme.fontFamily,
    },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.space.md, gap: theme.space.lg, paddingBottom: theme.space.xxl }}
      keyboardShouldPersistTaps="handled">
      <View style={{ gap: theme.space.xs }}>
        <Text variant="heading">{`Your ${amount} refund`}</Text>
        <Text tone="secondary">
          {`Your bank couldn't take the refund for order #${refund.order.display_id} from ${refund.order.shop} back to your card. Add a bank account and we'll send it there. It can be anyone's account: you'll see the name on it before it's sent.`}
        </Text>
      </View>

      <View style={{ gap: theme.space.sm }}>
        <Text variant="label">Bank</Text>
        {banks.error && !banks.data ? (
          <ErrorState title="Couldn't load the banks" message={banks.error.message} onRetry={() => void banks.refetch()} />
        ) : choosingBank ? (
          <View style={{ gap: theme.space.sm }}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search banks"
              placeholderTextColor={theme.colors.textSecondary}
              accessibilityLabel="Search banks"
              autoFocus
              style={inputStyle}
            />
            {banks.data ? null : <LoadingState />}
            {matching.map((b) => (
              <RadioOption
                key={b.code}
                selected={b.code === bankCode}
                onPress={() =>
                  change(() => {
                    setBankCode(b.code);
                    setChoosingBank(false);
                    setSearch('');
                  })
                }>
                <Text>{b.name}</Text>
              </RadioOption>
            ))}
          </View>
        ) : (
          <ListRow title={bank?.name ?? 'Choose your bank'} trailing={<Text tone="accent">{bank ? 'Change' : 'Choose'}</Text>} onPress={() => setChoosingBank(true)} />
        )}
      </View>

      <View style={{ gap: theme.space.sm }}>
        <Text variant="label">Account number</Text>
        <TextInput
          value={accountNumber}
          onChangeText={(text) => change(() => setAccountNumber(text.replace(/\D/g, '').slice(0, ACCOUNT_LENGTH)))}
          placeholder="10 digits"
          placeholderTextColor={theme.colors.textSecondary}
          accessibilityLabel="Account number"
          keyboardType="number-pad"
          textContentType="none"
          autoComplete="off"
          maxLength={ACCOUNT_LENGTH}
          style={inputStyle}
        />
      </View>

      {confirming && input ? (
        <View style={{ gap: theme.space.md }}>
          <View
            style={{
              gap: theme.space.xs,
              padding: theme.space.md,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.ink,
            }}>
            <Text variant="label">{confirming.account_name}</Text>
            <Text tone="secondary">{`${confirming.bank_name}, account ending ${accountNumber.slice(-4)}`}</Text>
          </View>
          <Text tone="secondary">{`Is this the account to send your ${amount} refund to?`}</Text>
          {retry.error ? (
            <Text tone="secondary" accessibilityLiveRegion="polite">
              {`Couldn't send your refund: ${retry.error.message}`}
            </Text>
          ) : null}
          <Button label={`Send ${amount} to this account`} loading={retry.isPending} onPress={() => retry.mutate(input)} />
          <Button label="Change the details" variant="secondary" disabled={retry.isPending} onPress={() => change(() => {})} />
        </View>
      ) : (
        <View style={{ gap: theme.space.md }}>
          {resolve.error ? (
            <Text tone="secondary" accessibilityLiveRegion="polite">
              {resolve.error.message}
            </Text>
          ) : null}
          <Button
            label="Check the account"
            disabled={!input}
            loading={resolve.isPending}
            onPress={() => {
              if (input) resolve.mutate(input);
            }}
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1 },
});
