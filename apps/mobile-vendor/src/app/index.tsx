import { createVendorClient, loginMember } from '@oja/api-client';
import { useState } from 'react';
import { ActivityIndicator, Button, FlatList, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiUrl } from '@/lib/api';

type Session = { sellerId: string; sellerName: string; orders: OrderRow[] };
type OrderRow = { id: string; displayId: number; status: string; createdAt: string };

async function signIn(email: string, password: string): Promise<Session> {
  const token = await loginMember(apiUrl, { email, password });
  const { seller_members } = await createVendorClient({ baseUrl: apiUrl, token }).vendor.sellers.query();
  // A member can belong to several sellers; the shop switcher comes with the vendor app slices.
  const membership = seller_members[0];
  if (!membership) throw new Error('This account is not a member of any shop');
  const vendor = createVendorClient({ baseUrl: apiUrl, token, sellerId: membership.seller_id });
  const { orders } = await vendor.vendor.orders.query({ limit: 50 });
  return {
    sellerId: membership.seller_id,
    sellerName: membership.seller?.name ?? membership.seller_id,
    orders: orders.map((o) => ({
      id: o.id,
      displayId: o.display_id,
      status: o.status,
      createdAt: String(o.created_at),
    })),
  };
}

export default function OrdersScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    setLoading(true);
    setError(null);
    signIn(email.trim(), password)
      .then(setSession)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.backgroundSelected }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {!session ? (
          <ThemedView style={styles.form}>
            <ThemedText type="title">Oja Vendor</ThemedText>
            <TextInput
              style={inputStyle}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={inputStyle}
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            {error ? <ThemedText themeColor="textSecondary">{error}</ThemedText> : null}
            {loading ? <ActivityIndicator /> : <Button title="Sign in" onPress={onSubmit} />}
          </ThemedView>
        ) : (
          <>
            <ThemedText type="subtitle">{session.sellerName}</ThemedText>
            <FlatList
              data={session.orders}
              keyExtractor={(o) => o.id}
              ListEmptyComponent={<ThemedText>No orders yet.</ThemedText>}
              contentContainerStyle={{ paddingBottom: BottomTabInset + Spacing.three, gap: Spacing.two }}
              renderItem={({ item }) => (
                <ThemedView type="backgroundElement" style={styles.row}>
                  <ThemedText type="smallBold">#{item.displayId}</ThemedText>
                  <ThemedText type="small">{item.status}</ThemedText>
                </ThemedView>
              )}
            />
          </>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, gap: Spacing.three, paddingTop: Spacing.three },
  form: { gap: Spacing.three, marginTop: Spacing.five },
  input: { borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.three, fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: Spacing.three, borderRadius: Spacing.two },
});
