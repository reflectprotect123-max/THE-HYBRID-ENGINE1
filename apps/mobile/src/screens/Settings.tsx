import { useMemo } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { conMaxHr, conZones, restingHr, type Profile } from '@hybrid/engine';
import { useDb } from '../store/db';
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
