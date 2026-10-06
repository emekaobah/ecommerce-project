import { photoUploadSize } from '@oja/domain';
import { Button, Text, useTheme } from '@oja/ui';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** A photo as the quick-add API takes it. */
export type ProductPhoto = { mime_type: 'image/jpeg'; data: string; uri: string };

/** JPEG quality for the uploaded photo: plenty for a catalogue image and the AI's read of the label. */
const UPLOAD_QUALITY = 0.7;

/**
 * Shrinks a camera photo to the upload size (photoUploadSize) and re-encodes it as JPEG, so an
 * upload over mobile data stays a few hundred KB rather than several MB.
 */
async function shrinkForUpload(picture: { uri: string; width: number; height: number }): Promise<ProductPhoto> {
  const context = ImageManipulator.manipulate(picture.uri);
  try {
    const size = photoUploadSize(picture);
    if (size) context.resize(size);
    const image = await context.renderAsync();
    try {
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: UPLOAD_QUALITY, base64: true });
      if (!saved.base64) throw new Error('Could not prepare the photo. Try again.');
      return { mime_type: 'image/jpeg', data: saved.base64, uri: saved.uri };
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
}

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
      // Full quality here: the photo is shrunk and compressed once, in shrinkForUpload.
      const picture = await camera.current?.takePictureAsync({ quality: 1, imageType: 'jpg', shutterSound: false });
      if (!picture) throw new Error('The camera returned no photo. Try again.');
      onTaken(await shrinkForUpload(picture));
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
