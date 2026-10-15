import { formatMoney } from '@oja/domain';
import { Button, Text, useTheme } from '@oja/ui';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useApplyPromoCode, useRemovePromoCode, type Checkout, type CheckoutPromotion } from '@/api/checkout';

/**
 * Promo codes at checkout (#6): the code box, and the discounts on the cart. A shop's code says
 * it only takes money off that shop's items; a code the buyer can't use says why.
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

  return (
    <View
      style={{
        gap: theme.space.sm,
        paddingTop: theme.space.md,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
      }}>
      <Text variant="heading">Promo code</Text>
      {checkout.promotions.map((promotion) => (
        <Promotion
          key={promotion.code}
          promotion={promotion}
          currencyCode={checkout.currency_code}
          removing={remove.isPending && remove.variables === promotion.code}
          onRemove={() => remove.mutate(promotion.code)}
        />
      ))}
      <View style={[styles.row, { gap: theme.space.sm }]}>
        <TextInput
          value={code}
          onChangeText={(text) => {
            setCode(text);
            apply.reset();
          }}
          onSubmitEditing={submit}
          placeholder="Enter a code"
          placeholderTextColor={theme.colors.textSecondary}
          accessibilityLabel="Promo code"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          style={[
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
          ]}
        />
        <Button label="Apply" variant="secondary" onPress={submit} loading={apply.isPending} disabled={!code.trim()} />
      </View>
      {apply.error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {apply.error.message}
        </Text>
      ) : null}
      {remove.error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {`Couldn't remove the code: ${remove.error.message}`}
        </Text>
      ) : null}
    </View>
  );
}

/** A discount on the cart: whose it is, what it takes off, and (for a code the buyer entered) Remove. */
function Promotion({
  promotion,
  currencyCode,
  removing,
  onRemove,
}: Readonly<{ promotion: CheckoutPromotion; currencyCode: string; removing: boolean; onRemove: () => void }>) {
  const theme = useTheme();
  const scope = promotion.seller ? `On ${promotion.seller.name}'s items only` : 'On your whole order';
  return (
    <View style={[styles.row, { gap: theme.space.sm }]}>
      <View style={[styles.fill, { gap: theme.space.xs }]}>
        <Text variant="label">{promotion.automatic ? `${promotion.code} · Automatic deal` : promotion.code}</Text>
        <Text variant="caption" tone="secondary">
          {scope}
        </Text>
      </View>
      <Text variant="label">{`−${formatMoney(promotion.amount, currencyCode)}`}</Text>
      {promotion.automatic ? null : <Button label="Remove" variant="link" onPress={onRemove} loading={removing} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
  input: { flex: 1, borderWidth: 1 },
});
