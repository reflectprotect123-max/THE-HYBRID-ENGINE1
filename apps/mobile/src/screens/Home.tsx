import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { conZones, recoveryBand, todayRecovery, ymd } from '@hybrid/engine';
import { useDb } from '../store/db';

/* Readiness first, because it changes what today should be. */
export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { db, hr, whoop } = useDb();
  const rec = todayRecovery(whoop);
  const band = recoveryBand(rec);
  const zones = useMemo(() => conZones(hr), [hr]);
  const today = ymd(new Date());
  const dow = new Date().getDay();
  const planned = db.workouts.filter((w) => (w.dates || []).includes(today) || (w.days || []).includes(dow));

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32, paddingHorizontal: 16 }}
    >
      <Text className="text-2 font-bold uppercase tracking-widest text-dim">Today</Text>
      <Text className="text-8 font-black text-text">
        {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </Text>

      <View className="mt-2 rounded-lg border border-line bg-panel p-2">
        <Text className="text-2 font-bold uppercase tracking-widest text-dim">Readiness</Text>
        <Text className="mt-0.5 text-9 font-black text-gold2">{rec == null ? '—' : rec}</Text>
        <Text className="text-4 text-muted">
          {band === 'low'
            ? 'Zones are eased today and conditioning is dialled back a notch.'
            : band === 'good'
              ? 'Zones widened slightly at the top. Good day to push.'
              : band === 'watch'
                ? 'Nothing adjusted. Train as prescribed.'
                : 'No score yet. Set a resting HR in Settings to sharpen your zones.'}
        </Text>
      </View>

      <Text className="mt-3 mb-1 text-6 font-bold text-text">Your zones today</Text>
      <View className="rounded-lg border border-line bg-panel p-2">
        <Text className="text-3 text-dim">
          {zones.method === 'hrr' ? `Karvonen · resting ${zones.rest}` : 'percent of max'} · max {zones.max}
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

      <Text className="mt-3 mb-1 text-6 font-bold text-text">Today&apos;s plan</Text>
      {planned.length ? (
        planned.map((w) => (
          <View key={w.id} className="mb-1 rounded-lg border border-line bg-panel p-2">
            <Text className="text-5 font-bold text-text">{w.name || 'Session'}</Text>
            <Text className="text-3 text-dim">
              {w.blocks.length} blocks{w.origin === 'coach' ? ' · from your coach' : ''}
            </Text>
          </View>
        ))
      ) : (
        <Text className="text-4 text-muted">Nothing planned today. Let a rest day be a rest day.</Text>
      )}
    </ScrollView>
  );
}
