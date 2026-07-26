import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { conMaxHr, conZones, restingHr, type Profile } from '@hybrid/engine';
import { useDb } from '../store/db';
import { useSync } from '../cloud/sync';
import { useWhoop } from '../cloud/whoop';
import { isPersistent } from '../store/storage';

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

  const Field = ({ label, hint, value, onChange }: { label: string; hint: string; value: unknown; onChange: (v: string) => void }) => (
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

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, paddingHorizontal: 16 }}
    >
      <Text className="text-2 font-bold uppercase tracking-widest text-dim">Settings</Text>
      <Text className="text-8 font-black text-text">Your numbers</Text>

      {saveFailed || !isPersistent ? (
        <Text className="mt-2 rounded-md border border-bad bg-panel p-2 text-4 text-bad">
          Storage is not persisting on this build. Anything you log now may not survive a restart.
        </Text>
      ) : null}

      <Field label="Age" hint="Used for the Tanaka max-HR estimate (208 − 0.7 × age)." value={profile.age} onChange={(v) => set({ age: v })} />
      <Field label="Max HR" hint="A tested max wins over the estimate." value={profile.maxHr} onChange={(v) => set({ maxHr: v })} />
      <Field label="Resting HR" hint="With this, zones use Karvonen instead of percent-of-max." value={profile.restingHr} onChange={(v) => set({ restingHr: v })} />

      <CloudCard />
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
    </ScrollView>
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
  const { connected, sample, busy, connect, sync, disconnect } = useWhoop();
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
            <Text className="mt-1 text-3 text-dim">
              Opens your browser. The connection is not yet visible back in the app — see the note in MIGRATION.md.
            </Text>
          </>
        )}
      </View>
    </View>
  );
}
