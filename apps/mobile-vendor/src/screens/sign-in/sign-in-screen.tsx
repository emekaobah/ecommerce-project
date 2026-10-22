import { PRODUCT_NAME } from '@oja/domain';
import { Button, line, MAX_FONT_SCALE, Text, useTheme } from '@oja/ui';
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
      borderColor: theme.colors.control,
      borderRadius: theme.radius.md,
      minHeight: theme.hitArea,
      paddingHorizontal: theme.space[4],
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg, padding: theme.space[6] }]}>
      <View style={{ gap: theme.space[4] }}>
        <Text variant="titleRoot">{PRODUCT_NAME} Vendor</Text>
        <TextInput
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          testID="email"
          style={inputStyle}
          placeholder="Email"
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          testID="password"
          style={inputStyle}
          placeholder="Password"
          placeholderTextColor={theme.colors.muted}
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
  input: { borderWidth: line.input },
});
