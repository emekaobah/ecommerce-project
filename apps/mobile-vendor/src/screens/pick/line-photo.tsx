import { PhotoTile, useTheme } from '@oja/ui';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

/** A line's product photo on the product tile, as on the order screen; the tile alone when it has none. */
export function LinePhoto({ uri }: Readonly<{ uri: string | null | undefined }>) {
  const theme = useTheme();
  const size = theme.control.md;
  return (
    <PhotoTile style={{ width: size, height: size, borderRadius: theme.radius.md }}>
      {uri ? <Image source={{ uri }} contentFit="contain" style={StyleSheet.absoluteFill} /> : null}
    </PhotoTile>
  );
}
