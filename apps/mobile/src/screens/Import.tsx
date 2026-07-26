import { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { impParse, impToWorkout, learnMove, learnWord, lexiconOf, uid, unlearn, type ImpIssue, type ImpResult } from '@hybrid/engine';
import { useDb } from '../store/db';
import { recogniseText, startDictation, stopDictation } from '../native/capabilities';
import { Btn, Card, Empty, Kicker, Screen, SectionHead, Title } from '../ui';
import type { RootStackParams } from '../App';

/** Dynamic specifier: keeps TypeScript from resolving a module that only
    exists in a full native build, while still loading it when present. */
const dynImport = (m: string): Promise<unknown> => import(m);

async function pickImage(): Promise<string | null> {
  try {
    const P = (await dynImport('expo-image-picker')) as {
      requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
      launchImageLibraryAsync(o: unknown): Promise<{ canceled: boolean; assets?: { uri: string }[] }>;
    };
    const perm = await P.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
    const res = await P.launchImageLibraryAsync({ quality: 1 });
    return res.canceled ? null : (res.assets?.[0]?.uri ?? null);
  } catch {
    return null;
  }
}

/*
 * Paste, dictate or photograph a workout.
 *
 * All three routes end in the SAME parser (`impParse` in @hybrid/engine) — the
 * only difference is how the text is obtained. Every guess the parser is unsure
 * about comes back as a question rather than a silent assumption, and answering
 * one teaches the app permanently.
 */
export function ImportScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { db, update } = useDb();
  const [text, setText] = useState('');
  const [resolved, setResolved] = useState<number[]>([]);
  const [listening, setListening] = useState(false);
  const [msg, setMsg] = useState('');

  const lex = useMemo(() => lexiconOf(db.settings), [db.settings]);
  const parsed: ImpResult | null = useMemo(() => (text.trim() ? impParse(text, lex) : null), [text, lex]);
  const open = parsed ? parsed.issues.filter((i) => !resolved.includes(i.id)) : [];

  const save = () => {
    if (!parsed) return;
    const w = impToWorkout(parsed, uid);
    update((d) => {
      d.workouts.push(w as (typeof d.workouts)[number]);
    });
    nav.navigate('Tabs');
  };

  const dictate = async () => {
    if (listening) {
      await stopDictation();
      setListening(false);
      return;
    }
    const base = text;
    const ok = await startDictation((heard) => setText((base ? base + '\n' : '') + heard));
    if (!ok) setMsg('Speech recognition is not available in this build.');
    else setListening(true);
  };

  const photo = async () => {
    // Two steps, either of which can be missing from a given build: pick an
    // image, then recognise text in it. On-device OCR — the model ships with
    // the app, so this works offline and sends the photo nowhere.
    //
    // The specifier is passed through a variable so TypeScript does not try to
    // resolve a module that is only present in a full native build.
    const uri = await pickImage();
    if (!uri) {
      setMsg('Photo import needs the camera roll — not available in this build.');
      return;
    }
    const out = await recogniseText(uri);
    if (!out) setMsg('Could not read any text in that photo.');
    else setText((t) => (t ? t + '\n' : '') + out);
  };

  return (
    <Screen>
      <Kicker>Import</Kicker>
      <Title>Bring a workout in</Title>

      <Card className="mt-2">
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            setResolved([]);
          }}
          multiline
          numberOfLines={8}
          placeholder={'Paste it exactly as written.\n\nLower A\nA1) Back squat 5x5 @8\nA2) RDL 3x10\nrest 120'}
          placeholderTextColor="#847d73"
          className="min-h-[140px] rounded-md border border-line bg-well px-1 py-1 text-4 text-text"
          textAlignVertical="top"
        />
        <View className="mt-1 flex-row gap-1">
          <Btn className="flex-1" onPress={() => void dictate()}>
            {listening ? 'Listening…' : '🎤 Dictate'}
          </Btn>
          <Btn className="flex-1" onPress={() => void photo()}>
            📷 Photo
          </Btn>
          {text ? (
            <Btn className="flex-1" onPress={() => setText('')}>
              Clear
            </Btn>
          ) : null}
        </View>
        {msg ? <Text className="mt-1 text-3 text-muted">{msg}</Text> : null}
      </Card>

      {!parsed ? (
        <Empty
          title="Nothing to read yet"
          body="Whiteboard shorthand is fine — 5x5, ladders, A1/A2 pairs, rest 120."
        />
      ) : (
        <>
          {open.length ? (
            <>
              <SectionHead title={`${open.length} thing${open.length === 1 ? '' : 's'} to check`} />
              {open.map((i) => (
                <Issue
                  key={i.id}
                  issue={i}
                  onDismiss={() => setResolved((r) => [...r, i.id])}
                  onTeachWord={(w) =>
                    update((d) => {
                      d.settings.lexicon = learnWord(lexiconOf(d.settings), w, 'rest');
                    })
                  }
                  onTeachMove={(alias, name, mode) =>
                    update((d) => {
                      d.settings.lexicon = learnMove(lexiconOf(d.settings), alias, name, mode as 'reps');
                    })
                  }
                />
              ))}
            </>
          ) : null}

          <SectionHead title={parsed.name} />
          {parsed.blocks.length ? (
            parsed.blocks.map((b, bi) => (
              <Card key={bi} className="mb-1">
                <View className="flex-row items-baseline gap-1">
                  <Text className="text-5 font-bold text-text">{b.heading}</Text>
                  {b.superset ? <Text className="text-2 font-bold uppercase tracking-widest text-gold2">superset</Text> : null}
                </View>
                {b.exercises.map((e, ei) => (
                  <Text key={ei} className="mt-0.5 text-4 text-muted">
                    <Text className="font-bold text-text">{e.name || '(unnamed)'}</Text>{' '}
                    {e.varied ? e.varied.join('-') : `${e.sets} × ${e.range || e.secs || e.reps || '—'}`}
                    {e.secs ? 's' : ''}
                    {e.rpe ? ` @RPE ${e.rpe}` : ''}
                    {e.kg ? ` · ${e.kg}kg` : ''}
                    {e.eachSide ? ' · each side' : ''}
                  </Text>
                ))}
              </Card>
            ))
          ) : (
            <Empty title="Couldn't find any movements" body="Check the text above, or add them by hand in the Library." />
          )}

          {parsed.notes.length ? (
            <>
              <SectionHead title="Notes kept" />
              <Card>
                {parsed.notes.map((n, i) => (
                  <Text key={i} className="text-4 text-muted">
                    {n}
                  </Text>
                ))}
              </Card>
            </>
          ) : null}

          <Btn variant="brass" className="mt-3" onPress={save} disabled={!parsed.blocks.length}>
            Save to Library
          </Btn>
        </>
      )}

      <Learned lex={lex} onForget={(t, k) => update((d) => void (d.settings.lexicon = unlearn(lexiconOf(d.settings), t, k)))} />
    </Screen>
  );
}

function Issue({
  issue,
  onDismiss,
  onTeachWord,
  onTeachMove,
}: {
  issue: ImpIssue;
  onDismiss: () => void;
  onTeachWord: (w: string) => void;
  onTeachMove: (alias: string, name: string, mode: string) => void;
}) {
  if (issue.kind === 'typo') {
    return (
      <Card className="mb-1 border-gold-line">
        <Text className="text-4 text-text">
          Read “{issue.word}” as a rest of {issue.rest}s. Is that right?
        </Text>
        <View className="mt-1 flex-row gap-1">
          <Btn variant="brass" className="flex-1" onPress={() => { onTeachWord(issue.word); onDismiss(); }}>
            Yes — remember
          </Btn>
          <Btn className="flex-1" onPress={onDismiss}>
            Just once
          </Btn>
        </View>
      </Card>
    );
  }
  if (issue.kind === 'confirmName') {
    return (
      <Card className="mb-1 border-gold-line">
        <Text className="text-4 text-text">
          {issue.fuzzy ? 'Did you mean' : 'Not in the library:'} <Text className="font-bold text-gold2">{issue.name}</Text>
          {issue.fuzzy ? '?' : ''} <Text className="text-dim">(from “{issue.raw}”)</Text>
        </Text>
        <View className="mt-1 flex-row gap-1">
          <Btn variant="brass" className="flex-1" onPress={() => { onTeachMove(issue.raw, issue.name, issue.ref.mode); onDismiss(); }}>
            Yes — remember
          </Btn>
          <Btn className="flex-1" onPress={onDismiss}>
            Leave it
          </Btn>
        </View>
      </Card>
    );
  }
  return (
    <Card className="mb-1">
      <Text className="text-4 text-muted">
        {issue.kind === 'unreadable' ? `Couldn't read: “${issue.text}”` : `${issue.block} had a scheme but no movement.`}
      </Text>
      <Btn className="mt-1" onPress={onDismiss}>
        Got it
      </Btn>
    </Card>
  );
}

function Learned({ lex, onForget }: { lex: ReturnType<typeof lexiconOf>; onForget: (t: 'kw' | 'ex', k: string) => void }) {
  const ex = Object.keys(lex.ex);
  const kw = Object.keys(lex.kw);
  if (!ex.length && !kw.length) return null;
  return (
    <>
      <SectionHead title="What it has learned" />
      <Card>
        {ex.map((k) => (
          <View key={'e' + k} className="mt-0.5 flex-row items-center">
            <Text className="flex-1 text-4 text-muted">“{k}” → {lex.ex[k].name}</Text>
            <Text className="text-3 text-dim" onPress={() => onForget('ex', k)}>forget</Text>
          </View>
        ))}
        {kw.map((k) => (
          <View key={'k' + k} className="mt-0.5 flex-row items-center">
            <Text className="flex-1 text-4 text-muted">“{k}” → {lex.kw[k]}</Text>
            <Text className="text-3 text-dim" onPress={() => onForget('kw', k)}>forget</Text>
          </View>
        ))}
      </Card>
    </>
  );
}
