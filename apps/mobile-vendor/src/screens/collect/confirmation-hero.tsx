import { AdirePattern, Icon, Text, useTheme } from '@oja/ui';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The indigo confirmation at the top of a done screen (the catalogue's `.hero2`: Collected,
 * Added): the pattern behind, the small leaf done badge, the headline and one line under it.
 * It runs up under the status bar, so its screen hides the header. Read as one heading.
 */
export function ConfirmationHero({ title, line }: Readonly<{ title: string; line: string }>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The catalogue's 52 px badge, the size of a large shop mark, around a 28 px check.
  const badge = theme.shopMark.lg.size;
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${title}. ${line}`}
      style={[
        styles.hero,
        {
          backgroundColor: theme.colors.band,
          paddingTop: insets.top + theme.space[6],
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[6],
          gap: theme.space[2],
        },
      ]}>
      <AdirePattern fade="right" />
      <View style={[styles.badge, { width: badge, height: badge, borderRadius: theme.radius.lg, backgroundColor: theme.colors.leaf }]}>
        <Icon name="check" use="quietEmblem" color={theme.colors.onPrimary} />
      </View>
      <Text variant="displayLg" tone="onBand">
        {title}
      </Text>
      <Text tone="onBand">{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden' },
  badge: { alignItems: 'center', justifyContent: 'center' },
});
