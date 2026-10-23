import { Icon, ListRow, useTheme, type IconName } from '@oja/ui';
import { useRouter } from 'expo-router';
import { Linking, View } from 'react-native';

import { useMemberEmail, useMemberships } from '@/api/sellers';
import { env } from '@/config/env';
import { signOut } from '@/session/sign-out';

/** Where the shop's opening hours are edited: the web vendor panel, served by the API. */
const VENDOR_PANEL_URL = `${env.apiUrl}/dashboard`;

/** A row's 36 px icon tile: Mist with an indigo icon, or the danger tint for Sign out. */
function IconTile({ name, danger }: Readonly<{ name: IconName; danger?: boolean }>) {
  const theme = useTheme();
  // The catalogue's 36 px tile, scaled, is the hit area.
  const size = theme.hitArea;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: danger ? theme.colors.dangerBg : theme.colors.tile,
      }}>
      <Icon name={name} color={danger ? theme.colors.danger : theme.colors.accent} />
    </View>
  );
}

/**
 * Below the shop's card (catalogue v-shop #4): Switch shop for a member of more than one,
 * Opening hours (edited on the web, which the row says), and Sign out with the member's email.
 */
export function AccountRows({ sellerId }: Readonly<{ sellerId: string | undefined }>) {
  const theme = useTheme();
  const router = useRouter();
  const memberships = useMemberships();
  const email = useMemberEmail(sellerId);
  const shops = memberships.data?.length ?? 0;

  return (
    <View>
      {shops > 1 ? (
        <ListRow
          title="Switch shop"
          subtitle={`You work at ${shops} shops`}
          leading={<IconTile name="swap" />}
          trailing={<Icon name="fwd" color={theme.colors.muted} />}
          onPress={() => router.push('/switch-shop')}
        />
      ) : null}
      <ListRow
        title="Opening hours"
        subtitle="Edit in the vendor panel on the web"
        leading={<IconTile name="clock" />}
        trailing={<Icon name="share" color={theme.colors.muted} />}
        onPress={() => void Linking.openURL(VENDOR_PANEL_URL)}
      />
      <ListRow
        title="Sign out"
        subtitle={email.data ?? undefined}
        destructive
        leading={<IconTile name="logout" danger />}
        onPress={() => void signOut()}
      />
    </View>
  );
}
