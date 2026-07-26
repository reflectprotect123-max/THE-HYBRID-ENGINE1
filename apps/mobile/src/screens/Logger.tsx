import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AUTOREG,
  advanceAfterSet,
  blockExercises,
  computeSetAdjustment,
  curSetIndex,
  fmtRest,
  fmtRpe,
  isCond,
  isLiftMode,
  isWarmup,
  prefillPrimary,
  prefillSecondary,
  repFloorOf,
  rpeCenterOf,
  sanNumStr,
  saneKg,
  sessionLetters,
  sessionProgress,
  targetLine,
  type LoggedSet,
  type StrengthBlock,
} from '@hybrid/engine';
import { useDb } from '../store/db';
import { useRest } from '../store/rest';
import { setKeepAwake } from '../native/capabilities';
import type { RootStackParams } from '../App';

/*
 * The logger stage, natively.
 *
 * Structurally identical to the web version because the FLOW is engine logic —
 * curSetIndex, advanceAfterSet, prefillPrimary and the autoregulation call are
 * all shared. What differs is only presentation and the platform affordances:
 * the screen is kept awake while the session is live, and rest fires a real
 * scheduled notification rather than hoping a JS timer survives the pocket.
 */
type Props = NativeStackScreenProps<RootStackParams, 'Logger'>;
type Phase = 'input' | 'rpe' | 'rest';

export function LoggerScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { activeSession, db, update } = useDb();
  const rest = useRest();

  const [loc, setLoc] = useState({ bi: route.params.bi, ei: route.params.ei });
  const [phase, setPhase] = useState<Phase>('input');
  const [rpe, setRpe] = useState(7.5);
  const [hint, setHint] = useState<{ txt: string; cls: 'good' | 'bad' } | null>(null);
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');

  const s = activeSession;
  const block = s?.blocks[loc.bi];
  const ex = block && !isCond(block) ? blockExercises(block as StrengthBlock<LoggedSet>)[loc.ei] : undefined;
  const si = ex ? curSetIndex(ex) : -1;
  const st = ex && si >= 0 ? ex.sets[si] : undefined;
  const lift = !!ex && isLiftMode(ex.mode);

  // The screen must not sleep mid-set; released when the stage closes.
  useEffect(() => {
    void setKeepAwake(true);
    return () => void setKeepAwake(false);
  }, []);

  const setKey = `${loc.bi}-${loc.ei}-${si}`;
  const lastKey = useRef('');
  useEffect(() => {
    if (!ex || si < 0 || lastKey.current === setKey) return;
    lastKey.current = setKey;
    setV1(prefillPrimary(ex, si, db.sessions));
    setV2(prefillSecondary(ex, si));
  }, [ex, si, setKey, db.sessions]);

  useEffect(() => {
    if (phase === 'rest' && !rest.running) setPhase('input');
  }, [phase, rest.running]);

  const prog = useMemo(() => (s ? sessionProgress(s) : { done: 0, total: 0, pct: 0 }), [s]);
  const letters = useMemo(() => (s ? sessionLetters(s) : {}), [s]);

  if (!s || !block || isCond(block) || !ex) {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-3">
        <Text className="text-6 font-bold text-text">No live session</Text>
        <Pressable className="mt-2 rounded-md bg-gold px-2 py-1" onPress={() => navigation.goBack()}>
          <Text className="text-5 font-bold text-bg">Back</Text>
        </Pressable>
      </View>
    );
  }

  function confirmSet() {
    if (!s || !ex || si < 0 || !st) return;
    const isFinal = si >= ex.sets.length - 1;
    let nextHint: typeof hint = null;

    update((draft) => {
      const ds = draft.sessions.find((x) => x.id === s.id);
      if (!ds) return false;
      const dex = (ds.blocks[loc.bi] as StrengthBlock<LoggedSet>).exercises[loc.ei];
      const dst = dex.sets[si];

      // Sanitised on the way in — "1e309" stored verbatim parses back to
      // Infinity everywhere it is later read, and survives every restart.
      dst.aVal = lift ? sanNumStr(v1) : String(v1 || '').trim();
      dst.aVal2 = sanNumStr(v2);
      dst.felt = fmtRpe(rpe);
      dst.done = true;

      // A warm-up must never move the working weight.
      if (lift && !isWarmup(dst)) {
        const weight = saneKg(dst.aVal);
        if (weight > 0) {
          const adj = computeSetAdjustment(
            parseInt(String(dst.aVal2), 10) || 0,
            rpe,
            repFloorOf(dst.t),
            weight,
            rpeCenterOf(dst),
          );
          const dtxt = adj.delta > 0 ? `+${adj.delta} kg` : adj.delta < 0 ? `${adj.delta} kg` : 'hold weight';
          const lead =
            adj.verdict === 'missed the rep floor' ? 'That set missed the rep floor' : `That set was ${adj.verdict}`;
          nextHint = {
            txt: `${lead} — ${dtxt} for ${isFinal ? 'next session' : 'Set ' + (si + 2)} (${adj.newWeight} kg).`,
            cls: adj.cls,
          };
          const nx = dex.sets[si + 1];
          if (!isFinal && nx && !nx.done && !nx.aVal) nx.aVal = String(adj.newWeight);
        }
      }
      ds.updatedAt = Date.now();
    });

    setHint(nextHint);
    setRpe(7.5);

    const after = JSON.parse(JSON.stringify(s)) as typeof s;
    (after.blocks[loc.bi] as StrengthBlock<LoggedSet>).exercises[loc.ei].sets[si].done = true;
    const { next: dest, restSec } = advanceAfterSet(after, loc.bi, loc.ei);

    if (restSec > 0 && dest) {
      rest.start(restSec);
      setPhase('rest');
      if (dest.bi !== loc.bi || dest.ei !== loc.ei) setLoc(dest);
    } else if (dest && (dest.bi !== loc.bi || dest.ei !== loc.ei)) {
      setLoc(dest);
      setHint(null);
      setPhase('input');
    } else {
      setPhase('input');
    }
  }

  const step = (dir: 1 | -1) => {
    const cur = parseFloat(v1) || 0;
    setV1(String(Math.max(0, Math.round((cur + dir * AUTOREG.stepKg) * 100) / 100)));
  };

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
    >
      <View className="flex-row items-start gap-1">
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityLabel="back to session"
          className="h-5 w-5 items-center justify-center rounded-md border border-line2 bg-panel2"
        >
          <Text className="text-6 text-muted">←</Text>
        </Pressable>
        <View className="flex-1">
          <Text className="text-2 font-bold uppercase tracking-widest text-dim">
            {block.heading || 'Block'}
            {block.superset ? ' · superset' : ''}
          </Text>
          <Text className="text-7 font-black text-text">{s.name || 'Workout'}</Text>
        </View>
      </View>

      <View className="mt-2 h-0.5 overflow-hidden rounded-pill bg-track">
        <View className="h-full rounded-pill bg-gold2" style={{ width: `${prog.pct}%` }} />
      </View>
      <View className="mt-0.5 flex-row justify-between">
        <Text className="text-2 text-dim">
          {prog.done} of {prog.total} done
        </Text>
        <Text className="text-2 text-dim">{prog.pct}%</Text>
      </View>

      <View className="mt-2 rounded-lg border border-line bg-panel p-2">
        <View className="flex-row items-center gap-1">
          <View className="rounded-sm border border-gold-line bg-gold-wash px-0.5">
            <Text className="text-3 font-black text-gold2">{letters[loc.bi]?.[loc.ei] ?? '?'}</Text>
          </View>
          <Text className="flex-1 text-7 font-black text-text" numberOfLines={1}>
            {ex.name || 'Exercise'}
          </Text>
        </View>
        <Text className="mt-0.5 text-3 text-dim">
          {[ex.tempo ? '@' + ex.tempo : '', Number(ex.rest) ? 'rest ' + fmtRest(ex.rest) : 'no rest']
            .filter(Boolean)
            .join(' · ')}
        </Text>

        {ex.cue ? (
          <Text className="mt-1 rounded-md border border-gold-line bg-gold-wash px-1 py-1 text-4 text-gold2">
            {ex.cue}
          </Text>
        ) : null}

        <View className="mt-1.5 flex-row gap-0.5">
          {ex.sets.map((set, i) => (
            <View
              key={i}
              className={`h-0.5 flex-1 rounded-pill ${set.done ? 'bg-gold2' : i === si ? 'bg-gold' : 'bg-track'}`}
            />
          ))}
        </View>

        {si >= 0 && st ? (
          <>
            <View className="mt-2 flex-row justify-between">
              <Text className="text-2 font-bold uppercase tracking-widest text-dim">
                Set {si + 1} of {ex.sets.length}
                {isWarmup(st) ? ' · warm-up' : ''}
              </Text>
              <Text className="text-2 font-bold text-gold2">target {targetLine(ex, st)}</Text>
            </View>

            {phase === 'input' ? (
              <>
                {lift ? (
                  <>
                    <Text className="mt-2 text-2 font-bold uppercase tracking-widest text-dim">Weight</Text>
                    <View className="mt-0.5 flex-row gap-1">
                      <Pressable
                        onPress={() => step(-1)}
                        accessibilityLabel={`minus ${AUTOREG.stepKg} kg`}
                        className="w-6 items-center justify-center rounded-md border border-line2 bg-panel2"
                      >
                        <Text className="text-7 text-muted">−</Text>
                      </Pressable>
                      <TextInput
                        value={v1}
                        onChangeText={setV1}
                        keyboardType="decimal-pad"
                        accessibilityLabel="kg"
                        className="h-7 flex-1 rounded-md border border-line bg-well text-center text-9 font-black text-text"
                        placeholderTextColor="#847d73"
                        placeholder="kg"
                      />
                      <Pressable
                        onPress={() => step(1)}
                        accessibilityLabel={`plus ${AUTOREG.stepKg} kg`}
                        className="w-6 items-center justify-center rounded-md border border-line2 bg-panel2"
                      >
                        <Text className="text-7 text-muted">+</Text>
                      </Pressable>
                    </View>
                    <Text className="mt-2 text-2 font-bold uppercase tracking-widest text-dim">Reps</Text>
                    <TextInput
                      value={v2}
                      onChangeText={setV2}
                      keyboardType="number-pad"
                      accessibilityLabel="reps"
                      className="mt-0.5 h-7 rounded-md border border-line bg-well text-center text-9 font-black text-text"
                    />
                  </>
                ) : (
                  <>
                    <Text className="mt-2 text-2 font-bold uppercase tracking-widest text-dim">
                      {ex.mode === 'seconds' ? 'Secs' : 'Reps'}
                    </Text>
                    <TextInput
                      value={v1}
                      onChangeText={setV1}
                      keyboardType="number-pad"
                      className="mt-0.5 h-7 rounded-md border border-line bg-well text-center text-9 font-black text-text"
                    />
                  </>
                )}

                <Pressable onPress={() => setPhase('rpe')} className="mt-2 items-center rounded-md bg-gold py-2">
                  <Text className="text-6 font-black text-bg">Finish Set</Text>
                </Pressable>
              </>
            ) : null}

            {phase === 'rpe' ? (
              <View className="mt-2 rounded-md border border-line bg-well p-2">
                <Text className="text-center text-2 font-bold uppercase tracking-widest text-dim">
                  How hard was that? · RPE
                </Text>
                <Text className="mt-0.5 text-center text-9 font-black text-gold2">{fmtRpe(rpe)}</Text>
                <View className="mt-1 flex-row flex-wrap justify-center gap-1">
                  {[5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setRpe(n)}
                      className={`h-5 w-7 items-center justify-center rounded-pill border ${
                        rpe === n ? 'border-done-line bg-done-bg' : 'border-line2 bg-panel2'
                      }`}
                    >
                      <Text className={`text-4 font-bold ${rpe === n ? 'text-done-ink' : 'text-muted'}`}>
                        {fmtRpe(n)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={confirmSet} className="mt-2 items-center rounded-md bg-gold py-2">
                  <Text className="text-6 font-black text-bg">Confirm Set</Text>
                </Pressable>
              </View>
            ) : null}

            {phase === 'rest' ? (
              <View className="mt-2 items-center rounded-md border border-line bg-well p-2">
                <Text className="text-2 font-bold uppercase tracking-widest text-dim">Rest</Text>
                <Text className="mt-0.5 text-9 font-black text-gold2">{fmtRest(rest.left)}</Text>
                <View className="mt-1 h-0.5 w-full overflow-hidden rounded-pill bg-track">
                  <View className="h-full rounded-pill bg-gold2" style={{ width: `${rest.frac * 100}%` }} />
                </View>
                <View className="mt-2 flex-row gap-1">
                  <Pressable onPress={() => rest.add(15)} className="rounded-md border border-line2 px-2 py-1">
                    <Text className="text-4 text-muted">+15s</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      rest.stop();
                      setPhase('input');
                    }}
                    className="rounded-md border border-line2 px-2 py-1"
                  >
                    <Text className="text-4 text-muted">Skip Rest</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View className="mt-3 items-center rounded-md border border-done-line bg-done-bg p-3">
            <Text className="text-5 font-bold text-done-ink">
              All {ex.sets.length} set{ex.sets.length === 1 ? '' : 's'} logged
            </Text>
          </View>
        )}

        {hint ? (
          <Text className={`mt-2 text-4 ${hint.cls === 'good' ? 'text-gold2' : 'text-bad'}`}>{hint.txt}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
