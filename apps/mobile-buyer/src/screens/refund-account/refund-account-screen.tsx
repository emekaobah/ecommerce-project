import { useAuth } from '@clerk/expo';
import { formatMoney, refundForNote, type StatusChipView } from '@oja/domain';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  InlineNote,
  PressableSurface,
  ShopMark,
  Skeleton,
  StatusChip,
  StickyAction,
  Text,
  TextField,
  useTheme,
} from '@oja/ui';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isNotFound, useFailureMessage } from '@/api/errors';
import { useOrderGroup } from '@/api/orders';
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
 * asking for a bank account, or from the order. The buyer picks their bank and types the
 * account number; Paystack reads the holder's name back under it, and the buyer confirms the
 * account before any money moves. Anyone's account will do. The account number lives in this
 * screen only: it goes to the API and on to Paystack, and is never kept. A refund that needs no
 * account (any more) says where it is in plain words.
 */
export function RefundAccountScreen({ refundId }: Readonly<{ refundId: string }>) {
  const { userId } = useAuth();
  const refund = useRefund(userId, refundId);

  if (refund.error && !refund.data) {
    if (isNotFound(refund.error)) {
      return (
        <EmptyState
          title="Refund not found"
          body="This refund isn't one of yours."
          icon="info"
          action={{ label: 'See your orders', onPress: () => router.replace('/(tabs)/orders') }}
        />
      );
    }
    return (
      <ErrorState
        title="Couldn't load this refund"
        body="Check your connection and try again. Your refund is safe."
        error={refund.error}
        onRetry={() => void refund.refetch()}
      />
    );
  }
  if (!refund.data) return <RefundSkeleton />;
  return refund.data.needs_account ? <AccountForm refund={refund.data} /> : <RefundState refund={refund.data} />;
}

/**
 * "For Fresh Tomatoes 1kg in OJ-2301.": the items the refund was for (#95), named from its
 * order, and the checkout's number, the one the buyer sees everywhere (the shop's own order
 * number isn't it). Until the order loads, or for a refund of no lines, it's for the order.
 */
function useForOrder(refund: BuyerRefund) {
  const { userId } = useAuth();
  const groupId = refund.order.order_group_id;
  // Idle for a refund of an order with no checkout behind it.
  const group = useOrderGroup(groupId ? userId : null, groupId ?? '');
  const order = group.data?.orders.find((o) => o.id === refund.order.id);
  return refundForNote({
    lines: refund.lines,
    items: order?.items ?? null,
    display_id: group.data?.display_id ?? null,
    shop: refund.order.shop,
  });
}

/** Where a refund that needs no account (any more) is: a chip and a line in plain words. */
function refundState(refund: BuyerRefund): { chip: StatusChipView; message: string } {
  const amount = formatMoney(refund.amount, refund.currency_code);
  if (refund.status === 'processed') {
    return { chip: { label: 'Refunded', tone: 'success', icon: 'check' }, message: `Your ${amount} refund has reached you.` };
  }
  if (refund.handed_over) {
    return {
      chip: { label: 'Our team is sending it', tone: 'new', icon: 'clock' },
      message: `Our team is sending your ${amount} refund by hand, and will contact you if they need your details.`,
    };
  }
  if (refund.account) {
    return {
      chip: { label: 'Refund on its way', tone: 'success', icon: 'check' },
      message: `Your ${amount} refund is on its way to your ${refund.account.bank_name} account ending ${refund.account.last4}.`,
    };
  }
  return { chip: { label: 'Refund on its way', tone: 'success', icon: 'check' }, message: `Your ${amount} refund is on its way.` };
}

function RefundState({ refund }: Readonly<{ refund: BuyerRefund }>) {
  const theme = useTheme();
  const groupId = refund.order.order_group_id;
  const { chip, message } = refundState(refund);
  const forOrder = useForOrder(refund);
  return (
    <ScrollView style={{ backgroundColor: theme.colors.bg }} contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}>
      <StatusChip {...chip} />
      <Amount refund={refund} />
      <Text>{message}</Text>
      <Text tone="muted">{forOrder}</Text>
      {groupId ? (
        <Button label="View the order" variant="secondary" onPress={() => router.replace({ pathname: '/order/[id]', params: { id: groupId } })} />
      ) : null}
    </ScrollView>
  );
}

function Amount({ refund }: Readonly<{ refund: BuyerRefund }>) {
  return (
    <Text variant="displayLg" tabular>
      {formatMoney(refund.amount, refund.currency_code)}
    </Text>
  );
}

function AccountForm({ refund }: Readonly<{ refund: BuyerRefund }>) {
  const theme = useTheme();
  const { userId } = useAuth();
  const banks = useRefundBanks(userId, refund.id);
  const resolve = useResolveRefundAccount(refund.id);
  const retry = useRetryRefund(userId, refund.id);
  // A refused account or a Paystack outage (400) in the screen's words; a refund that no longer
  // needs an account (409) in the API's.
  const resolveProblem = useFailureMessage(resolve.error, "Couldn't check the account. Check your connection and try again.", {
    400: "That account couldn't be checked. Check the bank and account number, and try again.",
  });
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [confirming, setConfirming] = useState(false);
  const forOrder = useForOrder(refund);

  const input: RefundAccountInput | null =
    bankCode && accountNumber.length === ACCOUNT_LENGTH ? { bank_code: bankCode, account_number: accountNumber } : null;
  const bank = banks.data?.find((b) => b.code === bankCode) ?? null;
  const account = resolve.data && !resolve.isPending ? resolve.data : null;

  // Paystack names the holder once the bank and all 10 digits are in, once per pair: test mode
  // allows only a few lookups a day, so nothing asks again until the details change.
  const { mutate: resolveAccount, reset: resetResolve } = resolve;
  useEffect(() => {
    if (bankCode && accountNumber.length === ACCOUNT_LENGTH) resolveAccount({ bank_code: bankCode, account_number: accountNumber });
  }, [bankCode, accountNumber, resolveAccount]);

  const change = (update: () => void) => {
    resetResolve();
    retry.reset();
    setConfirming(false);
    update();
  };

  if (confirming && account && input) {
    return (
      <ConfirmAccount
        refund={refund}
        account={account}
        last4={accountNumber.slice(-4)}
        retry={retry}
        onSend={() => retry.mutate(input)}
        onChange={() => {
          retry.reset();
          setConfirming(false);
        }}
      />
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: theme.colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
        <StatusChip label="Needs your bank details" tone="attention" icon="info" />
        <Amount refund={refund} />
        <Text tone="muted">
          {`${forOrder} Your card's bank couldn't take the money back, so we'll send it to a bank account instead.`}
        </Text>
        <BankField banks={banks} bankName={bank?.name ?? null} bankCode={bankCode} onChoose={(code) => change(() => setBankCode(code))} />
        <View style={{ gap: theme.space[1] }}>
          <TextField
            label="Account number"
            value={accountNumber}
            onChangeText={(text) => change(() => setAccountNumber(text.replace(/\D/g, '').slice(0, ACCOUNT_LENGTH)))}
            placeholder="10 digits"
            keyboardType="number-pad"
            textContentType="none"
            autoComplete="off"
            maxLength={ACCOUNT_LENGTH}
          />
          <AccountName pending={resolve.isPending} name={account?.account_name ?? null} />
        </View>
        <View style={[styles.row, { gap: theme.space[2], padding: theme.space[2], borderRadius: theme.radius.md, backgroundColor: theme.colors.tile }]}>
          <Icon name="shield" use="chip" color={theme.colors.accent} />
          <Text variant="meta" tone="muted" style={styles.fill}>
            Paystack sends the refund to this account.
          </Text>
        </View>
      </ScrollView>
      {resolveProblem ? (
        <View style={{ paddingHorizontal: theme.space[4] }}>
          <InlineNote>{resolveProblem}</InlineNote>
        </View>
      ) : null}
      <StickyAction label="Send refund to this account" disabled={!account} onPress={() => setConfirming(true)} />
    </KeyboardAvoidingView>
  );
}

/** The holder's name Paystack read back, in leaf under the account number, or that it's being checked. */
function AccountName({ pending, name }: Readonly<{ pending: boolean; name: string | null }>) {
  if (pending) {
    return (
      <Text variant="meta" tone="muted" accessibilityLiveRegion="polite">
        Checking the account…
      </Text>
    );
  }
  if (!name) return null;
  return (
    <Text variant="meta" weight="bold" tone="leaf" accessibilityLabel={`Account name ${name}`} accessibilityLiveRegion="polite">
      {name}
    </Text>
  );
}

/** The account Paystack named, and one question before the refund is sent to it. */
function ConfirmAccount({
  refund,
  account,
  last4,
  retry,
  onSend,
  onChange,
}: Readonly<{
  refund: BuyerRefund;
  account: { account_name: string; bank_name: string };
  last4: string;
  retry: ReturnType<typeof useRetryRefund>;
  onSend: () => void;
  onChange: () => void;
}>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const amount = formatMoney(refund.amount, refund.currency_code);
  const sendProblem = useFailureMessage(retry.error, "Couldn't send your refund. Check your connection and try again; nothing was sent.", {
    400: "Your refund couldn't be sent to that account. Check it and try again; nothing was sent.",
  });
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Amount refund={refund} />
        <View
          accessible
          style={[styles.row, { gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.tile }]}>
          <ShopMark name={account.bank_name} />
          <View style={[styles.fill, { gap: theme.space[1] }]}>
            <Text weight="bold">{account.account_name}</Text>
            <Text variant="meta" tone="muted">{`${account.bank_name} · account ending ${last4}`}</Text>
          </View>
        </View>
        <Text>{`Is this the account to send your ${amount} refund to?`}</Text>
      </ScrollView>
      <View style={{ gap: theme.space[2], paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: Math.max(insets.bottom, theme.space[4]) }}>
        {sendProblem ? <InlineNote>{sendProblem}</InlineNote> : null}
        <Button label={`Send ${amount} to this account`} loading={retry.isPending} onPress={onSend} />
        <Button label="Change the details" variant="secondary" disabled={retry.isPending} onPress={onChange} />
      </View>
    </View>
  );
}

/** The bank the refund goes to, as a field; pressed, Paystack's banks to search and choose from. */
function BankField({
  banks,
  bankName,
  bankCode,
  onChoose,
}: Readonly<{ banks: ReturnType<typeof useRefundBanks>; bankName: string | null; bankCode: string | null; onChoose: (code: string) => void }>) {
  const theme = useTheme();
  const [choosing, setChoosing] = useState(false);
  return (
    <View style={{ gap: theme.space[1] }}>
      <Text variant="meta" weight="bold" tone="muted">
        Bank
      </Text>
      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel={`Bank, ${bankName ?? 'not chosen'}`}
        accessibilityHint="Opens the list of banks"
        onPress={() => setChoosing(true)}
        style={[
          styles.row,
          {
            minHeight: theme.control.md,
            gap: theme.space[2],
            paddingHorizontal: theme.space[4],
            borderRadius: theme.radius.md,
            borderWidth: theme.line.input,
            borderColor: theme.colors.control,
            backgroundColor: theme.colors.raised,
          },
        ]}>
        <Text tone={bankName ? 'default' : 'muted'} style={styles.fill}>
          {bankName ?? 'Choose your bank'}
        </Text>
        <Icon name="down" use="chip" color={theme.colors.muted} />
      </PressableSurface>
      <BankPicker
        visible={choosing}
        banks={banks}
        bankCode={bankCode}
        onClose={() => setChoosing(false)}
        onChoose={(code) => {
          onChoose(code);
          setChoosing(false);
        }}
      />
    </View>
  );
}

/** Paystack's banks in a sheet, searched by name. */
function BankPicker({
  visible,
  banks,
  bankCode,
  onClose,
  onChoose,
}: Readonly<{
  visible: boolean;
  banks: ReturnType<typeof useRefundBanks>;
  bankCode: string | null;
  onClose: () => void;
  onChoose: (code: string) => void;
}>) {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const matching = (banks.data ?? []).filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase()));

  let list;
  if (banks.error && !banks.data) {
    list = (
      <ErrorState
        title="Couldn't load the banks"
        body="Check your connection and try again. Your refund is safe."
        error={banks.error}
        onRetry={() => void banks.refetch()}
      />
    );
  } else if (banks.data) {
    list = (
      <FlatList
        data={matching}
        keyExtractor={(b) => b.code}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text tone="muted" style={{ padding: theme.space[4] }}>
            {`No bank called "${search.trim()}"`}
          </Text>
        }
        renderItem={({ item }) => (
          <PressableSurface
            accessibilityRole="button"
            accessibilityState={{ selected: item.code === bankCode }}
            onPress={() => {
              setSearch('');
              onChoose(item.code);
            }}
            style={[
              styles.row,
              {
                minHeight: theme.hitArea,
                gap: theme.space[2],
                paddingHorizontal: theme.space[4],
                paddingVertical: theme.space[3],
              },
            ]}>
            <Text style={styles.fill}>{item.name}</Text>
            {item.code === bankCode ? <Icon name="check" use="chip" color={theme.colors.accent} /> : null}
          </PressableSurface>
        )}
      />
    );
  } else {
    list = (
      <View accessible accessibilityLabel="Loading the banks" style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {[60, 45, 70, 50].map((width) => (
          <Skeleton key={width} width={`${width}%`} height={theme.type.body.lineHeight} />
        ))}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
        <View style={[styles.row, { padding: theme.space[4], paddingBottom: theme.space[2], gap: theme.space[2] }]}>
          <Text variant="titlePushed" style={styles.fill}>
            Choose your bank
          </Text>
          <Button label="Cancel" variant="link" size="md" onPress={onClose} />
        </View>
        <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[2] }}>
          <TextField label="Search banks" value={search} onChangeText={setSearch} placeholder="e.g. GTBank" autoCorrect={false} />
        </View>
        {list}
      </View>
    </Modal>
  );
}

/** The form's shape while the refund loads: chip, amount, why, and the two fields. */
function RefundSkeleton() {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Loading your refund"
      style={[styles.fill, { padding: theme.space[4], gap: theme.space[4], backgroundColor: theme.colors.bg }]}>
      <Skeleton width="45%" height={theme.type.label.lineHeight + theme.space[2]} radius="pill" />
      <Skeleton width="35%" height={theme.type.displayLg.lineHeight} />
      <Skeleton width="90%" height={theme.type.body.lineHeight * 2} />
      <Skeleton width="100%" height={theme.control.md} radius="md" />
      <Skeleton width="100%" height={theme.control.md} radius="md" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
