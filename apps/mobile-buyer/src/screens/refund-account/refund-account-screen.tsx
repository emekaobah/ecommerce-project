import { useAuth } from '@clerk/expo';
import { formatMoney } from '@oja/domain';
import { Button, ErrorState, line, ListRow, LoadingState, MAX_FONT_SCALE, RadioOption, Text, useTheme } from '@oja/ui';
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
      return <ErrorState title="Refund not found" body="This refund isn't one of yours." />;
    }
    return <ErrorState title="Couldn't load this refund" body="Check your connection and try again. Your refund is safe." error={refund.error} onRetry={() => void refund.refetch()} />;
  }
  if (!refund.data) return <LoadingState />;
  return refund.data.needs_account ? <AccountForm refund={refund.data} /> : <RefundState refund={refund.data} />;
}

/** What the buyer is told of a refund that doesn't need an account (any more). */
function refundMessage(refund: BuyerRefund): string {
  const amount = formatMoney(refund.amount, refund.currency_code);
  if (refund.handed_over) {
    return `Our team is sending your ${amount} refund for order #${refund.order.display_id}, and will contact you if they need your details.`;
  }
  if (refund.account) {
    return `Your ${amount} refund is on its way to your ${refund.account.bank_name} account ending ${refund.account.last4}.`;
  }
  return refund.status === 'processed' ? `Your ${amount} refund has reached you.` : `Your ${amount} refund is on its way.`;
}

/** Where a refund that doesn't need an account (any more) is. */
function RefundState({ refund }: Readonly<{ refund: BuyerRefund }>) {
  const theme = useTheme();
  const groupId = refund.order.order_group_id;
  return (
    <View style={{ flex: 1, padding: theme.space[4], gap: theme.space[6], backgroundColor: theme.colors.bg }}>
      <Text variant="heading">{`Refund for order #${refund.order.display_id}`}</Text>
      <Text>{refundMessage(refund)}</Text>
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
  const [accountNumber, setAccountNumber] = useState('');

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
  const inputStyle = useInputStyle();

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.bg }}
      contentContainerStyle={{ padding: theme.space[4], gap: theme.space[6], paddingBottom: theme.space[12] }}
      keyboardShouldPersistTaps="handled">
      <View style={{ gap: theme.space[1] }}>
        <Text variant="heading">{`Your ${amount} refund`}</Text>
        <Text tone="muted">
          {`Your bank couldn't take the refund for order #${refund.order.display_id} from ${refund.order.shop} back to your card. Add a bank account and we'll send it there. It can be anyone's account: you'll see the name on it before it's sent.`}
        </Text>
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="strong">Bank</Text>
        <BankField banks={banks} bankCode={bankCode} onChoose={(code) => change(() => setBankCode(code))} />
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="strong">Account number</Text>
        <TextInput
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          value={accountNumber}
          onChangeText={(text) => change(() => setAccountNumber(text.replace(/\D/g, '').slice(0, ACCOUNT_LENGTH)))}
          placeholder="10 digits"
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel="Account number"
          keyboardType="number-pad"
          textContentType="none"
          autoComplete="off"
          maxLength={ACCOUNT_LENGTH}
          style={inputStyle}
        />
      </View>

      {confirming && input ? (
        <ConfirmAccount
          account={confirming}
          last4={accountNumber.slice(-4)}
          amount={amount}
          retry={retry}
          onSend={() => retry.mutate(input)}
          onChange={() => change(() => {})}
        />
      ) : (
        <View style={{ gap: theme.space[4] }}>
          {resolve.error ? (
            <Text tone="muted" accessibilityLiveRegion="polite">
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

/** The account Paystack named, for the buyer to confirm before the refund is sent to it. */
function ConfirmAccount({
  account,
  last4,
  amount,
  retry,
  onSend,
  onChange,
}: Readonly<{
  account: { account_name: string; bank_name: string };
  last4: string;
  amount: string;
  retry: ReturnType<typeof useRetryRefund>;
  onSend: () => void;
  onChange: () => void;
}>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[4] }}>
      <View
        style={{
          gap: theme.space[1],
          padding: theme.space[4],
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.ink,
        }}>
        <Text variant="strong">{account.account_name}</Text>
        <Text tone="muted">{`${account.bank_name}, account ending ${last4}`}</Text>
      </View>
      <Text tone="muted">{`Is this the account to send your ${amount} refund to?`}</Text>
      {retry.error ? (
        <Text tone="muted" accessibilityLiveRegion="polite">
          {`Couldn't send your refund: ${retry.error.message}`}
        </Text>
      ) : null}
      <Button label={`Send ${amount} to this account`} loading={retry.isPending} onPress={onSend} />
      <Button label="Change the details" variant="secondary" disabled={retry.isPending} onPress={onChange} />
    </View>
  );
}

/** The style of the screen's text inputs. */
function useInputStyle() {
  const theme = useTheme();
  return [
    styles.input,
    theme.type.body,
    {
      minHeight: theme.hitArea,
      borderRadius: theme.radius.md,
      borderColor: theme.colors.control,
      paddingHorizontal: theme.space[4],
      color: theme.colors.ink,
    },
  ];
}

/** The bank the refund goes to: the one chosen, or Paystack's banks to search and choose from. */
function BankField({
  banks,
  bankCode,
  onChoose,
}: Readonly<{ banks: ReturnType<typeof useRefundBanks>; bankCode: string | null; onChoose: (code: string) => void }>) {
  const theme = useTheme();
  const inputStyle = useInputStyle();
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState('');

  if (banks.error && !banks.data) {
    return <ErrorState title="Couldn't load the banks" body="Check your connection and try again. Your refund is safe." error={banks.error} onRetry={() => void banks.refetch()} />;
  }
  if (!choosing) {
    const bank = banks.data?.find((b) => b.code === bankCode) ?? null;
    return (
      <ListRow title={bank?.name ?? 'Choose your bank'} trailing={<Text tone="accent">{bank ? 'Change' : 'Choose'}</Text>} onPress={() => setChoosing(true)} />
    );
  }
  const matching = (banks.data ?? []).filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <View style={{ gap: theme.space[2] }}>
      <TextInput
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        value={search}
        onChangeText={setSearch}
        placeholder="Search banks"
        placeholderTextColor={theme.colors.muted}
        accessibilityLabel="Search banks"
        autoFocus
        style={inputStyle}
      />
      {banks.data ? null : <LoadingState />}
      {matching.map((b) => (
        <RadioOption
          key={b.code}
          selected={b.code === bankCode}
          onPress={() => {
            onChoose(b.code);
            setChoosing(false);
            setSearch('');
          }}>
          <Text>{b.name}</Text>
        </RadioOption>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: line.input },
});
