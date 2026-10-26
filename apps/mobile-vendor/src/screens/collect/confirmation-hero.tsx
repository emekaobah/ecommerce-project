import { Icon, Text, TopBand, useTheme, type TopBandController } from '@oja/ui';
import { StyleSheet, View } from 'react-native';

/**
 * The indigo confirmation at the top of a done screen (the catalogue's `.hero2`: Collected,
 * Added): the pattern behind, the small leaf done badge, the headline and one line under it.
 * It runs up under the status bar, so its screen hides the header. Read as one heading.
 */
export function ConfirmationHero({ band, title, line }: Readonly<{ band: TopBandController; title: string; line: string }>) {
  const theme = useTheme();
  // The catalogue's 52 px badge, the size of a large shop mark, around a 28 px check.
  const badge = theme.shopMark.lg.size;
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={`${title}. ${line}`}>
      <TopBand band={band} belowStatusBar={theme.space[6]} style={{ paddingBottom: theme.space[6], gap: theme.space[2] }}>
        <View style={[styles.badge, { width: badge, height: badge, borderRadius: theme.radius.lg, backgroundColor: theme.colors.leaf }]}>
          <Icon name="check" use="quietEmblem" color={theme.colors.onPrimary} />
        </View>
        <Text variant="displayLg" tone="onBand">
          {title}
        </Text>
        <Text tone="onBand">{line}</Text>
      </TopBand>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
});
