import { formatMoney } from '@oja/domain';
import { Button, focusRing, Icon, InlineNote, MAX_FONT_SCALE, StatusChip, Text, useTheme } from '@oja/ui';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useApplyPromoCode, useRemovePromoCode, type Checkout, type CheckoutPromotion } from '@/api/checkout';
import { useFailureMessage } from '@/api/errors';

/**
 * Promo codes at checkout (#6): each code on the cart with what it takes off and whose it is,
 * then the box for another. A code the buyer can't use says why, in the store's words.
 */
export function PromoCodes({ cartId, checkout }: Readonly<{ cartId: string; checkout: Checkout }>) {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const apply = useApplyPromoCode(cartId);
  const remove = useRemovePromoCode(cartId);
  const submit = () => {
    if (!code.trim()) return;
    apply.mutate(code.trim(), { onSuccess: () => setCode('') });
  };
  const applyProblem = useFailureMessage(apply.error, "Couldn't apply the code. Check your connection and try again.", {
    400: "That code can't be used on this order. Check it, or try another.",
  });

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
      {/* One row, as an applied code is: the tag, the code being typed, and Apply. */}
      <View
        style={[
          styles.row,
          {
            gap: theme.space[2],
            minHeight: theme.control.md,
            paddingLeft: theme.space[3],
            paddingRight: theme.space[3],
            borderRadius: theme.radius.md,
            borderWidth: theme.line.input,
            borderColor: focused ? theme.colors.accent : theme.colors.control,
            backgroundColor: theme.colors.raised,
          },
          focused ? { boxShadow: focusRing(theme) } : null,
        ]}>
        <Icon name="tag" use="step" color={theme.colors.muted} />
        <TextInput
          value={code}
          onChangeText={(text) => {
            setCode(text);
            apply.reset();
          }}
          onSubmitEditing={submit}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel="Promo code"
          placeholder="Promo code"
          placeholderTextColor={theme.colors.muted}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          style={[theme.type.body, styles.fill, { color: theme.colors.ink, minHeight: theme.control.md }]}
        />
        {code.trim() ? <Button label="Apply" variant="link" onPress={submit} loading={apply.isPending} /> : null}
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
  fill: { flex: 1 },
});
