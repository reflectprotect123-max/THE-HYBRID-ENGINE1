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
 *
 * 3. Every text style states its LINE HEIGHT, and states it in px rather than
 *    as a multiplier.
 *
 *    React Native sets none, so each line of text is whatever leading the font
 *    happens to carry; a browser with no `line-height` does the same thing but
 *    arrives at a different box for the same face at the same size. One or two
 *    pixels a row, compounding down a screen — which is what the visual gate
 *    was left reporting once the faces and the metrics matched. The numbers
 *    here were MEASURED off the prototype with `getComputedStyle`, not derived:
 *    the page runs at 1.55 with two deliberate exceptions the measurement
 *    caught — `.seg > b` pins 22px flat, and `.kgval` (with the `small` inside
 *    it) runs at 1.05 so a 44px figure does not push its own row open.
 *
 * 4. The mono styles carry an explicit `fontWeight`; the Inter ones never do.
 *
 *    `ui.tsx` is emphatic that a weight must not be set alongside one of the
 *    Inter families, because each weight there IS its own static face and
 *    asking for a second one on top invites Android to fake-bold an already
 *    bold face. That rule is about Inter. The mono face is the platform's
 *    own, has real weights, and the prototype leans on them — its figures are
 *    750 and its strip labels 500, which is why the app's regular-weight
 *    numbers read thin beside it. Weight is the correct lever there and the
 *    wrong one next door.
 *
 * 5. Vertical rhythm is BOTTOM margins only, never symmetric ones.
 *
 *    CSS collapses adjacent vertical margins: two stacked `.receipt` rows with
 *    `margin: 6px 0` sit 6px apart, not 12. React Native does not collapse
 *    anything, so the direct port paid twice at every join and the page grew
 *    by about 18px per round — visible as a diff that widened the further down
 *    the screen it went, which is exactly what the visual gate showed.
 *
 *    Rather than reproduce collapsing, this states the COLLAPSED result:
 *    every stacked element carries only a `marginBottom`, equal to what the
 *    browser actually resolves that join to. The two joins where the
 *    prototype's own margins differ — a row followed by a round label
 *    (`max(6, 14)`) and a subtitle followed by one (`max(14, 14)`) — put the
 *    difference on the round label's `marginTop`, so 6 + 8 lands on 14 either
 *    way. `blockSub` exists for the second of those; `blockNote` is the same
 *    line on a prep block, where no round label follows and the full 14 stays
 *    where the prototype put it.
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
    appbar: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
    appbarTitle: { fontFamily: font.semi, fontSize: 17, color: color.text, letterSpacing: -0.17, lineHeight: 26.35 },
    /* `.blockscreen`: 16px top, 14px sides. Its 120px foot is the prototype's
       room for a floating control this app does not have. */
    scroll: { paddingHorizontal: 14, paddingTop: 0, paddingBottom: 40 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyTitle: { fontFamily: font.semi, fontSize: 21, color: color.text, textAlign: 'center', lineHeight: 32.55 },
    emptyBody: { fontFamily: font.reg, fontSize: 14, color: color.muted, marginTop: 6, textAlign: 'center', lineHeight: 21.7 },

    /* ---- block strip (.strip / .seg) -------------------------------- */
    strip: { flexDirection: 'row', gap: 5, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: color.line },
    seg: { position: 'relative', height: 24, flex: 1, borderRadius: 7, borderWidth: 1, backgroundColor: color.panel, overflow: 'hidden', justifyContent: 'center' },
    segCurrent: { borderColor: color.doneLine },
    segIdle: { borderColor: color.line2 },
    segFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRightWidth: 1, borderRightColor: color.goldLine, backgroundColor: color.goldWash },
    segLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 0.54, paddingHorizontal: 5, textAlign: 'center', textTransform: 'uppercase', lineHeight: 22, fontWeight: '500' },
    segLabelCurrent: { color: color.gold2 },
    segLabelIdle: { color: color.dim },

    /* ---- block screen (.btitle / .bsub / .roundlbl) ------------------ */
    block: { paddingTop: 16, paddingBottom: 24 },
    blockTitle: { fontFamily: font.semi, fontSize: 21, color: color.text, letterSpacing: -0.315, marginTop: 2, marginBottom: 2, marginHorizontal: 2, lineHeight: 32.55 },
    blockNote: { fontFamily: mono, fontSize: 11, color: color.dim, marginHorizontal: 2, marginBottom: 14, lineHeight: 17.05 },
    /* Same `.bsub`, but on a working block a round label follows it and
       carries 8 of the 14 itself — see the rhythm note in the header. */
    blockSub: { fontFamily: mono, fontSize: 11, color: color.dim, marginHorizontal: 2, marginBottom: 6, lineHeight: 17.05 },
    roundLabel: { fontFamily: mono, fontSize: 10, letterSpacing: 1.2, color: color.dim, marginTop: 8, marginBottom: 6, marginHorizontal: 4, textTransform: 'uppercase', lineHeight: 15.5 },
    roundHint: { color: color.gold2 },

    /* ---- receipts and upcoming rows (.receipt / .future) ------------- */
    receipt: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 11, borderWidth: 1, borderColor: color.line, backgroundColor: color.well, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6 },
    receiptTick: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: color.doneLine, backgroundColor: color.doneBg, alignItems: 'center', justifyContent: 'center' },
    receiptLabel: { flex: 1, fontFamily: font.med, fontSize: 13, color: color.muted, lineHeight: 20.15 },
    receiptValue: { fontFamily: mono, fontSize: 12, color: color.doneInk, lineHeight: 18.6 },

    upcoming: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, borderRadius: 11, borderWidth: 1, borderStyle: 'dashed', borderColor: color.line, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6 },
    upcomingGripped: { paddingLeft: 34 },
    upcomingLabel: { fontFamily: font.med, fontSize: 13, color: color.dim, lineHeight: 20.15 },
    upcomingValue: { fontFamily: mono, fontSize: 11, color: color.dim, lineHeight: 17.05 },
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
    card: { borderRadius: 16, borderWidth: 1, borderColor: color.goldLine, backgroundColor: color.panel, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12, marginTop: 6, marginBottom: 0 },
    hotName: { fontFamily: font.semi, fontSize: 17, color: color.text, letterSpacing: -0.17, lineHeight: 26.35 },
    hotPresc: { fontFamily: mono, fontSize: 11, color: color.dim, marginTop: 1, lineHeight: 17.05 },
    /* minHeight matches `.hwhy`: the card must not jump when a short coaching
       line is replaced by a long one. */
    hotWhy: { fontFamily: mono, fontSize: 10.5, color: color.gold, marginTop: 6, minHeight: 14, lineHeight: 16.275 },

    hotRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
    fieldLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 1.17, color: color.dim, textTransform: 'uppercase', lineHeight: 13.95 },
    kgWrap: { flex: 1, minWidth: 0 },
    kgLine: { flexDirection: 'row', alignItems: 'baseline' },
    kgValue: { fontFamily: mono, fontSize: 44, color: color.text, letterSpacing: -0.88, lineHeight: 46.2, fontWeight: '700' },
    kgUnit: { fontFamily: font.reg, fontSize: 16, color: color.dim, marginLeft: 2, lineHeight: 16.8 },
    kgInput: { width: 130, borderRadius: 8, borderWidth: 1, borderColor: color.goldLine, backgroundColor: color.panel2, paddingHorizontal: 8, paddingVertical: 0, fontFamily: mono, fontSize: 40, color: color.text },
    plates: { fontFamily: mono, fontSize: 10.5, color: color.muted, marginTop: 4, lineHeight: 16.275 },

    /* ---- Stage 6: the override note, shown only once the field has been
       edited away from what was offered — see HotCard's own comment. ---- */
    overrideRow: { marginTop: 8 },
    overrideLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 1.17, color: color.dim, textTransform: 'uppercase', lineHeight: 13.95, marginBottom: 4 },
    overrideInput: { borderRadius: 8, borderWidth: 1, borderColor: color.line2, backgroundColor: color.panel2, paddingHorizontal: 10, paddingVertical: 8, fontFamily: font.reg, fontSize: 13, color: color.text },

    repsCol: { alignItems: 'center', gap: 2 },
    repsColWide: { flex: 1 },
    repsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepper: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: color.line2, backgroundColor: color.panel2, alignItems: 'center', justifyContent: 'center' },
    stepperInk: { fontFamily: font.reg, fontSize: 20, color: color.text },
    repsValue: { minWidth: 62, textAlign: 'center', fontFamily: mono, fontSize: 24, color: color.text, lineHeight: 37.2, fontWeight: '700' },

    chipsLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 1.17, color: color.dim, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', lineHeight: 13.95 },
    chips: { flexDirection: 'row', gap: 6 },
    chip: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    chipOn: { borderColor: color.doneLine, backgroundColor: color.doneBg },
    chipOff: { borderColor: color.line2, backgroundColor: color.panel2 },
    chipInkOn: { fontFamily: mono, fontSize: 13, color: color.doneInk, fontWeight: '700' },
    chipInkOff: { fontFamily: mono, fontSize: 13, color: color.muted },

    /* `.logbtn` — the one control set in the UI face rather than the mono one. */
    cta: { height: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    ctaOn: { backgroundColor: color.gold2 },
    ctaOff: { borderWidth: 1, borderColor: color.line2, backgroundColor: color.panel2 },
    ctaInkOn: { fontFamily: font.semi, fontSize: 15, color: color.onAccent },
    ctaInkOff: { fontFamily: font.semi, fontSize: 15, color: color.dim },

    /* ---- piece card (.warmclock) ------------------------------------ */
    clockRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
    clock: { fontFamily: mono, fontSize: 40, color: color.gold2, letterSpacing: -0.8, lineHeight: 62, fontWeight: '700' },

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
    takeoverKind: { fontFamily: mono, fontSize: 10, letterSpacing: 1.6, color: color.dim, textTransform: 'uppercase', lineHeight: 15.5 },
    dialWrap: { marginTop: 14, marginBottom: 18 },
    dialInk: { fontFamily: mono, fontSize: 52, color: color.gold2, letterSpacing: -1.04, lineHeight: 80.6, fontWeight: '700' },
    dialSpacer: { height: 18 },
    nextCard: { minWidth: 260, borderRadius: 15, borderWidth: 1, borderColor: color.goldLine, backgroundColor: color.panel, paddingHorizontal: 18, paddingVertical: 13, alignItems: 'center' },
    nextKind: { fontFamily: mono, fontSize: 9, letterSpacing: 1.26, color: color.dim, textTransform: 'uppercase', lineHeight: 13.95 },
    nextName: { fontFamily: font.semi, fontSize: 16, color: color.text, marginTop: 2, lineHeight: 24.8 },
    nextBig: { fontFamily: mono, fontSize: 26, color: color.gold2, marginTop: 3, lineHeight: 40.3, fontWeight: '700' },
    nextWhy: { fontFamily: mono, fontSize: 10, color: color.gold, marginTop: 4, lineHeight: 15.5 },
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
    finishTitle: { fontFamily: font.semi, fontSize: 21, color: color.text, lineHeight: 32.55 },
    finishSub: { fontFamily: mono, fontSize: 11, color: color.dim, marginTop: 4, marginBottom: 16, lineHeight: 17.05 },
    stats: {},
    stat: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: color.line },
    statLabel: { fontFamily: font.reg, fontSize: 14, color: color.text, lineHeight: 21.7 },
    statValue: { fontFamily: mono, fontSize: 14, color: color.gold2, lineHeight: 21.7, fontWeight: '700' },
    comment: { height: 84, borderRadius: 12, borderWidth: 1, borderColor: color.line2, backgroundColor: color.panel, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16, fontFamily: font.reg, fontSize: 14, color: color.text, textAlignVertical: 'top' },

    /* `.finish` again — the block-done banner is the same construction, so it
       takes the same metrics rather than a second set that could drift. */
    blockDone: { paddingTop: 28 },
    blockDoneTitle: { fontFamily: font.semi, fontSize: 21, color: color.text, lineHeight: 32.55 },
    blockDoneSub: { fontFamily: mono, fontSize: 11, color: color.dim, marginTop: 4, marginBottom: 16, lineHeight: 17.05 },
  });
}

export type LoggerStyles = ReturnType<typeof build>;

export function useLoggerStyles(): LoggerStyles {
  const { color } = useTheme();
  return useMemo(() => build(color), [color]);
}
