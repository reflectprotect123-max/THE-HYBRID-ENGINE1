import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  applyConcept2Import,
  concept2ImportSummary,
  conMaxHr,
  conZones,
  ensureSharedCore,
  planConcept2Import,
  restingHr,
  restoreDb,
  todayRecovery,
  ymd,
  type Concept2ImportCounts,
  type EngineDB,
  type Profile,
} from '@hybrid/engine';
import { useTheme } from '@hybrid/design';
import { WorldSwitch } from '../ui/WorldSwitch';
import { useDb } from '../store/db';
import { useSync } from '../cloud/sync';
import { useWhoop } from '../cloud/whoop';
import { useConcept2 } from '../cloud/concept2';
import { isPersistent } from '../store/storage';
import { SCAN_CORPUS_CAP, clearScanCorpus, exportScanCorpus, scanCorpusStats } from '../store/scanCorpus';
import { parseBackup } from '../store/restore';
import { startFresh, startFreshCounts } from '../store/startFresh';
import { Btn, Card, Input, Kicker, SectionHead, T, Tap, Title } from '../ui';
import { humanizeError } from '../errors';
import { supabaseClient } from '../cloud/sync';
import { getDisplayName, getMyDisplayName, redeemCoachInvite, setMyDisplayName } from '../cloud/arc-roster';
import {
  leaveMyCoach,
  readMyCoachLink,
  readMyReadGrants,
  setReadGrant,
  type CoachLink,
  type GrantKind,
  type ReadGrants,
} from '../cloud/arc-consent';

/*
 * Declared at MODULE scope, not inside SettingsScreen.
 *
 * A component defined in a render body is a new component TYPE on every render,
 * so React unmounts and remounts it rather than updating it. Each of these
 * fields writes to the store on every keystroke, which re-renders the screen —
 * which threw the TextInput away and took the keyboard and the caret with it
 * after every single character. The three numbers that drive the whole HR model
 * were effectively untypeable.
 */
function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: unknown;
  onChange: (v: string) => void;
}) {
  return (
    <View className="mt-2">
      <T w="semi" className="text-2 uppercase tracking-widest text-dim">{label}</T>
      <Input
        value={String(value ?? '')}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType="number-pad"
        w="semi"
        num
        className="mt-0.5 h-5 rounded-md border border-line bg-well px-1 text-5 text-text"
      />
      <T className="mt-0.5 text-3 text-dim">{hint}</T>
    </View>
  );
}

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { db, hr, whoop, update, saveFailed, dataRecovered } = useDb();
  const profile = db.settings.profile || {};
  const zones = useMemo(() => conZones(hr), [hr]);
  /*
   * Redeeming a code and leaving a coach both change whether there IS a
   * relationship, and the card that renders the consent controls is a SIBLING
   * of the card that changes it. Settings is a bottom tab and stays mounted
   * for the life of the app, so without this counter an athlete who links a
   * coach sees no consent controls until a cold start — and one who leaves
   * goes on being offered them.
   */
  const [linkVersion, setLinkVersion] = useState(0);

  const set = (patch: Partial<Profile>) =>
    update((draft) => {
      draft.settings.profile = { ...(draft.settings.profile || {}), ...patch };
      draft.settings.updatedAt = Date.now();
    });

  return (
    <ScrollView
      className="flex-1 bg-bg"
      // Sign in / Create account sit under a keyboard; without this the first
      // tap only dismisses it.
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, paddingHorizontal: 16 }}
    >
      <Kicker>Settings</Kicker>
      <Title>Your numbers</Title>

      <WorldSwitch />

      {dataRecovered ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          Your saved data couldn&apos;t be read and had to be reset. If you have a backup, restore it below.
        </T>
      ) : saveFailed ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          The last save failed — usually a full disk. Export a backup below, then try again.
        </T>
      ) : !isPersistent ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          Storage is not persisting on this build. Anything you log now may not survive a restart — export a backup
          below before you train again.
        </T>
      ) : null}

      <Field label="Age" hint="Used for the Tanaka max-HR estimate (208 − 0.7 × age)." value={profile.age} onChange={(v) => set({ age: v })} />
      <Field label="Max HR" hint="A tested max wins over the estimate." value={profile.maxHr} onChange={(v) => set({ maxHr: v })} />
      <Field label="Resting HR" hint="With this, zones use Karvonen instead of percent-of-max." value={profile.restingHr} onChange={(v) => set({ restingHr: v })} />

      <CloudCard />
      {/* Every half of the athlete's consent, together, directly under the
          sign-in card because all of them require an account and say so.
          CoachConsentCard renders NOTHING without a coach, so an uncoached
          athlete still sees only the two cards that were here before it. */}
      <CoachLinkCard onLinked={() => setLinkVersion((v) => v + 1)} />
      <CoachConsentCard version={linkVersion} onLeft={() => setLinkVersion((v) => v + 1)} />
      <AthleteNameCard />
      <WhoopCard />
      <RecoveryCard />
      <Concept2Card />

      <SectionHead title="What that produces" />
      <Card>
        <T num className="text-4 text-muted">
          Max {conMaxHr(profile)} · resting {restingHr(profile, whoop) ?? '—'} ·{' '}
          {zones.method === 'hrr' ? 'Karvonen (HRR)' : 'percent of max'}
        </T>
        {zones.list.map((b) => (
          <View key={b.key} className="mt-0.5 flex-row">
            <T w="med" className="flex-1 text-4 text-text">{b.name}</T>
            <T num className="text-4 text-muted">
              {b.lo}–{b.hi}
            </T>
          </View>
        ))}
      </Card>

      <BackupCard db={db} />
      {/* After the backup card on purpose: "export a backup first" is only
          useful advice if the export is the thing you just scrolled past. */}
      <StartFreshCard />
      <LabelScanCard />

      <SectionHead title="Auto-Coached" />
    </ScrollView>
  );
}

/*
 * The label-reader corpus: what it is, and the two things that can be done
 * with it.
 *
 * It sits here rather than in the nutrition world because this is where the
 * app already tells the truth about what is on the device and offers the share
 * sheet to get it off. The reader's own screen says "nothing uploaded"; that
 * line stays true only while there is somewhere plain that says what IS kept.
 */
/**
 * Clear the training content and start over.
 *
 * The web app's `StartFreshCard`, as a native card. Same rules, same wording,
 * because both apps write the same `EngineDB` to the same backend and a phone
 * that cleared less than the web did would hand the difference straight back
 * on the next sync.
 *
 * `Alert` rather than an inline two-step, unlike the web: on Android a system
 * dialog is the platform's own destructive-confirm, it cannot be dismissed by
 * a stray scroll, and this screen already uses it for the label scans. The
 * counts go IN the dialog, so the number is in front of you at the moment you
 * decide rather than behind it.
 */
function StartFreshCard() {
  const { db, update } = useDb();
  const [done, setDone] = useState('');
  const counts = startFreshCounts(db);
  const empty = counts.workouts === 0 && counts.sessions === 0;

  const clear = () =>
    Alert.alert(
      'Delete every session?',
      `This deletes ${counts.workouts} in your library and ${counts.sessions} logged, on this phone and in the cloud. It cannot be undone. Your settings, connected devices and food log are not touched.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const removed = startFreshCounts(db);
            update((draft) => {
              const next = startFresh(draft, Date.now());
              draft.workouts = next.workouts;
              draft.sessions = next.sessions;
              draft.settings = next.settings;
            });
            setDone(`Cleared ${removed.workouts} in the library and ${removed.sessions} logged.`);
          },
        },
      ],
    );

  return (
    <View>
      <SectionHead title="Start fresh" />
      <Card>
        <T className="text-3 text-muted">
          Deletes every session in your library and every logged session, and stops them coming back from the cloud.
          Your settings, connected devices and food log are not touched.
        </T>
        {done ? (
          <T className="mt-1.5 text-4 text-ok">{done}</T>
        ) : empty ? (
          <T num className="mt-1.5 text-4 text-muted">Nothing to clear — there are no sessions stored.</T>
        ) : (
          <>
            <T num className="mt-1.5 text-4 text-muted">
              {counts.workouts} in the library · {counts.sessions} logged
            </T>
            <Tap box={{ h: 42 }}
              onPress={clear}
              label="delete every session"
              className="mt-1.5 items-center rounded-md border border-line2 bg-panel2 py-1.5"
            >
              <T w="med" className="text-4 text-text">Clear all sessions…</T>
            </Tap>
            <T className="mt-1 text-3 text-dim">
              Export a backup above first if you might want any of it back.
            </T>
          </>
        )}
      </Card>
    </View>
  );
}

function LabelScanCard() {
  /* Read on mount and after each action, never during render. Settings is a
     TAB and stays mounted under the logger, so parsing the corpus on every
     render would re-parse hundreds of kilobytes on every keystroke of every
     field above — the same trap the backup card's comment describes. */
  const [stats, setStats] = useState(() => scanCorpusStats());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const share = async () => {
    setBusy(true);
    setMsg('');
    try {
      const json = exportScanCorpus();
      await Share.share({
        message: json,
        title: `hybrid-label-scans-${new Date().toISOString().slice(0, 10)}.json`,
      });
      setMsg(`${Math.round(json.length / 1024)} kB sent.`);
    } catch (e) {
      setMsg('Export failed: ' + humanizeError(e, 'label scans'));
    } finally {
      setBusy(false);
      setStats(scanCorpusStats());
    }
  };

  const clear = () =>
    // Deleting evidence that only exists because it was captured as it
    // happened: it cannot be re-created, so it gets the destructive confirm.
    Alert.alert('Delete the recorded label scans?', 'The scans themselves cannot be recovered. Your foods and your log are not touched.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          clearScanCorpus();
          setStats(scanCorpusStats());
          setMsg('Label scans cleared.');
        },
      },
    ]);

  return (
    <View>
      <SectionHead title="Label scans" />
      <Card>
        <T className="text-3 text-muted">
          When you photograph a nutrition panel, this phone keeps what the reader saw and the numbers you confirmed, so
          the reader can be improved from real labels instead of guesses. It stays on this phone, it is never uploaded,
          and nothing in the app reads it back — it changes no food, no target and no training.
        </T>
        <T num className="mt-1.5 text-4 text-muted">
          {stats.count === 0
            ? 'No label scans recorded yet.'
            : `${stats.count} of ${SCAN_CORPUS_CAP} scans kept · ${Math.round(stats.bytes / 1024)} kB`}
        </T>
        <Tap box={{ h: 42 }}
          onPress={() => void share()}
          disabled={busy || stats.count === 0}
          className={`mt-1.5 items-center rounded-md border border-line2 bg-panel2 py-1.5 ${busy || stats.count === 0 ? 'opacity-40' : ''}`}
        >
          <T w="med" className="text-4 text-text">{busy ? 'Exporting…' : 'Export label scans'}</T>
        </Tap>
        <Tap box={{ h: 42 }}
          onPress={clear}
          disabled={stats.count === 0}
          label="delete recorded label scans"
          className={`mt-1 items-center rounded-md border border-line2 bg-panel2 py-1.5 ${stats.count === 0 ? 'opacity-40' : ''}`}
        >
          <T w="med" className="text-4 text-text">Clear label scans</T>
        </Tap>
        {msg ? <T className="mt-1 text-3 text-muted">{msg}</T> : null}
        <T className="mt-1 text-3 text-dim">
          Only the {SCAN_CORPUS_CAP} most recent are kept; older ones are dropped so this can never fill the phone.
        </T>
      </Card>
    </View>
  );
}

/** Manual whole-athlete context. Wellness observations inform constraints and
 * confidence; they are not diagnoses, and HRV never becomes a pain gate. */
function RecoveryCard() {
  const { db, update } = useDb();
  const today = ymd(new Date());
  const migrated = ensureSharedCore(db);
  const recovery = migrated.core?.recovery.find((x) => x.date === today);
  const life = migrated.core?.lifeLoad.find((x) => x.date === today);
  const [sleep, setSleep] = useState(() => String(recovery?.sleepHours ?? ''));
  const [energy, setEnergy] = useState(() => String(recovery?.energy ?? ''));
  const [soreness, setSoreness] = useState(() => String(recovery?.soreness ?? ''));
  const [stress, setStress] = useState(() => String(life?.stress ?? recovery?.stress ?? ''));
  const [physical, setPhysical] = useState(() => String(life?.physicalLoad ?? ''));
  const [minutes, setMinutes] = useState(() => String(life?.availableMinutes ?? ''));
  const [pain, setPain] = useState(() => migrated.core?.safety.painHold?.areas.join(', ') || '');
  const [illness, setIllness] = useState<'clear' | 'suspected' | 'active' | 'returning'>(() => migrated.core?.safety.illness?.status || 'clear');
  const [saved, setSaved] = useState(false);
  const { color } = useTheme();

  /*
   * Settings is a bottom-tab screen: it stays mounted for the app's whole
   * lifetime, but the form fields above were only ever seeded from `db.core`
   * once, at first mount (useState initialisers only run once). Two ways
   * that goes wrong:
   *
   *  - Midnight rollover: `today` is recomputed every render, but the form
   *    was seeded for whatever day it was at mount. Save() then writes
   *    yesterday's stale values in as TODAY's check-in.
   *  - A newer check-in pulled in by cloud sync while this screen sits
   *    mounted (recorded on web or another phone) never reaches the form;
   *    Save() then overwrites it with the old blanks (`number('')` is
   *    `undefined`), silently discarding sleep/pain/illness data — including
   *    a pain-hold or illness flag mid-hold.
   *
   * Re-seed whenever the identity of today's manual entry changes — its
   * `recordedAt`, or its absence — which covers both cases. This does NOT
   * run on every render (it depends on the derived values below, not on
   * `db` itself), so it does not clobber an in-progress edit that hasn't
   * produced a new manual record yet.
   *
   * This does not fully solve the sync race where a pull lands mid-edit —
   * distinguishing "external update" from "my own edit in this session"
   * would need real dirty-tracking per field, which is more machinery than
   * this fix warrants. Follow-up if that proves to matter in practice.
   */
  useEffect(() => {
    setSleep(String(recovery?.sleepHours ?? ''));
    setEnergy(String(recovery?.energy ?? ''));
    setSoreness(String(recovery?.soreness ?? ''));
    setStress(String(life?.stress ?? recovery?.stress ?? ''));
    setPhysical(String(life?.physicalLoad ?? ''));
    setMinutes(String(life?.availableMinutes ?? ''));
    setPain(migrated.core?.safety.painHold?.areas.join(', ') || '');
    setIllness(migrated.core?.safety.illness?.status || 'clear');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, recovery?.recordedAt, life?.id]);
  const number = (value: string): number | undefined => {
    const n = Number(value);
    return value.trim() && Number.isFinite(n) ? n : undefined;
  };
  const save = () => {
    update((draft) => {
      const next = ensureSharedCore(draft, Date.now());
      const core = next.core!;
      const at = Date.now();
      core.recovery = [
        ...core.recovery.filter((x) => x.date !== today || x.source !== 'manual'),
        { id: `manual-recovery-${today}`, date: today, sleepHours: number(sleep), energy: number(energy), soreness: number(soreness), stress: number(stress), painAreas: pain.split(',').map((x) => x.trim()).filter(Boolean), illnessStatus: illness, source: 'manual', recordedAt: at },
      ];
      core.lifeLoad = [
        ...core.lifeLoad.filter((x) => x.date !== today || x.source !== 'manual'),
        { id: `manual-life-${today}`, date: today, stress: number(stress), physicalLoad: number(physical), availableMinutes: number(minutes), source: 'manual' },
      ];
      core.safety = { ...core.safety, painHold: { active: !!pain.trim(), areas: pain.split(',').map((x) => x.trim()).filter(Boolean), updatedAt: at }, illness: { status: illness, updatedAt: at } };
      core.updatedAt = at;
      draft.core = core;
      draft.ecosystem = { ...(next.ecosystem || { schemaVersion: 1, partitions: {}, events: [], core }), core };
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  return (
    <View>
      <SectionHead title="Whole-athlete context" />
      <Card>
        <T className="text-3 text-muted">A short check-in accounts for sleep, soreness, life stress and physical work. This is coaching context, not medical advice.</T>
        <View className="mt-1 flex-row flex-wrap justify-between">
          <View className="w-[48%]"><Field label="Sleep hours" hint="Last night" value={sleep} onChange={setSleep} /></View>
          <View className="w-[48%]"><Field label="Energy 0–10" hint="How you feel" value={energy} onChange={setEnergy} /></View>
          <View className="w-[48%]"><Field label="Soreness 0–10" hint="Whole-body" value={soreness} onChange={setSoreness} /></View>
          <View className="w-[48%]"><Field label="Life stress 0–10" hint="Mental load" value={stress} onChange={setStress} /></View>
          <View className="w-[48%]"><Field label="Physical load 0–10" hint="Work/activity" value={physical} onChange={setPhysical} /></View>
          <View className="w-[48%]"><Field label="Minutes today" hint="Time available" value={minutes} onChange={setMinutes} /></View>
        </View>
        <T w="semi" className="mt-1.5 text-2 uppercase tracking-widest text-dim">Pain areas</T>
        <Input value={pain} onChangeText={setPain} placeholder="e.g. lower back (blank if clear)" className="mt-0.5 h-5 rounded-md border border-line bg-well px-1 text-4 text-text" />
        <T className="mt-0.5 text-3 text-dim">A pain flag stops automatic pushing; it is not a diagnosis.</T>
        <T w="semi" className="mt-1.5 text-2 uppercase tracking-widest text-dim">Illness status</T>
        <View className="mt-0.5 flex-row flex-wrap gap-0.5">
          {(['clear', 'suspected', 'active', 'returning'] as const).map((value) => (
            <Tap key={value} role="radio" selected={illness === value} box={{ h: 40 }} onPress={() => setIllness(value)} className={`rounded-sm border px-1 py-1 ${illness === value ? 'border-gold-line bg-gold-wash' : 'border-line bg-panel2'}`}>
              <T w="med" className={`text-3 ${illness === value ? 'text-gold2' : 'text-muted'}`}>{value}</T>
            </Tap>
          ))}
        </View>
        <Tap box={{ h: 42 }} onPress={save} className="mt-1.5 items-center rounded-md bg-gold py-1.5">
          <T w="med" className="text-4" style={{ color: color.onAccent }}>{saved ? 'Saved' : 'Save today’s context'}</T>
        </Tap>
        <T className="mt-1 text-3 text-dim">HRV is advisory only and never decides pain, injury or illness status.</T>
      </Card>
    </View>
  );
}

/*
 * The backup the storage warning above tells you to take.
 *
 * The web app builds a Blob and clicks an <a download>; a phone has neither.
 * The share sheet is the equivalent that needs no new dependency — the JSON
 * goes to Drive, Files, a mail draft, wherever. Writing straight to disk would
 * mean expo-file-system, which is not installed here and cannot be added
 * without touching the lockfile.
 *
 * Android caps an intent payload at about a megabyte, so a very large history
 * can be refused by the OS rather than by us. The byte count is shown, and a
 * failure says so plainly instead of pretending the backup was taken.
 */
function BackupCard({ db }: { db: EngineDB }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  /* Serialised on the tap, never during render. Settings is a TAB, so it stays
     mounted under the logger — a memo over `db` would re-stringify the whole
     database on every keystroke of every set. */
  const share = async () => {
    setBusy(true);
    setMsg('');
    try {
      const json = JSON.stringify(db, null, 1);
      await Share.share({
        message: json,
        title: `hybrid-backup-${new Date().toISOString().slice(0, 10)}.json`,
      });
      setMsg(`${Math.round(json.length / 1024)} kB sent.`);
    } catch (e) {
      setMsg('Export failed: ' + humanizeError(e, 'backup'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <SectionHead title="Your data" />
      <Card>
        <T num className="text-4 text-muted">
          {db.workouts.length} sessions in the library · {db.sessions.length} logged
        </T>
        <Tap box={{ h: 42 }}
          onPress={() => void share()}
          disabled={busy}
          className={`mt-1.5 items-center rounded-md border border-line2 bg-panel2 py-1.5 ${busy ? 'opacity-40' : ''}`}
        >
          <T w="med" className="text-4 text-text">{busy ? 'Exporting…' : 'Export a backup'}</T>
        </Tap>
        {msg ? <T className="mt-1 text-3 text-muted">{msg}</T> : null}
        <T className="mt-1 text-3 text-dim">
          Everything on this device as plain JSON, sent wherever you keep files. Keeping one is worth the ten seconds.
        </T>
        <RestoreSection />
      </Card>
    </View>
  );
}

/*
 * The way back for the export above. Paste-based on purpose: the share-sheet
 * export needs no file-system dependency, and neither does this — the JSON
 * comes back through the clipboard the same way it left. Replace is guarded
 * by an explicit confirm that says exactly what was found and what "Replace"
 * will do, because this is the one control in the app that can erase a
 * phone's entire history in a tap.
 */
function RestoreSection() {
  const { update } = useDb();
  const [text, setText] = useState('');
  const [found, setFound] = useState<ReturnType<typeof parseBackup> | null>(null);
  const [msg, setMsg] = useState('');

  const inspect = () => {
    const r = parseBackup(text);
    if ('error' in r) {
      setFound(null);
      setMsg(r.error);
      return;
    }
    setMsg('');
    setFound(r);
  };
  const replace = () => {
    if (!found || 'error' in found) return;
    // Same destructive gate as workout delete on Home/Library: this one tap
    // erases the phone's entire history, so it gets the native confirm with
    // the destructive style, not just an inline button pair.
    Alert.alert('Replace everything on this phone?', 'Every workout and session on this device is overwritten by the backup. This cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Replace', style: 'destructive', onPress: doReplace },
    ]);
  };
  const doReplace = () => {
    if (!found || 'error' in found) return;
    update((d) => {
      // restoreDb is the SAME function web's Settings screen uses — it
      // replaces the WHOLE db, not just workouts/sessions/settings. Doing
      // this by hand here previously silently dropped `core` (recovery
      // history, life load, the pain-hold/illness safety flags) and
      // `ecosystem` on every restore, because they were never assigned back
      // onto the draft. found.db is already sanitizeDB-shaped (from
      // parseBackup), which restoreDb accepts and re-sanitizes safely.
      const out = restoreDb(d, found.db, 'replace');
      d.workouts = out.db.workouts;
      d.sessions = out.db.sessions;
      d.settings = out.db.settings;
      d.core = out.db.core;
      d.ecosystem = out.db.ecosystem;
    });
    setText('');
    setFound(null);
    setMsg('Restored.');
  };

  return (
    <View className="mt-2 border-t border-line pt-1.5">
      <Kicker>Restore from a backup</Kicker>
      <Input
        value={text}
        onChangeText={(t: string) => { setText(t); setFound(null); if (msg) setMsg(''); }}
        placeholder="Paste the backup JSON here"
        multiline
        numberOfLines={3}
        accessibilityLabel="backup JSON"
        className="mt-1"
      />
      {found && !('error' in found) ? (
        <View className="mt-1">
          <T className="text-3 text-text">
            Found {found.sessions} logged session{found.sessions === 1 ? '' : 's'}
            {found.lastDate ? ` (last: ${found.lastDate})` : ''}. Replace everything on this phone?
          </T>
          <View className="mt-1 flex-row gap-1">
            <Tap box={{ h: 42 }} onPress={replace} className="flex-1 items-center rounded-md border border-bad/40 bg-panel2 py-1.5">
              <T w="med" className="text-4 text-bad">Replace</T>
            </Tap>
            <Tap box={{ h: 42 }} onPress={() => setFound(null)} className="flex-1 items-center rounded-md border border-line2 bg-panel2 py-1.5">
              <T w="med" className="text-4 text-text">Cancel</T>
            </Tap>
          </View>
        </View>
      ) : (
        <Tap box={{ h: 42 }}
          onPress={inspect}
          disabled={!text.trim()}
          className={`mt-1 items-center rounded-md border border-line2 bg-panel2 py-1.5 ${text.trim() ? '' : 'opacity-40'}`}
        >
          <T w="med" className="text-4 text-text">Restore</T>
        </Tap>
      )}
      {msg ? <T className="mt-1 text-3 text-muted">{msg}</T> : null}
    </View>
  );
}

function CloudCard() {
  const { enabled, user, busy, error, syncedAt, signIn, signUp, signOut, syncNow } = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const { color } = useTheme();
  if (!enabled) return null;

  const go = async (fn: (e: string, p: string) => Promise<string | null>) => setMsg((await fn(email, password)) || '');

  return (
    <View>
      <SectionHead title="Cloud sync" />
      <Card>
        {user ? (
          <>
            <T className="text-4 text-muted">
              Signed in as <T w="semi" className="text-text">{user.email}</T>
            </T>
            <T accessibilityLiveRegion="polite" className="mt-0.5 text-3 text-dim">
              {busy ? 'Syncing…' : syncedAt ? 'Last synced ' + new Date(syncedAt).toLocaleTimeString() : 'Not synced yet.'}
            </T>
            {!isPersistent ? (
              <T className="mt-1 text-3 text-bad">
                Storage is not persisting in this build, so this sign-in will not survive a restart.
              </T>
            ) : null}
            {error ? <T accessibilityLiveRegion="assertive" className="mt-1 text-3 text-bad">{error}</T> : null}
            <View className="mt-1.5 flex-row gap-1">
              <Tap box={{ h: 42 }} onPress={() => void syncNow()} className="flex-1 items-center rounded-md border border-line2 bg-panel2 py-1.5">
                <T w="med" className="text-4 text-text">Sync now</T>
              </Tap>
              <Tap box={{ h: 42 }} onPress={() => void signOut()} className="flex-1 items-center rounded-md py-1.5">
                <T className="text-4 text-muted">Sign out</T>
              </Tap>
            </View>
          </>
        ) : (
          <>
            <T className="text-4 text-muted">Sign in to sync across devices.</T>
            <Input
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              keyboardType="email-address"
              placeholder="email"
              className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
            />
            <Input
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              placeholder="password"
              className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
            />
            {msg ? <T className="mt-1 text-3 text-warn">{msg}</T> : null}
            <View className="mt-1.5 flex-row gap-1">
              <Tap box={{ h: 42 }} onPress={() => void go(signIn)} className="flex-1 items-center rounded-md bg-gold py-1.5">
                <T w="med" className="text-4" style={{ color: color.onAccent }}>Sign in</T>
              </Tap>
              <Tap box={{ h: 42 }} onPress={() => void go(signUp)} className="flex-1 items-center rounded-md border border-line2 bg-panel2 py-1.5">
                <T w="med" className="text-4 text-text">Create account</T>
              </Tap>
            </View>
          </>
        )}
      </Card>
    </View>
  );
}

/*
 * THE ATHLETE'S HALF OF THE COACHING LINK.
 *
 * A coach mints a code on the bench; nothing happens until the athlete redeems
 * it here, from their own session, and the row is written with their own
 * auth.uid(). This card is that action — it is the only place in the athlete
 * product where a coaching relationship can begin.
 *
 * The server answers EVERY rejection — unknown, expired, revoked, already spent
 * — with one message, deliberately, so that it cannot tell someone guessing
 * codes when they have found a real one. This card must not be cleverer than
 * that: it says the code did not work and never which part, never how close.
 */
function CoachLinkCard({ onLinked }: { onLinked: () => void }) {
  const { enabled, user, syncNow } = useSync();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  if (!enabled) return null;

  const redeem = async () => {
    if (!supabaseClient || !user) return;
    setBusy(true);
    setMsg(null);
    try {
      await redeemCoachInvite(supabaseClient, code);
      setCode('');
      setMsg({
        tone: 'ok',
        text: "You're linked. Your coach can now send you programs, and they arrive here for you to accept or decline.",
      });
      /* The link is live but this device has never looked for it. A sync now
         is what puts a waiting program on Home today instead of at whatever
         later foreground happens to come first. Not awaited — the redeem has
         already succeeded and the sync reports its own failures on the cloud
         card above. */
      void syncNow();
      /* The consent card below is a sibling and has already decided there is
         no coach. Telling it to look again is what puts the two grants and the
         Leave control on screen now rather than after a cold start. */
      onLinked();
    } catch (e) {
      /* humanizeError's 'invite' context is the single sentence for every
         refusal the server makes. A network failure resolves ahead of it and
         says so instead, which is the one distinction worth drawing: it is
         about the phone, not about the code. */
      setMsg({ tone: 'bad', text: humanizeError(e, 'invite') + ' Nothing on this phone changed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <SectionHead title="Your coach" />
      <Card>
        <T className="text-4 text-muted">
          If a coach gave you a code, enter it here. Redeeming it is what links you to them — nobody can add you to a
          roster without this.
        </T>
        {user ? (
          <>
            <Input
              value={code}
              onChangeText={(t: string) => {
                setCode(t);
                if (msg) setMsg(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="invite code"
              accessibilityLabel="invite code"
              className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
            />
            <Btn
              variant="brass"
              className="mt-1.5"
              onPress={() => void redeem()}
              disabled={busy || !code.trim()}
            >
              {busy ? 'Linking…' : 'Link my coach'}
            </Btn>
            {msg ? (
              <T
                accessibilityLiveRegion={msg.tone === 'bad' ? 'assertive' : 'polite'}
                className={`mt-1 text-3 ${msg.tone === 'ok' ? 'text-ok' : 'text-bad'}`}
              >
                {msg.text}
              </T>
            ) : null}
            {/* "Only your coach can end the link" stood here until
                `end_coach_relationship` was wired on the phone (15 August
                2026). It was true when written — nothing could set
                `status = 'revoked'` at all — and the migration that fixed it
                says why either party has to be able to: leaving must not
                require the permission of the person you are leaving. */}
            <T className="mt-1 text-3 text-dim">
              A linked coach can see your training, and can send you sessions. You choose what else they see, and you
              can end the link yourself at any time.
            </T>
          </>
        ) : (
          <T className="mt-1.5 text-3 text-dim">
            Sign in above first — the link is made against your account, so there is nothing to link a code to until then.
          </T>
        )}
      </Card>
    </View>
  );
}

/*
 * One consent, its state, and the control that changes it.
 *
 * The BUTTON says what pressing it does; the line under it says what is true
 * now. Those are two different sentences and a single toggle glyph tries to be
 * both — on a control whose whole job is to tell an athlete who can see their
 * food diary, the ambiguity is the failure.
 */
function GrantRow({
  title,
  detail,
  granted,
  busy,
  onChange,
}: {
  title: string;
  detail: string;
  granted: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View className="mt-1.5">
      <View className="flex-row items-center">
        <View className="flex-1 pr-1">
          <T w="med" className="text-4 text-text">{title}</T>
          <T className="mt-0.5 text-3 text-dim">{detail}</T>
        </View>
        <Btn
          variant={granted ? 'ghost' : 'brass'}
          disabled={busy}
          onPress={() => onChange(!granted)}
          label={granted ? `stop sharing ${title}` : `share ${title}`}
        >
          {granted ? 'Stop' : 'Share'}
        </Btn>
      </View>
      <T className={`mt-0.5 text-3 ${granted ? 'text-ok' : 'text-muted'}`}>
        {granted ? 'Shared with your coach now.' : 'Not shared. Your coach cannot see this.'}
      </T>
    </View>
  );
}

/*
 * WHAT ELSE YOUR COACH CAN SEE — the athlete's half of the read grants, and
 * the athlete's half of ending the relationship.
 *
 * `set_nutrition_read_grant` (20260808), `set_readiness_read_grant` (20260810)
 * and `end_coach_relationship` (20260814) were all defined, granted and tested
 * server-side, and until this card NOTHING CALLED ANY OF THEM. The bench reads
 * a nutrition window and a readiness trend through grants the athlete could
 * not give; the migration that let either party end a coaching link could only
 * ever be reached by the coach. A control the person it belongs to cannot
 * reach is not a consent model.
 *
 * It renders NOTHING for an athlete with no coach. There is no consent to
 * express about a relationship that does not exist, and an uncoached athlete —
 * most of them — should not be shown a panel of dead switches explaining a
 * product they are not in.
 *
 * The training SUMMARY is not on this card, and must not be added to it. A
 * coach who coaches you can see completed-versus-planned without any grant
 * (`get_athlete_training_summary` is gated on the relationship alone); that is
 * what the relationship IS, and it is what the copy here says plainly rather
 * than implying these two switches cover everything.
 */
function CoachConsentCard({ version, onLeft }: { version: number; onLeft: () => void }) {
  const { enabled, user, syncNow } = useSync();
  const [link, setLink] = useState<CoachLink | null>(null);
  const [coachName, setCoachName] = useState<string | null>(null);
  const [grants, setGrants] = useState<ReadGrants>({ nutrition: false, readiness: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  /* Re-read on every account change AND on `version`, which the sibling cards
     bump when a link is made or ended. The grants themselves are deliberately
     NOT cached in the cloud module: a stale "shared" is a claim about who can
     see this athlete's food diary, and being wrong about that is the one thing
     this card exists to prevent. */
  useEffect(() => {
    if (!supabaseClient || !user) {
      setLink(null);
      setCoachName(null);
      setGrants({ nutrition: false, readiness: false });
      return;
    }
    let alive = true;
    void (async () => {
      const client = supabaseClient;
      const found = await readMyCoachLink(client, user.id);
      if (!alive) return;
      setLink(found);
      if (!found) {
        setCoachName(null);
        setGrants({ nutrition: false, readiness: false });
        return;
      }
      /* Both best-effort, and the name is allowed to be missing: a coach who
         has published no display name stays nameless rather than being given
         one derived from an id. `is_my_coach` (20260814) is what makes this
         read possible from the athlete's side at all. */
      const [name, current] = await Promise.all([
        getDisplayName(client, found.coachUserId),
        readMyReadGrants(client, user.id, found),
      ]);
      if (!alive) return;
      setCoachName(name);
      setGrants(current);
    })();
    return () => {
      alive = false;
    };
  }, [user, version]);

  if (!enabled || !user || !link) return null;

  const change = async (kind: GrantKind, next: boolean) => {
    if (!supabaseClient) return;
    setBusy(true);
    setMsg(null);
    try {
      const stored = await setReadGrant(supabaseClient, link, kind, next);
      setGrants((prev) => ({ ...prev, [kind]: stored }));
      setMsg({
        tone: 'ok',
        text: stored
          ? 'Saved. Your coach can see this from now on.'
          : 'Saved. Your coach can no longer see this.',
      });
    } catch (e) {
      /* The state on screen is NOT moved on a failure. A switch that flips
         optimistically and then fails silently is a phone telling an athlete
         their data is private when the server disagrees. */
      setMsg({ tone: 'bad', text: humanizeError(e, 'read grant') + ' Nothing changed.' });
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    Alert.alert(
      coachName ? `Stop being coached by ${coachName}?` : 'End the link with your coach?',
      'They stop seeing your training immediately and cannot send you anything new. A week they already published stays on this phone until the week is over — you can clear it yourself from your calendar.',
      [
        { text: 'Keep the link', style: 'cancel' },
        {
          text: 'End it',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!supabaseClient) return;
              setBusy(true);
              setMsg(null);
              try {
                await leaveMyCoach(supabaseClient, link, user.id);
                setLink(null);
                setCoachName(null);
                setGrants({ nutrition: false, readiness: false });
                /* The card is about to unmount itself, so the confirmation has
                   to be somewhere that survives it. `onLeft` re-reads the link
                   from the server, which is also the check that it really is
                   gone rather than the phone assuming so. */
                onLeft();
                void syncNow();
              } catch (e) {
                setMsg({ tone: 'bad', text: humanizeError(e, 'end coaching') + ' You are still linked.' });
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View>
      <SectionHead title="What your coach can see" />
      <Card>
        <T className="text-4 text-muted">
          {coachName ? `You are coached by ${coachName}.` : 'You are linked to a coach.'} They can already see whether
          you did the sessions they planned. Everything below is yours to give and yours to take back.
        </T>
        <GrantRow
          title="Nutrition"
          detail="Your logged days, calories and macros, and how your weight is trending."
          granted={grants.nutrition}
          busy={busy}
          onChange={(next) => void change('nutrition', next)}
        />
        <GrantRow
          title="Readiness"
          detail="Your check-ins and recovery trend — sleep, soreness, life stress."
          granted={grants.readiness}
          busy={busy}
          onChange={(next) => void change('readiness', next)}
        />
        {msg ? (
          <T
            accessibilityLiveRegion={msg.tone === 'bad' ? 'assertive' : 'polite'}
            className={`mt-1 text-3 ${msg.tone === 'ok' ? 'text-ok' : 'text-bad'}`}
          >
            {msg.text}
          </T>
        ) : null}
        {/* Pain and illness are NOT on this card and are not a grant. They are
            safety flags a coach sees because they coach you, and hiding one
            behind consent would mean a coach could plan a week around an
            injury the system knew about and did not mention. */}
        <T className="mt-1.5 text-3 text-dim">
          A pain or illness flag is always visible to your coach. It is a safety signal, not a data share.
        </T>
        <Btn className="mt-1.5" onPress={leave} disabled={busy} label="end the link with my coach">
          {busy ? 'Working…' : 'End the link with my coach'}
        </Btn>
        <T className="mt-1 text-3 text-dim">
          You can do this yourself — it does not need your coach&apos;s agreement. A week they already published stays
          until it is over.
        </T>
      </Card>
    </View>
  );
}

/*
 * The athlete's name, owned by the athlete.
 *
 * Without a row here a coach's roster shows `Athlete 3f2a1b9c` off the uuid,
 * and that is the honest default: nothing anywhere backfills a name from an
 * email address. Setting one is a grant, and clearing it is the withdrawal —
 * the server DELETES the row for a blank name, which is why "Clear" is a real
 * control on this card and not an error case hidden behind validation.
 */
function AthleteNameCard() {
  const { enabled, user } = useSync();
  const [stored, setStored] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  /* Read once per account, through the module's cache — Settings is a TAB and
     stays mounted, so this must not become a query per render. A failed read
     answers null, which shows "no name set"; that is a display the athlete can
     correct by typing, never a write. */
  useEffect(() => {
    if (!supabaseClient || !user) {
      setStored(null);
      setName('');
      return;
    }
    let alive = true;
    void getMyDisplayName(supabaseClient, user.id).then((current) => {
      if (!alive) return;
      setStored(current);
      setName(current ?? '');
    });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!enabled) return null;

  const save = async (next: string) => {
    if (!supabaseClient || !user) return;
    setBusy(true);
    setMsg(null);
    try {
      const written = await setMyDisplayName(supabaseClient, user.id, next);
      setStored(written);
      setName(written ?? '');
      setMsg({
        tone: 'ok',
        text: written
          ? 'Saved. Your coach sees this name from now on.'
          : 'Name withdrawn. Your coach sees the id again, not a name.',
      });
    } catch (e) {
      setMsg({ tone: 'bad', text: humanizeError(e, 'display name') + ' Nothing on this phone changed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <SectionHead title="Your name" />
      <Card>
        <T className="text-4 text-muted">
          {stored ? `Your coach sees you as “${stored}”.` : 'You have no name set — a coach sees an id, like “Athlete 3f2a1b9c”.'}
        </T>
        {user ? (
          <>
            <Input
              value={name}
              onChangeText={(t: string) => {
                setName(t);
                if (msg) setMsg(null);
              }}
              maxLength={80}
              placeholder="the name your coach sees"
              accessibilityLabel="display name"
              className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
            />
            <View className="mt-1.5 flex-row gap-1">
              <Btn
                variant="brass"
                className="flex-1"
                onPress={() => void save(name)}
                disabled={busy || !name.trim() || name.trim() === stored}
              >
                {busy ? 'Saving…' : 'Save name'}
              </Btn>
              <Btn className="flex-1" onPress={() => void save('')} disabled={busy || !stored} label="clear my name">
                Clear
              </Btn>
            </View>
            {msg ? (
              <T
                accessibilityLiveRegion={msg.tone === 'bad' ? 'assertive' : 'polite'}
                className={`mt-1 text-3 ${msg.tone === 'ok' ? 'text-ok' : 'text-bad'}`}
              >
                {msg.text}
              </T>
            ) : null}
            {/* The whole point of the card, so it is stated plainly and not as
                fine print: this is the ONE thing a coach can see about you that
                you typed, and clearing it takes it back. */}
            <T className="mt-1 text-3 text-dim">
              Only a coach you are linked to can see this name. Nobody else can — not other athletes, not other coaches.
              Clearing it takes it back.
            </T>
          </>
        ) : (
          <T className="mt-1.5 text-3 text-dim">
            Sign in above first — the name is stored against your account, so there is nowhere to keep it until then.
          </T>
        )}
      </Card>
    </View>
  );
}

/* Connection only. The readings themselves — sleep, recovery, strain — live on
   Home, where you actually look at them before training. Repeating them here
   was two places to keep honest and one more screen to scroll. */
function WhoopCard() {
  const { connected, sample, busy, error, lastSyncAt, connect, sync, disconnect } = useWhoop();
  const rec = todayRecovery(sample);
  const { color } = useTheme();
  return (
    <View>
      <SectionHead title="WHOOP" />
      <Card>
        {connected ? (
          <>
            <T num className="text-4 text-muted">
              Connected{rec != null ? ` · today ${rec}% recovery` : ' · no reading yet today'}
            </T>
            {lastSyncAt ? (
              <T className="mt-1.5 text-3 text-dim">Last pulled {new Date(lastSyncAt).toLocaleString()}</T>
            ) : null}
            <View className="mt-1.5 flex-row gap-1">
              <Tap box={{ h: 42 }} onPress={() => void sync()} disabled={busy} className="flex-1 items-center rounded-md border border-line2 bg-panel2 py-1.5">
                <T w="med" className="text-4 text-text">{busy ? 'Pulling…' : 'Pull now'}</T>
              </Tap>
              <Tap box={{ h: 42 }} onPress={() => void disconnect()} className="flex-1 items-center rounded-md py-1.5">
                <T className="text-4 text-muted">Disconnect</T>
              </Tap>
            </View>
          </>
        ) : (
          <>
            <T className="text-4 text-muted">
              Connect WHOOP and your zones re-tune to the day: a low-recovery morning widens the easy band and pulls the
              hard line down.
            </T>
            <Tap box={{ h: 42 }} onPress={connect} className="mt-1.5 items-center rounded-md bg-gold py-1.5">
              <T w="med" className="text-4" style={{ color: color.onAccent }}>Connect WHOOP</T>
            </Tap>
            {/* The connection IS visible back in the app now: it is filed under
                the Supabase user rather than a browser cookie this app could
                never read. Come back here after consenting and pull. */}
            <T className="mt-1 text-3 text-dim">
              Opens your browser to consent. Come back here afterwards — the connection is filed against your account,
              so this screen picks it up.
            </T>
          </>
        )}
        {error ? <T accessibilityLiveRegion="assertive" className="mt-1 text-3 text-bad">{error}</T> : null}
      </Card>
    </View>
  );
}

/* Same shape as WhoopCard for the connection half; below it, the import step.
   Pulled results stay outside the training database until the athlete says so:
   the plan is computed to show what WOULD land ("N new"), and only the button
   press applies it — matched results onto their session blocks, the rest into
   the standalone history, deduped forever after by externalId. */
function Concept2Card() {
  const { connected, results, busy, error, lastSyncAt, connect, sync, disconnect } = useConcept2();
  const { db, update } = useDb();
  const [importMsg, setImportMsg] = useState('');
  const { color } = useTheme();
  // Recomputed against the live db, so an applied import self-heals to zero
  // pending and the button disappears rather than offering the same work twice.
  const plan = useMemo(() => planConcept2Import(results, db), [results, db]);
  const pending = plan.merges.length + plan.standalone.length;

  function importNow() {
    let counts: Concept2ImportCounts | null = null;
    update((draft) => {
      // Re-plan against the draft: the memoized plan can be a render stale,
      // and apply's own re-verification only degrades, never re-matches.
      counts = applyConcept2Import(draft, planConcept2Import(results, draft));
    });
    if (counts) setImportMsg(concept2ImportSummary(counts));
  }

  return (
    <View>
      <SectionHead title="Concept2 Logbook" />
      <Card>
        {connected ? (
          <>
            <T num className="text-4 text-muted">
              Connected{results.length ? ` · ${results.length} synced result${results.length === 1 ? '' : 's'}` : ' · no results synced yet'}
            </T>
            {lastSyncAt ? (
              <T className="mt-1.5 text-3 text-dim">Last pulled {new Date(lastSyncAt).toLocaleString()}</T>
            ) : null}
            <View className="mt-1.5 flex-row gap-1">
              <Tap box={{ h: 42 }} onPress={() => void sync()} disabled={busy} className="flex-1 items-center rounded-md border border-line2 bg-panel2 py-1.5">
                <T w="med" className="text-4 text-text">{busy ? 'Pulling…' : 'Pull now'}</T>
              </Tap>
              <Tap box={{ h: 42 }} onPress={() => void disconnect()} className="flex-1 items-center rounded-md py-1.5">
                <T className="text-4 text-muted">Disconnect</T>
              </Tap>
            </View>
            {pending ? (
              <>
                <Tap box={{ h: 42 }} onPress={importNow} className="mt-1 items-center rounded-md bg-gold py-1.5">
                  <T w="med" className="text-4" style={{ color: color.onAccent }}>
                    Add {pending} new result{pending === 1 ? '' : 's'} to your history
                  </T>
                </Tap>
                <T className="mt-0.5 text-3 text-dim">
                  {plan.merges.length
                    ? `${plan.merges.length} line${plan.merges.length === 1 ? 's' : ''} up with a logged session; the rest file on their own. `
                    : ''}
                  Nothing you recorded is overwritten, and each result imports once.
                </T>
              </>
            ) : null}
            {importMsg ? (
              <T accessibilityLiveRegion="polite" className="mt-1 text-3 text-ok">
                {importMsg}
              </T>
            ) : null}
          </>
        ) : (
          <>
            <T className="text-4 text-muted">
              Connect your Concept2 Logbook and rower, SkiErg and BikeErg sessions pull in with their real splits — no
              re-typing what the erg already measured.
            </T>
            <Tap box={{ h: 42 }} onPress={connect} className="mt-1.5 items-center rounded-md bg-gold py-1.5">
              <T w="med" className="text-4" style={{ color: color.onAccent }}>Connect Concept2</T>
            </Tap>
            <T className="mt-1 text-3 text-dim">
              Opens your browser to consent. Come back here afterwards — the connection is filed against your account,
              so this screen picks it up.
            </T>
          </>
        )}
        {error ? <T accessibilityLiveRegion="assertive" className="mt-1 text-3 text-bad">{error}</T> : null}
      </Card>
    </View>
  );
}
