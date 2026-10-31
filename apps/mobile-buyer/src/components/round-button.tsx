import { Icon, PressableSurface, useTheme, type IconName } from '@oja/ui';
import { StyleSheet } from 'react-native';

/** A round-cornered button over a shop's banner: back. Raised, so it reads on any image. */
export function RoundButton({
  icon,
  label,
  onPress,
  selected,
}: Readonly<{ icon: IconName; label: string; onPress: () => void; selected?: boolean }>) {
  const theme = useTheme();
  return (
    <PressableSurface
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={[
        styles.round,
        {
          width: theme.hitArea,
          height: theme.hitArea,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.raised,
        },
      ]}>
      <Icon name={icon} use="step" color={selected ? theme.colors.dangerText : theme.colors.ink} filled={selected} />
    </PressableSurface>
  );
}

const styles = StyleSheet.create({
  round: { alignItems: 'center', justifyContent: 'center' },
});
