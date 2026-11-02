import { HStack, Image, Circle, RoundedRectangle, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  background,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  strokeBorder,
} from '@expo/ui/swift-ui/modifiers';
import { VENDOR_ACTIVITY_FACTORY, type VendorActivityContent } from '@oja/domain';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

/**
 * The shop's orders on the Lock Screen and in the Dynamic Island, as drawn in the screens
 * catalogue (#141). The whole function runs as a string in the widget's own JS runtime, so it
 * can't use anything from outside it: not the theme, not a helper. The colours are the
 * catalogue's. The extension doesn't bundle the app's fonts, so text uses the system font.
 *
 * The countdown is SwiftUI's `Text(timerInterval:)`, which the phone ticks itself. It reads
 * `5:12:08` and stops at zero; it draws nothing if its start is after its end, hence the `min`.
 */
const ShopActivityLayout = (props: VendorActivityContent, environment: LiveActivityEnvironment) => {
  'widget';
  const palette = (dark: boolean) =>
    dark
      ? { card: '#1C1C1F', ink: '#F2F2F4', muted: '#B4B4BC', tile: '#26262A', urgent: '#F0A474', urgentInk: '#12162B', countInk: '#F2C76B', countTile: '#2E2614', urgentCountTile: '#30221A' }
      : { card: '#FFFFFF', ink: '#12162B', muted: '#5B6178', tile: '#EEF0F7', urgent: '#90411A', urgentInk: '#FFFFFF', countInk: '#714800', countTile: '#FDF1D8', urgentCountTile: '#FBEDE3' };
  const SUN = '#F2B33D';
  const SUN_TEXT = '#F2C76B';
  const MARK = '#3D4DBB';
  const LIGHT_MARK = '#1B2559';
  const EMBER_TEXT = '#F0A474';
  const INK_ON_SUN = '#12162B';
  // The island is black in both appearances, so its content always uses the dark colours, on darker tiles.
  const dark = environment.colorScheme === 'dark';
  const screen = palette(dark);
  const island = { ...palette(true), tile: '#1C1C1F' };

  const { shop, counts, urgent } = props;
  const deadlineOf = (at: VendorActivityContent['deadline']) => (at ? new Date(at) : null);
  const deadline = deadlineOf(props.deadline);
  const urgentOr = (whenUrgent: string, otherwise: string) => (urgent ? whenUrgent : otherwise);
  const shown = (count: number) => (count > 99 ? '99+' : String(count));
  const open = counts.picking + counts.ready + counts.out;

  const timer = (color: string, size: number, width: number) =>
    deadline ? (
      <Text
        timerInterval={{ lower: new Date(Math.min(Date.now(), deadline.getTime())), upper: deadline }}
        modifiers={[font({ size, weight: 'bold' }), monospacedDigit(), foregroundStyle(color), multilineTextAlignment('trailing'), frame({ width }), lineLimit(1)]}
      />
    ) : null;
  const mark = (fill: string) => (
    <ZStack modifiers={[frame({ width: 22, height: 22 })]}>
      <RoundedRectangle cornerRadius={6} modifiers={[foregroundStyle(fill)]} />
      <Image systemName="bag" size={12} color="#FFFFFF" />
    </ZStack>
  );
  const tile = (colors: typeof screen, count: number, label: string) => (
    <VStack spacing={0} alignment="leading" modifiers={[frame({ maxWidth: 1000, alignment: 'leading' }), padding({ horizontal: 8, vertical: 6 }), background(colors.tile), cornerRadius(12)]}>
      <Text modifiers={[font({ size: 20, weight: 'heavy' }), foregroundStyle(colors.ink), monospacedDigit()]}>{shown(count)}</Text>
      <Text modifiers={[font({ size: 10.5, weight: 'bold' }), foregroundStyle(colors.muted), lineLimit(1)]}>{label}</Text>
    </VStack>
  );
  const chip = (fill: string, ink: string, size: number) => (
    <HStack spacing={4} modifiers={[padding({ horizontal: 10, vertical: 5 }), background(fill), cornerRadius(999)]}>
      <Image systemName="clock" size={13} color={ink} />
      {timer(ink, size, 62)}
    </HStack>
  );
  const deadlineChip = (colors: typeof screen) => (urgent ? chip(colors.urgent, colors.urgentInk, 13) : chip(SUN, INK_ON_SUN, 13));
  const details = (colors: typeof screen, markFill: string) => (
    <VStack spacing={8} alignment="leading">
      <HStack spacing={8}>
        {mark(markFill)}
        <Text modifiers={[font({ size: 12, weight: 'heavy' }), foregroundStyle(colors.ink), lineLimit(1)]}>{shop}</Text>
        <Spacer />
      </HStack>
      <HStack spacing={6}>
        {tile(colors, counts.new, 'New')}
        {tile(colors, counts.picking, 'Picking')}
        {tile(colors, counts.ready, 'Ready')}
        {tile(colors, counts.out, 'Out')}
      </HStack>
      {deadline ? (
        <HStack spacing={8}>
          <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(colors.muted), lineLimit(1)]}>{urgentOr('Under 2 hours to accept', 'Next to accept')}</Text>
          <Spacer />
          {deadlineChip(colors)}
        </HStack>
      ) : (
        <Text modifiers={[font({ size: 12.5 }), foregroundStyle(colors.muted), lineLimit(1)]}>No new orders to accept.</Text>
      )}
    </VStack>
  );
  const accent = urgentOr(EMBER_TEXT, SUN_TEXT);
  const newCount = (color: string) => (
    <HStack spacing={3}>
      <Image systemName="bell" size={13} color={color} />
      <Text modifiers={[font({ size: 13, weight: 'heavy' }), foregroundStyle(color), monospacedDigit()]}>{shown(counts.new)}</Text>
    </HStack>
  );
  const screenMark = () => (dark ? MARK : LIGHT_MARK);
  const smallCountdown = () => (deadline ? deadlineChip(screen) : <Text modifiers={[font({ size: 11 }), foregroundStyle(screen.muted), lineLimit(1)]}>No new orders to accept.</Text>);
  const compactLeading = () => (deadline ? newCount(accent) : mark(MARK));
  const compactTrailing = () => (deadline ? timer(accent, 13, 56) : <Text modifiers={[font({ size: 13, weight: 'heavy' }), foregroundStyle(island.ink), lineLimit(1)]}>{`${open} open`}</Text>);
  const minimal = () =>
    deadline ? (
      <ZStack modifiers={[frame({ width: 24, height: 24 })]}>
        <Circle modifiers={[foregroundStyle(urgentOr(island.urgentCountTile, SUN))]} />
        {urgent ? <Circle modifiers={[strokeBorder({ content: EMBER_TEXT, style: { lineWidth: 1.5 } })]} /> : null}
        <Text modifiers={[font({ size: 12, weight: 'heavy' }), foregroundStyle(urgentOr(EMBER_TEXT, INK_ON_SUN)), monospacedDigit()]}>{shown(counts.new)}</Text>
      </ZStack>
    ) : (
      mark(MARK)
    );

  return {
    banner: <VStack modifiers={[padding({ all: 14 }), activityBackgroundTint(screen.card)]}>{details(screen, screenMark())}</VStack>,
    bannerSmall: (
      <VStack spacing={6} alignment="leading" modifiers={[padding({ horizontal: 12, vertical: 10 }), activityBackgroundTint(screen.card)]}>
        <HStack spacing={6}>
          <HStack spacing={3} modifiers={[padding({ horizontal: 8, vertical: 2 }), background(urgentOr(screen.urgentCountTile, screen.countTile)), cornerRadius(999)]}>
            <Image systemName="bell" size={13} color={urgentOr(screen.urgent, screen.countInk)} />
            <Text modifiers={[font({ size: 13, weight: 'heavy' }), foregroundStyle(urgentOr(screen.urgent, screen.countInk)), monospacedDigit()]}>{shown(counts.new)}</Text>
          </HStack>
          <Text modifiers={[font({ size: 13, weight: 'heavy' }), foregroundStyle(screen.ink)]}>New</Text>
        </HStack>
        {smallCountdown()}
        <Text modifiers={[font({ size: 11 }), foregroundStyle(screen.muted), lineLimit(1)]}>{shop}</Text>
      </VStack>
    ),
    compactLeading: compactLeading(),
    compactTrailing: compactTrailing(),
    minimal: minimal(),
    expandedBottom: details(island, MARK),
  };
};

export const shopActivity = createLiveActivity<VendorActivityContent>(VENDOR_ACTIVITY_FACTORY, ShopActivityLayout);
