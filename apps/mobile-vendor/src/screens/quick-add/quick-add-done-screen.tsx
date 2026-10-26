import { Button, NoTopScrollEdge, PhotoTile, StatusChip, Text, TopBandScreen, useTheme, useTopBand } from '@oja/ui';
import { Image } from 'expo-image';
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmationHero } from '../collect/confirmation-hero';

type DoneParams = {
  result: 'offered' | 'proposed';
  title: string;
  /** The price as set, formatted. */
  price: string;
  /** Units in stock; empty when not counted. */
  stock: string;
  /** The catalogue's photo, or the one taken; empty without. */
  thumbnail: string;
};

/**
 * Quick-add done (catalogue v-shop #3): the product is on sale in the shop, or, new to the
 * catalogue, sent for review before it goes on sale at the shop's price. Scan another is the
 * main action: quick-add happens shelf by shelf.
 */
export function QuickAddDoneScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { result, title, price, stock, thumbnail } = useLocalSearchParams<DoneParams>();
  const proposed = result === 'proposed';
  const photo = theme.control.md;
  const band = useTopBand();
  const focused = useIsFocused();

  return (
    <TopBandScreen band={band} focused={focused}>
      {/* The confirmation runs up under the status bar. */}
      <Stack.Screen options={{ headerShown: false }} />
      <NoTopScrollEdge>
        <Animated.ScrollView {...band.scroll} contentContainerStyle={{ paddingBottom: theme.space[6] }}>
          <ConfirmationHero
            band={band}
            title={proposed ? 'Sent for review' : `${title} is in your shop`}
            line={proposed ? "The catalogue team checks it before it goes on sale at your price." : 'Buyers can order it now.'}
          />
          <View style={[styles.row, { padding: theme.space[4], gap: theme.space[2] }]}>
            <PhotoTile style={{ width: photo, height: photo, borderRadius: theme.radius.md }}>
              {thumbnail ? <Image source={{ uri: thumbnail }} contentFit="contain" style={StyleSheet.absoluteFill} /> : null}
            </PhotoTile>
            <View style={styles.fill}>
              <Text weight="bold">{title}</Text>
              <Text variant="meta" tone="muted" tabular>
                {stock ? `${price} · ${stock} in stock` : price}
              </Text>
            </View>
            <StatusChip
              label={proposed ? 'In review' : 'On sale'}
              tone={proposed ? 'new' : 'success'}
              icon={proposed ? 'clock' : 'check'}
            />
          </View>
        </Animated.ScrollView>
      </NoTopScrollEdge>
      <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: theme.space[3], paddingTop: theme.space[2], gap: theme.space[2] }}>
        <Button label="Scan another" icon="scan" size="main" onPress={() => router.replace('/quick-add')} />
        <Button label="Back to orders" variant="secondary" onPress={() => router.dismissTo('/')} />
      </SafeAreaView>
    </TopBandScreen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
