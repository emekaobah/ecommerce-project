import { useTheme } from '@oja/ui';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

/**
 * A bottom sheet over the current screen, for a sheet that belongs to the screen rather than a
 * route of its own: the scrim (tap it to close, unless `dismissible` is false), the grabber and
 * the rounded top. Holds an `@oja/ui` `Sheet` or `ConfirmSheet`.
 */
export function SheetModal({
  visible,
  onClose,
  dismissible = true,
  children,
}: Readonly<{ visible: boolean; onClose: () => void; dismissible?: boolean; children: ReactNode }>) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissible ? onClose : undefined} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          style={[styles.fill, { backgroundColor: theme.colors.scrim }]}
          onPress={dismissible ? onClose : undefined}
          accessibilityRole="button"
          accessibilityLabel="Close"
          accessible={dismissible}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: theme.colors.raised,
            borderTopLeftRadius: theme.radius.sheet,
            borderTopRightRadius: theme.radius.sheet,
            overflow: 'hidden',
            paddingTop: theme.space[2],
          }}>
          <View
            style={[styles.grabber, { width: theme.space[8] + theme.space[2], height: theme.space[1], borderRadius: theme.radius.pill, backgroundColor: theme.colors.line }]}
          />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grabber: { alignSelf: 'center' },
});
