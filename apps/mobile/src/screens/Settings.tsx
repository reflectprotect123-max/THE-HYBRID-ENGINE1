import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { conMaxHr, conZones, restingHr, type EngineDB, type Profile } from '@hybrid/engine';
import { useDb } from '../store/db';
import { useSync } from '../cloud/sync';
import { useWhoop } from '../cloud/whoop';
import { isPersistent } from '../store/storage';

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
      <Text className="text-2 font-bold uppercase tracking-widest text-dim">{label}</Text>
      <TextInput
        value={String(value ?? '')}
        onChangeText={onChange}
        keyboardType="number-pad"
        className="mt-0.5 h-5 rounded-md border border-line bg-well px-1 text-5 font-bold text-text"
      />
      <Text className="mt-0.5 text-3 text-dim">{hint}</Text>
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
      <Text className="text-2 font-bold uppercase tracking-widest text-dim">Settings</Text>
      <Text className="text-8 font-black text-text">Your numbers</Text>

      {saveFailed || !isPersistent ? (
        <Text className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          Storage is not persisting on this build. Anything you log now may not survive a restart — export a backup
          below before you train again.
        </Text>
      ) : null}

      <Field label="Age" hint="Used for the Tanaka max-HR estimate (208 − 0.7 × age)." value={profile.age} onChange={(v) => set({ age: v })} />
      <Field label="Max HR" hint="A tested max wins over the estimate." value={profile.maxHr} onChange={(v) => set({ maxHr: v })} />
      <Field label="Resting HR" hint="With this, zones use Karvonen instead of percent-of-max." value={profile.restingHr} onChange={(v) => set({ restingHr: v })} />

      <CloudCard />
      <CoachLinkCard />
      <WhoopCard />

      <Text className="mt-3 mb-1 text-6 font-bold text-text">What that produces</Text>
      <View className="rounded-lg border border-line bg-panel p-2">
        <Text className="text-4 text-muted">
          Max {conMaxHr(profile)} · resting {restingHr(profile, whoop) ?? '—'} ·{' '}
          {zones.method === 'hrr' ? 'Karvonen (HRR)' : 'percent of max'}
        </Text>
        {zones.list.map((b) => (
          <View key={b.key} className="mt-0.5 flex-row">
            <Text className="flex-1 text-4 text-text">{b.name}</Text>
            <Text className="text-4 text-muted">
              {b.lo}–{b.hi}
            </Text>
          </View>
        ))}
      </View>

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
      setMsg(`Export failed: ${String((e as Error)?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text className="mt-3 mb-1 text-6 font-bold text-text">Your data</Text>
      <View className="rounded-lg border border-line bg-panel p-2">
        <Text className="text-4 text-muted">
          {db.workouts.length} sessions in the library · {db.sessions.length} logged
        </Text>
        <Pressable
          onPress={() => void share()}
          disabled={busy}
          className={`mt-1.5 items-center rounded-md border border-line2 bg-panel2 py-1.5 ${busy ? 'opacity-40' : ''}`}
        >
          <Text className="text-4 font-bold text-text">{busy ? 'Exporting…' : 'Export a backup'}</Text>
        </Pressable>
        {msg ? <Text className="mt-1 text-3 text-muted">{msg}</Text> : null}
        <Text className="mt-1 text-3 text-dim">
          Everything on this device as plain JSON, sent wherever you keep files. Keeping one is worth the ten seconds.
        </Text>
      </View>
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
      <Text className="mt-3 mb-1 text-6 font-bold text-text">Your coach</Text>
      <View className="rounded-lg border border-line bg-panel p-2">
        {coachLinked ? (
          <Text className="text-4 text-muted">
            Linked. Sessions your coach assigns appear in your Library automatically, and they can see a summary of
            your training — never your heart-rate traces, notes or settings, and only the last 90 days.
          </Text>
        ) : (
          <>
            <Text className="text-4 text-muted">
              Got a code from a coach? Entering it is what grants them access — they cannot link to you on their own.
            </Text>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="INVITE CODE"
              placeholderTextColor="#847d73"
              className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-center text-5 font-bold tracking-widest text-text"
            />
            {msg ? <Text className="mt-1 text-3 text-warn">{msg}</Text> : null}
            <Pressable
              onPress={async () => {
                setBusy(true);
                setMsg((await claimInvite(code)) || 'Linked — your coach can now assign you sessions.');
                setBusy(false);
              }}
              disabled={busy || !code.trim()}
              className={`mt-1.5 items-center rounded-md bg-gold py-1.5 ${busy || !code.trim() ? 'opacity-40' : ''}`}
            >
              <Text className="text-4 font-black text-bg">{busy ? 'Linking…' : 'Link to coach'}</Text>
            </Pressable>
          </>
        )}
      </View>
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
      <Text className="mt-3 mb-1 text-6 font-bold text-text">Cloud sync</Text>
      <View className="rounded-lg border border-line bg-panel p-2">
        {user ? (
          <>
            <Text className="text-4 text-muted">
              Signed in as <Text className="font-bold text-text">{user.email}</Text>
            </Text>
            <Text className="mt-0.5 text-3 text-dim">
              {busy ? 'Syncing…' : syncedAt ? 'Last synced ' + new Date(syncedAt).toLocaleTimeString() : 'Not synced yet.'}
            </Text>
            {!isPersistent ? (
              <Text className="mt-1 text-3 text-bad">
                Storage is not persisting in this build, so this sign-in will not survive a restart.
              </Text>
            ) : null}
            {error ? <Text className="mt-1 text-3 text-bad">{error}</Text> : null}
            <View className="mt-1.5 flex-row gap-1">
              <Pressable onPress={() => void syncNow()} className="flex-1 items-center rounded-md border border-line2 bg-panel2 py-1.5">
                <Text className="text-4 font-bold text-text">Sync now</Text>
              </Pressable>
              <Pressable onPress={() => void signOut()} className="flex-1 items-center rounded-md py-1.5">
                <Text className="text-4 text-muted">Sign out</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text className="text-4 text-muted">Sign in to sync across devices and receive sessions from a coach.</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="email"
              placeholderTextColor="#847d73"
              className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="password"
              placeholderTextColor="#847d73"
              className="mt-1 h-5 rounded-md border border-line bg-well px-1 text-4 text-text"
            />
            {msg ? <Text className="mt-1 text-3 text-warn">{msg}</Text> : null}
            <View className="mt-1.5 flex-row gap-1">
              <Pressable onPress={() => void go(signIn)} className="flex-1 items-center rounded-md bg-gold py-1.5">
                <Text className="text-4 font-black text-bg">Sign in</Text>
              </Pressable>
              <Pressable onPress={() => void go(signUp)} className="flex-1 items-center rounded-md border border-line2 bg-panel2 py-1.5">
                <Text className="text-4 font-bold text-text">Create account</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function WhoopCard() {
  const { connected, sample, busy, error, lastSyncAt, connect, sync, disconnect } = useWhoop();
  return (
    <View>
      <Text className="mt-3 mb-1 text-6 font-bold text-text">WHOOP</Text>
      <View className="rounded-lg border border-line bg-panel p-2">
        {connected ? (
          <>
            <Text className="text-4 text-muted">
              Connected
              {sample?.recoveryScore != null ? ` · today ${Math.round(Number(sample.recoveryScore))}%` : ' · no reading yet today'}
            </Text>
            {lastSyncAt ? (
              <Text className="mt-0.5 text-3 text-dim">Last pulled {new Date(lastSyncAt).toLocaleString()}</Text>
            ) : null}
            <View className="mt-1.5 flex-row gap-1">
              <Pressable onPress={() => void sync()} disabled={busy} className="flex-1 items-center rounded-md border border-line2 bg-panel2 py-1.5">
                <Text className="text-4 font-bold text-text">{busy ? 'Pulling…' : 'Pull now'}</Text>
              </Pressable>
              <Pressable onPress={() => void disconnect()} className="flex-1 items-center rounded-md py-1.5">
                <Text className="text-4 text-muted">Disconnect</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text className="text-4 text-muted">
              Connect WHOOP and your zones re-tune to the day: a low-recovery morning widens the easy band and pulls the
              hard line down.
            </Text>
            <Pressable onPress={connect} className="mt-1.5 items-center rounded-md bg-gold py-1.5">
              <Text className="text-4 font-black text-bg">Connect WHOOP</Text>
            </Pressable>
            {/* The connection IS visible back in the app now: it is filed under
                the Supabase user rather than a browser cookie this app could
                never read. Come back here after consenting and pull. */}
            <Text className="mt-1 text-3 text-dim">
              Opens your browser to consent. Come back here afterwards — the connection is filed against your account,
              so this screen picks it up.
            </Text>
          </>
        )}
        {error ? <Text className="mt-1 text-3 text-dim">{error}</Text> : null}
      </View>
    </View>
  );
}
