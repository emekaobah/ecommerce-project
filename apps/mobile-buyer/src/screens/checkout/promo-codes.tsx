import { formatMoney } from '@oja/domain';
import { Button, Icon, InlineNote, StatusChip, Text, TextField, useTheme } from '@oja/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { refusalMessage, useApplyPromoCode, useRemovePromoCode, type Checkout, type CheckoutPromotion } from '@/api/checkout';

/**
 * Promo codes at checkout (#6): each code on the cart with what it takes off and whose it is,
 * then the box for another. A code the buyer can't use says why, in the store's words.
 */
export function PromoCodes({ cartId, checkout }: Readonly<{ cartId: string; checkout: Checkout }>) {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const apply = useApplyPromoCode(cartId);
  const remove = useRemovePromoCode(cartId);
  const submit = () => {
    if (!code.trim()) return;
    apply.mutate(code.trim(), { onSuccess: () => setCode('') });
  };
  const applyProblem = apply.error ? (refusalMessage(apply.error) ?? "Couldn't apply the code. Check your connection and try again.") : null;

  return (
    <View style={{ gap: theme.space[2] }}>
      {checkout.promotions.map((promotion) => (
        <Promotion
          key={promotion.code}
          promotion={promotion}
          currencyCode={checkout.currency_code}
          removing={remove.isPending && remove.variables === promotion.code}
          onRemove={() => remove.mutate(promotion.code)}
        />
      ))}
      {remove.error ? <InlineNote>{"Couldn't remove the code. Check your connection and try again."}</InlineNote> : null}
      <View style={[styles.row, styles.bottom, { gap: theme.space[2] }]}>
        <View style={styles.fill}>
          <TextField
            label="Promo code"
            value={code}
            onChangeText={(text) => {
              setCode(text);
              apply.reset();
            }}
            onSubmitEditing={submit}
            placeholder="Enter a code"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
          />
        </View>
        <Button label="Apply" variant="secondary" onPress={submit} loading={apply.isPending} disabled={!code.trim()} />
      </View>
      {applyProblem ? <InlineNote>{applyProblem}</InlineNote> : null}
    </View>
  );
}

/** A discount on the cart: its code with what it takes off, whose it is, and (one the buyer entered) Remove. */
function Promotion({
  promotion,
  currencyCode,
  removing,
  onRemove,
}: Readonly<{ promotion: CheckoutPromotion; currencyCode: string; removing: boolean; onRemove: () => void }>) {
  const theme = useTheme();
  const whose = promotion.seller ? `${promotion.seller.name}'s code.` : 'Applied by Oja.';
  return (
    <View style={{ gap: theme.space[1] }}>
      <View
        style={[
          styles.row,
          {
            gap: theme.space[2],
            minHeight: theme.control.md,
            paddingHorizontal: theme.space[3],
            borderRadius: theme.radius.md,
            borderWidth: theme.line.input,
            borderColor: theme.colors.leafText,
            backgroundColor: theme.colors.raised,
          },
        ]}>
        <Icon name="tag" use="step" />
        <Text weight="bold" style={styles.fill}>
          {promotion.code}
        </Text>
        <StatusChip label={`−${formatMoney(promotion.amount, currencyCode)}`} tone="success" icon="check" />
        {promotion.automatic ? null : <Button label="Remove" variant="link" onPress={onRemove} loading={removing} />}
      </View>
      <Text variant="meta" tone="muted">
        {promotion.automatic ? `Automatic deal. ${whose}` : whose}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  bottom: { alignItems: 'flex-end' },
  fill: { flex: 1 },
});
