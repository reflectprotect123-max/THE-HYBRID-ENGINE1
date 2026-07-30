import { useMemo, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { conMaxHr, conZones, restingHr, todayRecovery, type EngineDB, type Profile } from '@hybrid/engine';
import { color } from '@hybrid/design';
import { useDb } from '../store/db';
import { useSync } from '../cloud/sync';
import { useWhoop } from '../cloud/whoop';
import { isPersistent } from '../store/storage';
import { parseBackup } from '../store/restore';
import { Card, Input, Kicker, SectionHead, T, Tap, Title } from '../ui';
import { humanizeError } from '../errors';

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
  const { db, hr, whoop, update, saveFailed } = useDb();
  const profile = db.settings.profile || {};
  const zones = useMemo(() => conZones(hr), [hr]);

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

      {saveFailed || !isPersistent ? (
        <T className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          Storage is not persisting on this build. Anything you log now may not survive a restart — export a backup
          below before you train again.
        </T>
      ) : null}

      <Field label="Age" hint="Used for the Tanaka max-HR estimate (208 − 0.7 × age)." value={profile.age} onChange={(v) => set({ age: v })} />
      <Field label="Max HR" hint="A tested max wins over the estimate." value={profile.maxHr} onChange={(v) => set({ maxHr: v })} />
      <Field label="Resting HR" hint="With this, zones use Karvonen instead of percent-of-max." value={profile.restingHr} onChange={(v) => set({ restingHr: v })} />

      <CloudCard />
      <CoachLinkCard />
      <WhoopCard />

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
    </ScrollView>
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
    update((d) => {
      d.workouts = found.db.workouts;
      d.sessions = found.db.sessions;
      d.settings = found.db.settings;
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
            <Tap box={{ h: 42 }} onPress={replace} className="flex-1 items-center rounded-md border border-gold-line bg-gold-wash py-1.5">
              <T w="med" className="text-4 text-gold2">Replace</T>
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

function CoachLinkCard() {
  const { enabled, user, coachLinked, claimInvite } = useSync();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (!enabled || !user) return null;

  return (
    <View>
      <SectionHead title="Your coach" />
      <Card>
        {coachLinked ? (
          <T className="text-4 text-muted">
            Linked. Sessions your coach assigns appear in your Library automatically, and they can see a summary of
            your training — never your heart-rate traces, notes or settings, and only the last 90 days.
          </T>
        ) : (
          <>
            <T className="text-4 text-muted">
              Got a code from a coach? Entering it is what grants them access — they cannot link to you on their own.
            </T>
            <Input
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="INVITE CODE"
              w="semi"
              className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-center text-5 tracking-widest text-text"
            />
            {msg ? <T className="mt-1 text-3 text-warn">{msg}</T> : null}
            <Tap box={{ h: 42 }}
              onPress={async () => {
                setBusy(true);
                setMsg((await claimInvite(code)) || 'Linked — your coach can now assign you sessions.');
                setBusy(false);
              }}
              disabled={busy || !code.trim()}
              className={`mt-1.5 items-center rounded-md bg-gold py-1.5 ${busy || !code.trim() ? 'opacity-40' : ''}`}
            >
              <T w="med" className="text-4" style={{ color: color.onAccent }}>{busy ? 'Linking…' : 'Link to coach'}</T>
            </Tap>
          </>
        )}
      </Card>
    </View>
  );
}

function CloudCard() {
  const { enabled, user, busy, error, syncedAt, signIn, signUp, signOut, syncNow } = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
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
            <T className="mt-0.5 text-3 text-dim">
              {busy ? 'Syncing…' : syncedAt ? 'Last synced ' + new Date(syncedAt).toLocaleTimeString() : 'Not synced yet.'}
            </T>
            {!isPersistent ? (
              <T className="mt-1 text-3 text-bad">
                Storage is not persisting in this build, so this sign-in will not survive a restart.
              </T>
            ) : null}
            {error ? <T className="mt-1 text-3 text-bad">{error}</T> : null}
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
            <T className="text-4 text-muted">Sign in to sync across devices and receive sessions from a coach.</T>
            <Input
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="email"
              className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
            />
            <Input
              value={password}
              onChangeText={setPassword}
              secureTextEntry
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

/* Connection only. The readings themselves — sleep, recovery, strain — live on
   Home, where you actually look at them before training. Repeating them here
   was two places to keep honest and one more screen to scroll. */
function WhoopCard() {
  const { connected, sample, busy, error, lastSyncAt, connect, sync, disconnect } = useWhoop();
  const rec = todayRecovery(sample);
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
        {error ? <T className="mt-1 text-3 text-dim">{error}</T> : null}
      </Card>
    </View>
  );
}
