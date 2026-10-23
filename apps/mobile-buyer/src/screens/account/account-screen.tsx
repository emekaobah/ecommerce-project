import { useAuth, useClerk, useUser } from '@clerk/expo';
import { shopInitials } from '@oja/domain';
import { Button, Icon, ListRow, Skeleton, Text, useTheme, useToast, type IconName } from '@oja/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccountSummary, type AccountSummary } from '@/api/customer';
import { SignInPrompt } from '@/components/sign-in-prompt';
import { openMyReviews } from '@/navigation';
import { forgetDevice } from '@/push/push-registration';

const PROVIDERS: Record<string, string> = { google: 'Google', apple: 'Apple', oauth_google: 'Google', oauth_apple: 'Apple' };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 saved · 14 Bode Thomas St is default", or that none is saved. */
function addressesLine({ addresses }: AccountSummary): string {
  if (!addresses.count) return 'None saved yet';
  const saved = `${addresses.count} saved`;
  return addresses.default_label ? `${saved} · ${addresses.default_label} is default` : saved;
}

/** "3 reviews · 1 order to review", or only the part there is. */
function reviewsLine({ reviews_written, orders_to_review }: AccountSummary): string {
  const parts = [
    reviews_written ? count(reviews_written, 'review', 'reviews') : null,
    orders_to_review ? count(orders_to_review, 'order to review', 'orders to review') : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No reviews yet';
}

/**
 * The buyer's own things in one list (#73): who is signed in, their addresses, saved items and
 * reviews with counts from one summary request, and Sign out, which says what happens to the cart.
 */
export function AccountScreen() {
  const theme = useTheme();
  const { isSignedIn } = useAuth();
  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <Text variant="titleRoot" style={{ paddingHorizontal: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[2] }}>
        Account
      </Text>
      {/* The root layout waits for Clerk to restore the session, so this is never a false "signed out". */}
      {isSignedIn ? (
        <SignedIn />
      ) : (
        <SignInPrompt title="Sign in to Oja" message="Check out, track your orders and save favourites." />
      )}
    </SafeAreaView>
  );
}

function SignedIn() {
  const theme = useTheme();
  const toast = useToast();
  const { userId } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const summary = useAccountSummary(userId);
  const [signingOut, setSigningOut] = useState(false);

  const name = user?.fullName?.trim() || null;
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const provider = user?.externalAccounts.map((account) => PROVIDERS[account.provider]).find(Boolean);
  // Without a name the email takes the name's place. A long email breaks before its "@", never mid-word.
  const breakable = email?.replace('@', '\u200B@') ?? null;
  const heading = name ?? breakable;
  const identity = [name ? breakable : null, provider ? `signed in with ${provider}` : null].filter(Boolean).join(' · ');

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      // While the session still works, so the API knows whose device it is.
      await forgetDevice();
      // The root layout clears cached data when the buyer changes.
      await signOut();
    } catch {
      toast({ message: "Couldn't sign you out. Try again.", tone: 'problem' });
    } finally {
      setSigningOut(false);
    }
  };

  const subtitle = (line: (s: AccountSummary) => string) => (summary.data ? line(summary.data) : undefined);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: theme.space[8] }}>
      <View style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[4], paddingTop: theme.space[1], paddingBottom: theme.space[4] }]}>
        <View
          style={[
            styles.avatar,
            { width: theme.shopMark.md.size * (56 / 48), height: theme.shopMark.md.size * (56 / 48), borderRadius: theme.radius.lg, backgroundColor: theme.colors.sun },
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <Text variant="titlePushed" style={{ color: theme.colors.onSun }}>
            {shopInitials(name ?? email ?? '')}
          </Text>
        </View>
        <View style={styles.fill}>
          {heading ? <Text variant="titlePushed">{heading}</Text> : null}
          {identity ? (
            <Text variant="meta" tone="muted">
              {identity}
            </Text>
          ) : null}
        </View>
      </View>

      {summary.error && !summary.data ? (
        <View style={{ paddingHorizontal: theme.space[4] }}>
          <Button label="Couldn't load your counts. Try again" variant="link" icon="refresh" onPress={() => void summary.refetch()} style={styles.link} />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: theme.space[4] }}>
        <AccountRow icon="pin" title="Addresses" subtitle={subtitle(addressesLine)} loading={summary.isPending} onPress={() => router.push('/addresses')} />
        <AccountRow
          icon="heart"
          title="Saved items"
          subtitle={subtitle((s) => (s.saved_items ? count(s.saved_items, 'item', 'items') : 'Nothing saved yet'))}
          loading={summary.isPending}
          onPress={() => router.push('/wishlist')}
        />
        <AccountRow icon="star" title="My reviews" subtitle={subtitle(reviewsLine)} loading={summary.isPending} onPress={openMyReviews} />
        <ListRow
          title={signingOut ? 'Signing out…' : 'Sign out'}
          subtitle="Your cart stays on this phone"
          destructive
          leading={<RowIcon name="logout" danger />}
          onPress={signingOut ? undefined : () => void onSignOut()}
        />
      </View>
    </ScrollView>
  );
}

function AccountRow({
  icon,
  title,
  subtitle,
  loading,
  onPress,
}: Readonly<{ icon: IconName; title: string; subtitle?: string; loading: boolean; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      leading={<RowIcon name={icon} />}
      trailing={
        <View style={[styles.row, { gap: theme.space[2] }]}>
          {loading ? <Skeleton width={theme.space[12] * 2} height={theme.type.meta.lineHeight} /> : null}
          <Icon name="fwd" use="step" color={theme.colors.muted} />
        </View>
      }
      onPress={onPress}
    />
  );
}

/** A row's icon on its Mist tile: accent, or red for Sign out. */
function RowIcon({ name, danger }: Readonly<{ name: IconName; danger?: boolean }>) {
  const theme = useTheme();
  const size = theme.shopMark.sm.size * (36 / 32);
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: theme.radius.md, backgroundColor: danger ? theme.colors.dangerBg : theme.colors.tile },
      ]}>
      <Icon name={name} use="step" color={danger ? theme.colors.dangerText : theme.colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  link: { paddingHorizontal: 0, alignSelf: 'flex-start' },
});
