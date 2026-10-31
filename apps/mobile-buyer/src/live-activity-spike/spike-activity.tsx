// Throwaway Live Activity for the #140 device test. Not for merging.
import { Text, VStack } from '@expo/ui/swift-ui';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type SpikeProps = { status: string; step: number };

const SpikeActivity = (props: SpikeProps, environment: LiveActivityEnvironment) => {
  'widget';
  return {
    banner: (
      <VStack>
        <Text>Oja spike: {props.status}</Text>
        <Text>Step {props.step}</Text>
      </VStack>
    ),
    compactLeading: <Text>Oja</Text>,
    compactTrailing: <Text>{props.step}</Text>,
    minimal: <Text>{props.step}</Text>,
    expandedCenter: <Text>{props.status}</Text>,
  };
};

export const spikeActivity = createLiveActivity<SpikeProps>('SpikeActivity', SpikeActivity);
