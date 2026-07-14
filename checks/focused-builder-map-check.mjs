import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app/focused-ui.js', import.meta.url), 'utf8');
const moveStart = source.indexOf('function fBuilderMove');
const supersetStart = source.indexOf('function fBuilderSuperset');
const end = source.indexOf('function fLoggerTaskItems', supersetStart);
if (moveStart < 0 || supersetStart < 0 || end < 0) throw new Error('Focused Builder map functions are missing.');

const state = {
  blocks: [
    { id: 'strength-a', type: 'strength', heading: 'Strength A', exercises: [{ id: 'a1', name: 'A1' }] },
    { id: 'warm-up', type: 'text', heading: 'Warm-up', notes: '' },
    { id: 'strength-b', type: 'strength', heading: 'Strength B', exercises: [{ id: 'b1', name: 'B1' }] },
    { id: 'cool-down', type: 'text', heading: 'Cool-down', notes: '' },
    { id: 'notes', type: 'text', heading: 'Notes', notes: '' },
  ],
};
const items = () => state.blocks.flatMap((block, blockIndex) => {
  if (block.type === 'text' || block.type === 'conditioning') return [{ kind: block.type, block, blockIndex, exerciseIndex: -1 }];
  return block.exercises.length
    ? block.exercises.map((exercise, exerciseIndex) => ({ kind: 'strength', block, blockIndex, exercise, exerciseIndex }))
    : [{ kind: 'strength-empty', block, blockIndex, exerciseIndex: -1 }];
});
const context = {
  String,
  Date,
  id: () => 'merged-superset',
  fBuilderItems: items,
  fDraft: () => state,
  fPersistDraft: () => {},
  fCloseSheet: () => {},
  focusedBuilder: () => {},
  confirm: () => true,
  alert: () => {},
};
vm.createContext(context);
vm.runInContext(`${source.slice(moveStart, end)};globalThis.testFns={move:fBuilderMove,superset:fBuilderSuperset};`, context);

const { move, superset } = context.testFns;
move(items().findIndex(item => item.block.id === 'warm-up'), -1);
if (state.blocks[0].id !== 'warm-up') throw new Error('Warm-up did not move to the top.');
move(items().findIndex(item => item.block.id === 'cool-down'), 1);
if (state.blocks.at(-1).id !== 'cool-down') throw new Error('Cool-down did not move to the bottom.');
move(items().findIndex(item => item.block.id === 'notes'), -1);
if (state.blocks.at(-3).id !== 'notes') throw new Error('Instruction block did not move between blocks.');

state.blocks = [
  { id: 'superset-a', type: 'strength', heading: 'A', exercises: [{ id: 'a', name: 'A' }] },
  { id: 'superset-b', type: 'strength', heading: 'B', exercises: [{ id: 'b', name: 'B' }] },
];
superset(0);
if (state.blocks.length !== 1 || !state.blocks[0].superset || state.blocks[0].exercises.length !== 2) {
  throw new Error('Adjacent strength blocks did not merge into a superset.');
}

console.log('PASS — map moves Warm-up, Cool-down and instruction blocks');
console.log('PASS — map plus merges adjacent strength blocks into a superset');
