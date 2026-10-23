import { ClientError } from '@oja/api-client';
import { PRODUCT_NAME } from '@oja/domain';
import { AdirePattern, Button, InlineNote, Text, TextField, useTheme } from '@oja/ui';
import { useMutation } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoShopError, signIn } from '@/session/sign-in';

/**
 * Sign in, branded: the indigo pattern with what the app is for, then email and password, and
 * the one thing new staff need to know, that accounts come by invitation.
 */
export function SignInScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // On success the session flips and the root layout swaps to the signed-in group.
  const submit = useMutation({ mutationFn: () => signIn(email.trim(), password) });
  const canSubmit = email.trim() !== '' && password !== '';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.fill, { backgroundColor: theme.colors.raised }]}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.grow} keyboardShouldPersistTaps="handled" bounces={false}>
        <SafeAreaView
          edges={['top']}
          style={[styles.top, { padding: theme.space[6], gap: theme.space[2], backgroundColor: theme.colors.band }]}>
          <AdirePattern fade="top" opacity={0.55} />
          <Text variant="displayXxl" tone="onBand">
            {PRODUCT_NAME.toLowerCase()}
            <Text variant="titlePushed" weight="bold" tone="onBand" style={styles.soft}>
              {' for shops'}
            </Text>
          </Text>
          <Text variant="titleNamed" weight="bold" tone="onBand">
            Accept, pick, pack and hand over.
          </Text>
        </SafeAreaView>
        <SafeAreaView edges={['bottom']} style={{ padding: theme.space[4], paddingBottom: theme.space[6], gap: theme.space[2] }}>
          <TextField
            label="Email"
            testID="email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
            value={email}
            onChangeText={setEmail}
          />
          <TextField
            label="Password"
            testID="password"
            autoComplete="current-password"
            textContentType="password"
            secureTextEntry
            returnKeyType="go"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => canSubmit && submit.mutate()}
          />
          <View style={{ gap: theme.space[2], marginTop: theme.space[2] }}>
            {submit.error ? (
              <InlineNote>
                {signInProblem(submit.error)}
              </InlineNote>
            ) : null}
            <Button label="Sign in" onPress={() => submit.mutate()} disabled={!canSubmit} loading={submit.isPending} />
            <Text variant="meta" tone="muted" style={styles.centred}>
              No account? Your shop owner invites you from the vendor panel.
            </Text>
          </View>
        </SafeAreaView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Why signing in failed, in plain words; the raw error isn't shown. */
function signInProblem(error: Error): string {
  if (error instanceof NoShopError) return error.message;
  if (error instanceof ClientError && (error.status === 400 || error.status === 401)) {
    return "That email and password don't match. Check them and try again.";
  }
  return "Couldn't sign in. Check your connection and try again.";
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  top: { flexGrow: 1, justifyContent: 'flex-end', overflow: 'hidden' },
  soft: { opacity: 0.8 },
  centred: { textAlign: 'center' },
});
