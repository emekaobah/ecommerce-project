import { useTheme } from '@oja/ui';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/** The shop's card on Settings: its mark, name and state line, then the shop's switches. */
export function ShopCard({ children }: Readonly<{ sellerId: string | undefined; children: ReactNode }>) {
  const theme = useTheme();
  return <View style={{ gap: theme.space[4] }}>{children}</View>;
}
