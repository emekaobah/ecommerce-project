import { formatMoney, quickAddForm, type QuickAddFormErrors } from '@oja/domain';
import { Button, ErrorState, InlineNote, PhotoTile, Skeleton, StatusChip, Text, TextField, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFailureMessage } from '@/api/errors';
import { useBarcodeLookup, useQuickAdd, type BarcodeLookup } from '@/api/quick-add';
import { useSession } from '@/session/session-store';

import { PhotoCapture, type ProductPhoto } from './photo-capture';

/**
 * Quick-add after a scan (#38, catalogue v-shop #2). A product the catalogue has: staff set the
 * shop's price and stock, and it keeps the catalogue's photos. One it lacks: they also
 * photograph it and name it, and it goes to review. A product the shop already sells, or one
 * still in review, can't be added here.
 */
export function QuickAddScreen() {
  const router = useRouter();
  const { barcode } = useLocalSearchParams<{ barcode: string }>();
  const sellerId = useSession()?.sellerId ?? '';
  const lookup = useBarcodeLookup(sellerId, barcode);
  const scanAgain = () => router.replace('/quick-add');

  const content = () => {
    if (lookup.error) {
      return (
        <ErrorState
          title="Couldn't look the barcode up"
          body="Check your connection and try again. Nothing has been added to your shop."
          error={lookup.error}
          onRetry={() => void lookup.refetch()}
        />
      );
    }
    if (!lookup.data) return <QuickAddSkeleton />;
    const { product, offer, currency_code } = lookup.data;
    if (product && offer) {
      return (
        <Notice
          product={<ProductHeader lookup={lookup.data} chip={<StatusChip label="Already in your shop" tone="info" icon={null} />} />}
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
          product={<ProductHeader lookup={lookup.data} chip={<StatusChip label="In review" tone="new" icon="clock" />} />}
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

/** The catalogue's 96 px product photo tile: two standard controls high. */
const productTile = (theme: ReturnType<typeof useTheme>) => theme.control.md * 2;

/** The photo tile, chip, name and barcode while the barcode is looked up. */
function QuickAddSkeleton() {
  const theme = useTheme();
  const tile = productTile(theme);
  return (
    <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
      <View style={[styles.row, { gap: theme.space[3] }]}>
        <Skeleton width={tile} height={tile} radius="lg" />
        <View style={[styles.fill, { gap: theme.space[2] }]}>
          <Skeleton width="60%" height={theme.space[6]} radius="pill" />
          <Skeleton width="80%" height={theme.space[4]} radius="pill" />
        </View>
      </View>
      <Skeleton height={theme.control.md} radius="md" />
      <Skeleton height={theme.control.md} radius="md" />
    </View>
  );
}

/** The catalogue's product: its photo tile, a chip, its name and its barcode. */
function ProductHeader({ lookup, chip }: Readonly<{ lookup: BarcodeLookup; chip: ReactNode }>) {
  const theme = useTheme();
  const tile = productTile(theme);
  const { product, barcode } = lookup;
  return (
    <View style={[styles.row, { gap: theme.space[3] }]}>
      <PhotoTile style={{ width: tile, height: tile, borderRadius: theme.radius.lg }}>
        {product?.thumbnail ? (
          <Image source={{ uri: product.thumbnail }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityIgnoresInvertColors />
        ) : null}
      </PhotoTile>
      <View style={[styles.fill, styles.start, { gap: theme.space[1] }]}>
        {chip}
        <Text variant="strong" style={{ marginTop: theme.space[1] }}>
          {product?.title}
        </Text>
        <Text variant="meta" tone="muted" tabular>{`Barcode ${barcode}`}</Text>
      </View>
    </View>
  );
}

function Notice({ product, lines, onScanAgain }: Readonly<{ product: ReactNode; lines: string[]; onScanAgain: () => void }>) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}>
        {product}
        {lines.map((line) => (
          <Text key={line} tone="muted">
            {line}
          </Text>
        ))}
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2], gap: theme.space[2] }}>
        <Button label="Scan another" icon="scan" size="main" onPress={onScanAgain} />
        <Button label="Back to orders" variant="secondary" onPress={() => router.dismissTo('/')} />
      </SafeAreaView>
    </View>
  );
}

function AddForm({ lookup }: Readonly<{ lookup: BarcodeLookup }>) {
  const theme = useTheme();
  const router = useRouter();
  const quickAdd = useQuickAdd();
  const failure = useFailureMessage(quickAdd.error, "Couldn't add it to your shop. Check your connection and try again.", {
    403: 'Only owners, managers and fulfilment staff can add products.',
  });
  // The view measures itself below the header: without its height the keyboard covers the foot button.
  const headerHeight = useHeaderHeight();
  const newProduct = !lookup.product;
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [title, setTitle] = useState('');
  const [photo, setPhoto] = useState<ProductPhoto | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [errors, setErrors] = useState<QuickAddFormErrors>({});
  // Editing a field clears what was wrong with it.
  const edit = (field: keyof QuickAddFormErrors, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors(({ [field]: _, ...rest }) => rest);
  };

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
    const name = lookup.product?.title ?? form.value.title ?? lookup.barcode;
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
            params: {
              result,
              title: name,
              price: formatMoney(form.value.price, lookup.currency_code),
              stock: form.value.stock === null ? '' : String(form.value.stock),
              thumbnail: lookup.product?.thumbnail ?? photo?.uri ?? '',
            },
          }),
      },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
        {lookup.product ? (
          <ProductHeader lookup={lookup} chip={<StatusChip label="Found in catalogue" tone="success" icon="check" />} />
        ) : (
          <View style={[styles.start, { gap: theme.space[2] }]}>
            <StatusChip label="New to the catalogue" tone="info" icon={null} />
            <Text tone="muted">
              {`The catalogue doesn't have barcode ${lookup.barcode}. Photograph it and name it: it is reviewed before buyers see it, and your price applies once it is approved.`}
            </Text>
            {photo ? (
              <PhotoTile style={[styles.photo, { borderRadius: theme.radius.lg }]}>
                <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="The product's photo" />
              </PhotoTile>
            ) : null}
            <Button
              label={photo ? 'Retake photo' : 'Take photo'}
              icon="camera"
              variant="secondary"
              style={styles.stretch}
              onPress={() => setCapturing(true)}
            />
            {errors.photo ? <InlineNote>{errors.photo}</InlineNote> : null}
            <View style={styles.stretch}>
              <TextField testID="title" label="Product name" hint="As on the pack, with its size" value={title} onChangeText={edit('title', setTitle)} error={errors.title} />
            </View>
          </View>
        )}
        <TextField
          testID="price"
          label="Your price"
          placeholder={formatMoney(0, lookup.currency_code)}
          keyboardType="decimal-pad"
          value={price}
          onChangeText={edit('price', setPrice)}
          error={errors.price}
        />
        <TextField
          testID="stock"
          label="In stock"
          hint="Leave empty if you don't count it"
          keyboardType="number-pad"
          value={stock}
          onChangeText={edit('stock', setStock)}
          error={errors.stock}
        />
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2], gap: theme.space[2], backgroundColor: theme.colors.bg }}>
        {failure ? <InlineNote>{failure}</InlineNote> : null}
        <Button label={newProduct ? 'Send for review' : 'Add to my shop'} size="main" onPress={submit} loading={quickAdd.isPending} />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  start: { alignItems: 'flex-start' },
  stretch: { alignSelf: 'stretch' },
  photo: { width: '100%', aspectRatio: 1 },
});
