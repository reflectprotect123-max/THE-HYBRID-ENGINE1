import { useMemo } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { radius, useTheme, type Palette } from '@hybrid/design';
import { font } from '../../ui';

/*
 * The logger's styles, in one place, measured off the prototype.
 *
 * TWO departures from how the rest of this app is styled, both deliberate and
 * both forced by what this screen is FOR.
 *
 * 1. No NativeWind classNames anywhere under this directory. The harness these
 *    screens are judged in is an Expo WEB export, and NativeWind's web output
 *    is a stylesheet Metro emits alongside the bundle — a `className` that
 *    styles correctly on Android would arrive in the harness unstyled, and the
 *    visual gate would be measuring the absence of a CSS file rather than the
 *    screen. React Native `style` objects go through react-native-web's own
 *    conversion and land as real inline styles, so what the gate sees is what
 *    the phone renders.
 *
 * 2. The numbers below are the PROTOTYPE's own px values, not the design
 *    system's 8px scale. This file used to map through `space`/`fontSize`, and
 *    the drift was measurable: the prototype's weight figure is 44px and the
 *    token scale's nearest is 34, its chips are 44 tall where the scale's
 *    nearest is 40, its block title is 21 where the scale has 20. None of
 *    those is visible on its own; stacked down a screen they pushed everything
 *    below the hot card out by a growing offset, and the visual gate reported
 *    it as a double-digit difference.
 *
 *    `checks/fixtures/prototype/rolling-logger.html` is the specification for
 *    this screen and the gate measures against it, so here the specification
 *    outranks the scale. That is a scoped exception, argued in place, for the
 *    one surface in this app that has a pixel-exact spec — not a licence to
 *    invent off-grid values anywhere else.
 *
 * Every value below is traceable to a class in that file: `.hot`, `.receipt`,
 * `.future`, `.seg`, `.restover`, `.finish` and their neighbours.
 */

/**
 * The face every FIGURE is set in.
 *
 * The prototype's `--mono` is `ui-monospace, "SF Mono", "JetBrains Mono",
 * Menlo, monospace` — a SYSTEM stack, not a bundled face. So the faithful
 * equivalent here is the platform's own monospace rather than a webfont added
 * to the APK: `'monospace'` is what Android resolves, `Menlo` is the iOS name,
 * and react-native-web passes the keyword through to the CSS generic, which is
 * the tail of the prototype's own stack.
 *
 * This does not reopen the rule that every piece of text in this app goes
 * through Inter. That rule exists so PROSE never falls back to system Roboto
 * by accident. This is a deliberate second face for figures and small caps
 * labels, chosen because the specification chose it.
 */
const mono = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

function build(color: Palette) {
  return StyleSheet.create({
    /* ---- shell ---------------------------------------------------- */
    screen: { flex: 1, backgroundColor: color.bg },
    appbar: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
    appbarTitle: { fontFamily: font.semi, fontSize: 17, color: color.text, letterSpacing: -0.17 },
    /* `.blockscreen`: 16px top, 14px sides. Its 120px foot is the prototype's
       room for a floating control this app does not have. */
    scroll: { paddingHorizontal: 14, paddingTop: 0, paddingBottom: 40 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyTitle: { fontFamily: font.semi, fontSize: 21, color: color.text, textAlign: 'center' },
    emptyBody: { fontFamily: font.reg, fontSize: 14, color: color.muted, marginTop: 6, textAlign: 'center' },

    /* ---- block strip (.strip / .seg) -------------------------------- */
    strip: { flexDirection: 'row', gap: 5, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: color.line },
    seg: { position: 'relative', height: 24, flex: 1, borderRadius: 7, borderWidth: 1, backgroundColor: color.panel, overflow: 'hidden', justifyContent: 'center' },
    segCurrent: { borderColor: color.doneLine },
    segIdle: { borderColor: color.line2 },
    segFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRightWidth: 1, borderRightColor: color.goldLine, backgroundColor: color.goldWash },
    segLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 0.54, paddingHorizontal: 5, textAlign: 'center', textTransform: 'uppercase' },
    segLabelCurrent: { color: color.gold2 },
    segLabelIdle: { color: color.dim },

    /* ---- block screen (.btitle / .bsub / .roundlbl) ------------------ */
    block: { paddingTop: 16, paddingBottom: 24 },
    blockTitle: { fontFamily: font.semi, fontSize: 21, color: color.text, letterSpacing: -0.315, marginVertical: 2, marginHorizontal: 2 },
    blockNote: { fontFamily: mono, fontSize: 11, color: color.dim, marginHorizontal: 2, marginBottom: 14 },
    roundLabel: { fontFamily: mono, fontSize: 10, letterSpacing: 1.2, color: color.dim, marginTop: 14, marginBottom: 6, marginHorizontal: 4, textTransform: 'uppercase' },
    roundHint: { color: color.gold2 },

    /* ---- receipts and upcoming rows (.receipt / .future) ------------- */
    receipt: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, borderWidth: 1, borderColor: color.line, backgroundColor: color.well, paddingHorizontal: 12, paddingVertical: 9, marginVertical: 6 },
    receiptTick: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: color.doneLine, backgroundColor: color.doneBg, alignItems: 'center', justifyContent: 'center' },
    receiptLabel: { flex: 1, fontFamily: font.med, fontSize: 13, color: color.muted },
    receiptValue: { fontFamily: mono, fontSize: 12, color: color.doneInk },

    upcoming: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, borderRadius: 11, borderWidth: 1, borderStyle: 'dashed', borderColor: color.line, paddingHorizontal: 12, paddingVertical: 9, marginVertical: 6 },
    upcomingGripped: { paddingLeft: 34 },
    upcomingLabel: { fontFamily: font.med, fontSize: 13, color: color.dim },
    upcomingValue: { fontFamily: mono, fontSize: 11, color: color.dim },
    grip: { position: 'absolute', left: 4, top: 0, bottom: 0, width: 28, alignItems: 'center', justifyContent: 'center' },
    gripGlyph: { width: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
    gripDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: color.dim },

    /* The tick, as two rotated bars — see `Tick` in BlockScreen.tsx for why it
       must not be a text glyph. */
    tick: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
    tickShort: { position: 'absolute', width: 2, height: 5, borderRadius: 1, backgroundColor: color.doneInk, transform: [{ rotate: '-45deg' }], left: 2, top: 5 },
    tickLong: { position: 'absolute', width: 2, height: 10, borderRadius: 1, backgroundColor: color.doneInk, transform: [{ rotate: '45deg' }], left: 6, top: 1 },

    skipRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
    pill: { height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line2, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
    pillInk: { fontFamily: font.med, fontSize: 12, color: color.muted },
    /* `.warmclock .cbtn` is 44 tall in the prototype, and 44 is also the
       platform touch-target floor. The first port took the 32px pill by
       mistake and missed both. */
    clockBtn: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: color.goldLine, backgroundColor: color.goldWash, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
    clockBtnInk: { fontFamily: font.semi, fontSize: 14, color: color.gold2 },

    /* ---- hot card (.hot) -------------------------------------------- */
    card: { borderRadius: 16, borderWidth: 1, borderColor: color.goldLine, backgroundColor: color.panel, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12, marginVertical: 6 },
    hotName: { fontFamily: font.semi, fontSize: 17, color: color.text, letterSpacing: -0.17 },
    hotPresc: { fontFamily: mono, fontSize: 11, color: color.dim, marginTop: 1 },
    /* minHeight matches `.hwhy`: the card must not jump when a short coaching
       line is replaced by a long one. */
    hotWhy: { fontFamily: mono, fontSize: 10.5, color: color.gold, marginTop: 6, minHeight: 14 },

    hotRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
    fieldLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 1.17, color: color.dim, textTransform: 'uppercase' },
    kgWrap: { flex: 1, minWidth: 0 },
    kgLine: { flexDirection: 'row', alignItems: 'baseline' },
    kgValue: { fontFamily: mono, fontSize: 44, color: color.text, letterSpacing: -0.88 },
    kgUnit: { fontFamily: font.reg, fontSize: 16, color: color.dim, marginLeft: 2 },
    kgInput: { width: 130, borderRadius: 8, borderWidth: 1, borderColor: color.goldLine, backgroundColor: color.panel2, paddingHorizontal: 8, paddingVertical: 0, fontFamily: mono, fontSize: 40, color: color.text },
    plates: { fontFamily: mono, fontSize: 10.5, color: color.muted, marginTop: 4 },

    repsCol: { alignItems: 'center', gap: 2 },
    repsColWide: { flex: 1 },
    repsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepper: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: color.line2, backgroundColor: color.panel2, alignItems: 'center', justifyContent: 'center' },
    stepperInk: { fontFamily: font.reg, fontSize: 20, color: color.text },
    repsValue: { minWidth: 62, textAlign: 'center', fontFamily: mono, fontSize: 24, color: color.text },

    chipsLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 1.17, color: color.dim, marginTop: 12, marginBottom: 6, textTransform: 'uppercase' },
    chips: { flexDirection: 'row', gap: 6 },
    chip: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    chipOn: { borderColor: color.doneLine, backgroundColor: color.doneBg },
    chipOff: { borderColor: color.line2, backgroundColor: color.panel2 },
    chipInkOn: { fontFamily: mono, fontSize: 13, color: color.doneInk },
    chipInkOff: { fontFamily: mono, fontSize: 13, color: color.muted },

    /* `.logbtn` — the one control set in the UI face rather than the mono one. */
    cta: { height: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    ctaOn: { backgroundColor: color.gold2 },
    ctaOff: { borderWidth: 1, borderColor: color.line2, backgroundColor: color.panel2 },
    ctaInkOn: { fontFamily: font.semi, fontSize: 15, color: color.onAccent },
    ctaInkOff: { fontFamily: font.semi, fontSize: 15, color: color.dim },

    /* ---- piece card (.warmclock) ------------------------------------ */
    clockRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
    clock: { fontFamily: mono, fontSize: 40, color: color.gold2, letterSpacing: -0.8 },

    /* ---- rest takeover (.restover) ---------------------------------- */
    /*
     * OPAQUE, where the prototype is 97% plus a 14px backdrop blur.
     *
     * React Native has no backdrop-filter and no way to get one without a new
     * native module. Keeping the 97% on its own was the worse of the two
     * errors: against a near-black ground, 3% of near-white text is still
     * legible, so the block screen sat SHARPLY behind the dial where the
     * prototype blurs it into shapes. Fully opaque is both closer to what the
     * prototype looks like and the honest answer to a capability this platform
     * does not have.
     */
    takeover: { ...StyleSheet.absoluteFillObject, zIndex: 30, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: color.bg, padding: 24 },
    takeoverKind: { fontFamily: mono, fontSize: 10, letterSpacing: 1.6, color: color.dim, textTransform: 'uppercase' },
    dialWrap: { marginTop: 14, marginBottom: 18 },
    dialInk: { fontFamily: mono, fontSize: 52, color: color.gold2, letterSpacing: -1.04 },
    dialSpacer: { height: 18 },
    nextCard: { minWidth: 260, borderRadius: 15, borderWidth: 1, borderColor: color.goldLine, backgroundColor: color.panel, paddingHorizontal: 18, paddingVertical: 13, alignItems: 'center' },
    nextKind: { fontFamily: mono, fontSize: 9, letterSpacing: 1.26, color: color.dim, textTransform: 'uppercase' },
    nextName: { fontFamily: font.semi, fontSize: 16, color: color.text, marginTop: 2 },
    nextBig: { fontFamily: mono, fontSize: 26, color: color.gold2, marginTop: 3 },
    nextWhy: { fontFamily: mono, fontSize: 10, color: color.gold, marginTop: 4 },
    takeoverActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
    ghost: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: color.line2, backgroundColor: color.panel, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
    ghostInk: { fontFamily: font.med, fontSize: 14, color: color.text },
    takeoverCta: { flexDirection: 'row', gap: 7, height: 46, borderRadius: 12, borderWidth: 1, borderColor: color.goldLine, backgroundColor: color.goldWash, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
    takeoverCtaInk: { fontFamily: font.semi, fontSize: 14, color: color.gold2 },
    chevron: { width: 9, height: 12, justifyContent: 'center' },
    chevronUp: { position: 'absolute', width: 1.6, height: 7, borderRadius: 1, backgroundColor: color.gold2, transform: [{ rotate: '-45deg' }], left: 3, top: 1 },
    chevronDown: { position: 'absolute', width: 1.6, height: 7, borderRadius: 1, backgroundColor: color.gold2, transform: [{ rotate: '45deg' }], left: 3, top: 5 },

    /* ---- finish card (.finish) -------------------------------------- */
    finish: { paddingTop: 28 },
    finishTitle: { fontFamily: font.semi, fontSize: 21, color: color.text },
    finishSub: { fontFamily: mono, fontSize: 11, color: color.dim, marginTop: 4, marginBottom: 16 },
    stats: {},
    stat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: color.line },
    statLabel: { fontFamily: font.reg, fontSize: 14, color: color.text },
    statValue: { fontFamily: mono, fontSize: 14, color: color.gold2 },
    comment: { height: 84, borderRadius: 12, borderWidth: 1, borderColor: color.line2, backgroundColor: color.panel, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16, fontFamily: font.reg, fontSize: 14, color: color.text, textAlignVertical: 'top' },

    /* `.finish` again — the block-done banner is the same construction, so it
       takes the same metrics rather than a second set that could drift. */
    blockDone: { paddingTop: 28 },
    blockDoneTitle: { fontFamily: font.semi, fontSize: 21, color: color.text },
    blockDoneSub: { fontFamily: mono, fontSize: 11, color: color.dim, marginTop: 4, marginBottom: 16 },
  });
}

export type LoggerStyles = ReturnType<typeof build>;

export function useLoggerStyles(): LoggerStyles {
  const { color } = useTheme();
  return useMemo(() => build(color), [color]);
}
