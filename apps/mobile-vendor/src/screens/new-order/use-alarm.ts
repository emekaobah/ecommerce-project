import { haptics } from '@oja/ui';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { Platform, Vibration } from 'react-native';

const ALARM = require('../../../assets/sounds/oja_alarm.wav');

/** One heavy beat, a short gap, a second: repeated every 1.6 s, the alarm ring's pulse. */
const BEAT_MS = 1600;
const DOUBLE_MS = 180;
/** Android's own pattern, repeated until cancelled: off, buzz, gap, buzz, rest. */
const ANDROID_PATTERN = [0, 400, 180, 400, 620];

/**
 * Oja's alarm sound on a loop and a repeating heavy vibration while `ringing` (Foundations,
 * Haptics: "until Accept, View order or Not now"). It rings in silent mode and lowers other
 * apps' audio rather than stopping it. Stops when `ringing` turns false or the screen closes.
 */
export function useAlarm(ringing: boolean): void {
  const player = useAudioPlayer(ALARM);

  useEffect(() => {
    if (!ringing) return;
    let stopped = false;
    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' }).then(() => {
      if (stopped) return;
      player.loop = true;
      player.play();
    });

    let beats: ReturnType<typeof setInterval> | undefined;
    if (Platform.OS === 'android') {
      Vibration.vibrate(ANDROID_PATTERN, true);
    } else {
      const beat = () => {
        haptics.newOrder();
        setTimeout(() => !stopped && haptics.newOrder(), DOUBLE_MS);
      };
      beat();
      beats = setInterval(beat, BEAT_MS);
    }

    return () => {
      stopped = true;
      player.pause();
      void player.seekTo(0);
      if (beats) clearInterval(beats);
      Vibration.cancel();
      // Other apps' audio comes back to full volume.
      void setAudioModeAsync({ interruptionMode: 'mixWithOthers' });
    };
  }, [ringing, player]);
}
