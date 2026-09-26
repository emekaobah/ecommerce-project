import { PRODUCT_NAME } from '@oja/domain';
import { Button, Text, useTheme } from '@oja/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signIn } from '@/session/sign-in';

export function SignInScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // On success the session flips and the root layout swaps to the signed-in group.
  const submit = useMutation({ mutationFn: () => signIn(email.trim(), password) });
  const canSubmit = email.trim() !== '' && password !== '';

  const inputStyle = [
    styles.input,
    theme.type.body,
    {
      color: theme.colors.ink,
      borderColor: theme.colors.divider,
      borderRadius: theme.radius.md,
      minHeight: theme.touchTarget,
      paddingHorizontal: theme.space.md,
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background, padding: theme.space.lg }]}>
      <View style={{ gap: theme.space.md }}>
        <Text variant="title">{PRODUCT_NAME} Vendor</Text>
        <TextInput
          testID="email"
          style={inputStyle}
          placeholder="Email"
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          testID="password"
          style={inputStyle}
          placeholder="Password"
          placeholderTextColor={theme.colors.textSecondary}
          autoComplete="current-password"
          textContentType="password"
          secureTextEntry
          returnKeyType="go"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => canSubmit && submit.mutate()}
        />
        {submit.error ? <Text tone="danger">{submit.error.message}</Text> : null}
        <Button label="Sign in" onPress={() => submit.mutate()} disabled={!canSubmit} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  input: { borderWidth: 1.5 },
});
