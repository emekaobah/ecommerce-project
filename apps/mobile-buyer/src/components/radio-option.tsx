import { useTheme } from '@oja/ui';
import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

/** One option of a radio group: a large touch target, outlined in ink when chosen. */
export function RadioOption({
  selected,
  disabled,
  onPress,
  children,
}: Readonly<{ selected: boolean; disabled?: boolean; onPress: () => void; children: ReactNode }>) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: theme.touchTarget,
        padding: theme.space.md,
        gap: theme.space.xs,
        borderRadius: theme.radius.md,
        borderColor: selected ? theme.colors.ink : theme.colors.divider,
        borderWidth: selected ? 2 : 1,
      }}>
      {children}
    </Pressable>
  );
}
