import { formatMoney, quickAddForm, type QuickAddFormErrors } from '@oja/domain';
import { Button, ErrorState, LoadingState, StatusChip, Text, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useBarcodeLookup, useQuickAdd, type BarcodeLookup } from '@/api/quick-add';
import { Field } from '@/components/field';
import { useSession } from '@/session/session-store';

import { PhotoCapture, type ProductPhoto } from './photo-capture';

/**
 * Quick-add after a scan (#38). A product the catalogue has: staff set the shop's price and
 * stock. One it lacks: they also photograph it and name it, and it goes to review. A product
 * the shop already sells can't be changed here: that is for owners and managers.
 */
export function QuickAddScreen() {
  const router = useRouter();
  const { barcode } = useLocalSearchParams<{ barcode: string }>();
  const sellerId = useSession()?.sellerId ?? '';
  const lookup = useBarcodeLookup(sellerId, barcode);
  const scanAgain = () => router.replace('/quick-add');

  const content = () => {
    if (lookup.error) {
      return <ErrorState title="Couldn't look the barcode up" message={lookup.error.message} onRetry={() => void lookup.refetch()} />;
    }
    if (!lookup.data) return <LoadingState />;
    const { product, offer, currency_code } = lookup.data;
    if (product && offer) {
      return (
        <Notice
          chip={<StatusChip label="Already in your shop" tone="info" />}
          title={product.title}
          lines={[
            `Selling at ${offer.price === null ? 'no price yet' : formatMoney(offer.price, currency_code)}` +
              (offer.stock === null ? '.' : `, ${offer.stock} in stock.`),
            'Only owners and managers can change its price or stock, in the web vendor panel.',
          ]}
          onScanAgain={scanAgain}
        />
      );
    }
    if (product?.in_review) {
      return (
        <Notice
          chip={<StatusChip label="In review" tone="warning" />}
          title={product.title}
          lines={['This product is still being reviewed for the catalogue. Add it once it is approved.']}
          onScanAgain={scanAgain}
        />
      );
    }
    return <AddForm lookup={lookup.data} />;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Add a product' }} />
      {content()}
    </>
  );
}

function Notice({
  chip,
  title,
  lines,
  onScanAgain,
}: Readonly<{ chip: React.ReactNode; title: string; lines: string[]; onScanAgain: () => void }>) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={{ flex: 1, padding: theme.space.lg, gap: theme.space.md }}>
      {chip}
      <Text variant="title">{title}</Text>
      {lines.map((line) => (
        <Text key={line} tone="secondary">
          {line}
        </Text>
      ))}
      <Button label="Scan another" onPress={onScanAgain} />
      <Button label="Back to orders" variant="link" onPress={() => router.dismissTo('/')} />
    </View>
  );
}

function AddForm({ lookup }: Readonly<{ lookup: BarcodeLookup }>) {
  const theme = useTheme();
  const router = useRouter();
  const quickAdd = useQuickAdd();
  const newProduct = !lookup.product;
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [title, setTitle] = useState('');
  const [photo, setPhoto] = useState<ProductPhoto | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [errors, setErrors] = useState<QuickAddFormErrors>({});

  if (capturing) {
    return (
      <PhotoCapture
        onTaken={(taken) => {
          setPhoto(taken);
          setErrors(({ photo: _, ...rest }) => rest);
          setCapturing(false);
        }}
        onCancel={() => setCapturing(false)}
      />
    );
  }

  const submit = () => {
    const form = quickAddForm({ price, stock, title, hasPhoto: !!photo }, { newProduct });
    if (!form.ok) {
      setErrors(form.errors);
      return;
    }
    setErrors({});
    const { mime_type, data } = photo ?? {};
    quickAdd.mutate(
      {
        barcode: lookup.barcode,
        price: form.value.price,
        stock: form.value.stock,
        ...(newProduct && mime_type && data ? { title: form.value.title, photo: { mime_type, data } } : {}),
      },
      {
        onSuccess: ({ result }) =>
          router.replace({
            pathname: '/quick-add/done',
            params: { result, title: lookup.product?.title ?? form.value.title ?? lookup.barcode },
          }),
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }} keyboardShouldPersistTaps="handled">
        {lookup.product ? (
          <View style={{ flexDirection: 'row', gap: theme.space.md, alignItems: 'center' }}>
            {lookup.product.thumbnail ? (
              <Image
                source={{ uri: lookup.product.thumbnail }}
                style={[styles.thumbnail, { borderRadius: theme.radius.md, backgroundColor: theme.colors.surface }]}
                contentFit="contain"
                accessibilityIgnoresInvertColors
              />
            ) : null}
            <View style={styles.fill}>
              <Text variant="heading">{lookup.product.title}</Text>
              <Text tone="secondary">Barcode {lookup.barcode}</Text>
            </View>
          </View>
        ) : (
          <View style={{ gap: theme.space.sm }}>
            <StatusChip label="New to the catalogue" tone="info" />
            <Text tone="secondary">
              {`The catalogue doesn't have barcode ${lookup.barcode}. Photograph it and name it: it is reviewed before buyers see it, and your price applies once it is approved.`}
            </Text>
            {photo ? (
              <Image
                source={{ uri: photo.uri }}
                style={[styles.photo, { borderRadius: theme.radius.md, backgroundColor: theme.colors.surface }]}
                contentFit="contain"
                accessibilityLabel="The product's photo"
              />
            ) : null}
            <Button label={photo ? 'Retake photo' : 'Take photo'} variant="secondary" onPress={() => setCapturing(true)} />
            {errors.photo ? <Text tone="danger">{errors.photo}</Text> : null}
            <Field testID="title" label="Product name" placeholder="As on the pack, with its size" value={title} onChangeText={setTitle} error={errors.title} />
          </View>
        )}
        <Field
          testID="price"
          label={`Your price (${lookup.currency_code.toUpperCase()})`}
          keyboardType="decimal-pad"
          value={price}
          onChangeText={setPrice}
          error={errors.price}
        />
        <Field
          testID="stock"
          label="In stock"
          placeholder="Leave empty if you don't count it"
          keyboardType="number-pad"
          value={stock}
          onChangeText={setStock}
          error={errors.stock}
        />
        {quickAdd.error ? <Text tone="danger">{quickAdd.error.message}</Text> : null}
        <Button label={newProduct ? 'Send for review' : 'Add to shop'} onPress={submit} loading={quickAdd.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  thumbnail: { width: 72, height: 72 },
  photo: { width: '100%', aspectRatio: 1 },
});
