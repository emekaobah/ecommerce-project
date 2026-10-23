import { Icon, SCALE, useReduceMotion, useTheme } from '@oja/ui';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

// Mockup px (catalogue `.alarm`), scaled like every token.
const scale = (px: number) => Math.round(px * SCALE);
const RING = 76;
const DISC = 62;
const PULSE_INSET = 6;
const PULSE_STROKE = 2;

/**
 * The takeover's alarm ring: a white bell on an indigo disc inside a sun ring, which is the
 * accept time left (full at 24 open hours), with an outer sun ring pulsing out every 1.6 s.
 * Under Reduce Motion the outer ring holds still at half strength. Decorative: the screen
 * announces the order and the clock speaks the time left.
 */
export function AlarmRing({ fraction }: Readonly<{ fraction: number }>) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  const ring = scale(RING);
  const disc = scale(DISC);
  const stroke = (ring - disc) / 2;
  const radius = (ring - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: theme.motion.alarmPulse,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [pulse, reduceMotion, theme.motion.alarmPulse]);

  const inset = scale(PULSE_INSET);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: ring, height: ring, marginTop: theme.space[2] }}>
      <Animated.View
        style={[
          styles.pulse,
          {
            top: -inset,
            left: -inset,
            width: ring + inset * 2,
            height: ring + inset * 2,
            borderRadius: ring,
            borderWidth: scale(PULSE_STROKE),
            borderColor: theme.colors.sun,
            opacity: reduceMotion ? 0.5 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
            transform: reduceMotion ? [] : [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.3] }) }],
          },
        ]}
      />
      <Svg width={ring} height={ring} style={StyleSheet.absoluteFill}>
        <Circle cx={ring / 2} cy={ring / 2} r={radius} stroke={theme.colors.onBandTrack} strokeWidth={stroke} fill="none" />
        <Circle
          cx={ring / 2}
          cy={ring / 2}
          r={radius}
          stroke={theme.colors.sun}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          // From twelve o'clock, clockwise.
          transform={`rotate(-90 ${ring / 2} ${ring / 2})`}
        />
      </Svg>
      <View style={[styles.disc, { margin: stroke, borderRadius: disc, backgroundColor: theme.colors.primary }]}>
        <Icon name="bell" use="quietEmblem" color={theme.colors.onBand} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pulse: { position: 'absolute' },
  disc: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
