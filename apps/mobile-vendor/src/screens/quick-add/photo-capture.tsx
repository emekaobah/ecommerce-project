import { Button, Text, useTheme } from '@oja/ui';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** A photo as the quick-add API takes it. */
export type ProductPhoto = { mime_type: 'image/jpeg'; data: string; uri: string };

type Props = { onTaken: (photo: ProductPhoto) => void; onCancel: () => void };

/**
 * Takes the product's photo, full screen. The photo becomes the catalogue's image after review
 * and the AI drafts the description from it, so staff are asked for a clean shot: product flat
 * on a plain surface, not in hand (docs/design.md, Images).
 */
export function PhotoCapture({ onTaken, onCancel }: Props) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async () => {
    setTaking(true);
    setError(null);
    try {
      // JPEG at half quality keeps a phone photo well under the API's 10 MB.
      const picture = await camera.current?.takePictureAsync({ base64: true, quality: 0.5, imageType: 'jpg', shutterSound: false });
      if (!picture?.base64) throw new Error('The camera returned no photo. Try again.');
      onTaken({ mime_type: 'image/jpeg', data: picture.base64, uri: picture.uri });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTaking(false);
    }
  };

  if (!permission?.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: theme.space.lg, gap: theme.space.md }}>
        <Text variant="title">Photo of the product</Text>
        <Text tone="secondary">
          {permission?.canAskAgain === false
            ? 'Camera access is off. Turn it on in Settings to photograph the product.'
            : 'Allow the camera to photograph the product.'}
        </Text>
        {permission?.canAskAgain !== false ? <Button label="Allow camera" onPress={() => void requestPermission()} /> : null}
        <Button label="Cancel" variant="link" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={camera} style={styles.fill} facing="back" mode="picture" />
      <View style={{ padding: theme.space.md, gap: theme.space.sm, backgroundColor: theme.colors.background }}>
        <Text tone="secondary">Lay the product flat on a plain surface, label up, and fill the frame.</Text>
        {error ? <Text tone="danger">{error}</Text> : null}
        <Button label="Take photo" onPress={() => void take()} loading={taking} />
        <Button label="Cancel" variant="link" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
