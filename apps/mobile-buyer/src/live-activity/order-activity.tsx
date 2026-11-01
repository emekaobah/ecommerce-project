import { Capsule, Circle, Gauge, HStack, Image, RoundedRectangle, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { activityBackgroundTint, font, foregroundStyle, frame, gaugeStyle, lineLimit, padding, scaleEffect, tint } from '@expo/ui/swift-ui/modifiers';
import { BUYER_ACTIVITY_FACTORY, type BuyerActivityContent } from '@oja/domain';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

/**
 * The buyer's shop order on the Lock Screen and in the Dynamic Island, as drawn in the screens
 * catalogue (#141): each step, the pickup code, and each ending. The whole function runs as a string in the widget's own JS runtime, so it
 * can't use anything from outside it: not the theme, not a helper. The colours are the
 * catalogue's. The extension doesn't bundle the app's fonts, so text uses the system font.
 */
const OrderActivityLayout = (props: BuyerActivityContent, environment: LiveActivityEnvironment) => {
  'widget';
  const SYMBOLS = { box: 'shippingbox', truck: 'truck.box', store: 'storefront', check: 'checkmark', x: 'xmark', clock: 'clock', info: 'info.circle' } as const;
  const palette = (dark: boolean) =>
    dark
      ? { card: '#1C1C1F', ink: '#F2F2F4', muted: '#B4B4BC', tile: '#26262A', accent: '#AEB8FF', mark: '#3D4DBB', chip: '#23263A', chipInk: '#AEB8FF', go: '#14281D', goInk: '#6FD6A0', mute: '#26262A', muteInk: '#B4B4BC' }
      : { card: '#FFFFFF', ink: '#12162B', muted: '#5B6178', tile: '#EEF0F7', accent: '#1B2559', mark: '#1B2559', chip: '#EEF0F7', chipInk: '#1B2559', go: '#E3F2EA', goInk: '#1E7A4C', mute: '#F0F1F4', muteInk: '#5B6178' };
  // The island is black in both appearances, so its content always uses the dark colours.
  const screen = palette(environment.colorScheme === 'dark');
  const island = { ...palette(true), tile: '#333338' };
  const { step, outcome, code } = props;
  const symbol = SYMBOLS[step.icon];
  const stepLine = step.next ? `Step ${step.index} of ${step.total} · Next: ${step.next}` : `Step ${step.index} of ${step.total}`;
  const refundLine = (refund: string | null) => (refund ? ` You'll be refunded ${refund}.` : '');
  // Each ending's sentence, as its push says it. Only delivered and collected end with the bar full.
  const endingLine = !outcome
    ? null
    : outcome.kind === 'cancelled'
      ? `${outcome.reason}.${refundLine(outcome.refund)}`
      : outcome.kind === 'not_collected'
        ? `It wasn't collected in time.${refundLine(outcome.refund)}${outcome.kept ? ` Fresh items aren't refunded: ${outcome.kept}.` : ''}`
        : outcome.kind === 'delivered'
          ? `Your order from ${props.shop} has arrived.`
          : `You collected your order from ${props.shop}. Your receipt is in your email.`;
  const endedWell = outcome?.kind === 'delivered' || outcome?.kind === 'collected';
  // Green once it's ready or done, muted once it has gone wrong, as on the catalogue's chips.
  const tones = (colors: typeof screen) =>
    code || endedWell ? { chip: colors.go, ink: colors.goInk } : outcome ? { chip: colors.mute, ink: colors.muteInk } : { chip: colors.chip, ink: colors.chipInk };

  const mark = (colors: typeof screen) => (
    <ZStack modifiers={[frame({ width: 22, height: 22 })]}>
      <RoundedRectangle cornerRadius={6} modifiers={[foregroundStyle(colors.mark)]} />
      <Image systemName="bag" size={12} color="#FFFFFF" />
    </ZStack>
  );
  const chip = (colors: typeof screen, size: number) => (
    <ZStack modifiers={[frame({ width: size, height: size })]}>
      <Circle modifiers={[foregroundStyle(tones(colors).chip)]} />
      <Image systemName={symbol} size={size * 0.55} color={tones(colors).ink} />
    </ZStack>
  );
  const bar = (colors: typeof screen, height: number) => (
    <HStack spacing={3}>
      {Array.from({ length: step.total }, (_, i) => (
        <Capsule key={i} modifiers={[foregroundStyle(i < step.index ? colors.accent : colors.tile), frame({ height })]} />
      ))}
    </HStack>
  );
  const heading = (colors: typeof screen) => (
    <HStack spacing={8}>
      {mark(colors)}
      <Text modifiers={[font({ size: 12, weight: 'heavy' }), foregroundStyle(colors.ink), lineLimit(1)]}>{props.shop}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 11.5, weight: 'bold' }), foregroundStyle(colors.muted)]}>{props.number}</Text>
    </HStack>
  );
  const codeText = (colors: typeof screen, size: number) => <Text modifiers={[font({ size, weight: 'heavy' }), foregroundStyle(colors.ink), lineLimit(1)]}>{code ?? ''}</Text>;
  const details = (colors: typeof screen) => (
    <VStack spacing={8} alignment="leading">
      {heading(colors)}
      <HStack spacing={8}>
        {chip(colors, 28)}
        <Text modifiers={[font({ size: 19, weight: 'heavy' }), foregroundStyle(colors.ink), lineLimit(1)]}>{step.label}</Text>
      </HStack>
      {code ? codeText(colors, 34) : null}
      {code ? <Text modifiers={[font({ size: 11.5, weight: 'bold' }), foregroundStyle(colors.muted), lineLimit(1)]}>{`Show this code at ${props.shop}.`}</Text> : null}
      {endingLine ? <Text modifiers={[font({ size: 12.5 }), foregroundStyle(colors.muted), lineLimit(3)]}>{endingLine}</Text> : null}
      {!outcome || endedWell ? bar(colors, 6) : null}
      {outcome ? null : <Text modifiers={[font({ size: 11.5, weight: 'bold' }), foregroundStyle(colors.muted), lineLimit(1)]}>{stepLine}</Text>}
    </VStack>
  );
  // A ring filling with the step out of the path's steps, around the step's symbol.
  const ring = (
    <ZStack modifiers={[frame({ width: 24, height: 24 })]}>
      <Gauge value={step.index} min={0} max={step.total} modifiers={[gaugeStyle('circularCapacity'), tint(island.chipInk), scaleEffect(0.42)]} />
      <Image systemName={symbol} size={11} color={island.chipInk} />
    </ZStack>
  );

  return {
    banner: <VStack modifiers={[padding({ all: 14 }), activityBackgroundTint(screen.card)]}>{details(screen)}</VStack>,
    bannerSmall: (
      <VStack spacing={6} alignment="leading" modifiers={[padding({ horizontal: 12, vertical: 10 }), activityBackgroundTint(screen.card)]}>
        <HStack spacing={8}>
          {chip(screen, 24)}
          <Text modifiers={[font({ size: 13, weight: 'heavy' }), foregroundStyle(screen.ink), lineLimit(1)]}>{step.short}</Text>
        </HStack>
        {/* The code replaces the bar. */}
        {code ? codeText(screen, 22) : !outcome || endedWell ? bar(screen, 5) : null}
        <Text modifiers={[font({ size: 11 }), foregroundStyle(screen.muted), lineLimit(1)]}>{props.shop}</Text>
      </VStack>
    ),
    compactLeading: outcome ? mark(island) : chip(island, 24),
    // The code sits here to be read without a long-press; a finished order shows its outcome's symbol.
    compactTrailing: code ? codeText(island, 12.5) : outcome ? chip(island, 24) : ring,
    minimal: code || outcome ? chip(island, 24) : ring,
    expandedBottom: details(island),
  };
};

export const orderActivity = createLiveActivity<BuyerActivityContent>(BUYER_ACTIVITY_FACTORY, OrderActivityLayout);
