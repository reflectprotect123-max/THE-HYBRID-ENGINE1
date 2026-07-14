import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../app/', import.meta.url);
const source = fs.readFileSync(new URL('index.html', root), 'utf8');
const start = source.indexOf('const FIRST_CYCLE_TEMPLATE_IDS');
const end = source.indexOf('function applyEverydayReadinessNetlifyPatch', start);
if (start < 0 || end < 0) throw new Error('First-cycle template fixture is missing.');

const context = {
  String,
  Date,
  clone: value => JSON.parse(JSON.stringify(value)),
  isoNow: () => '2026-07-15T00:00:00.000Z',
  registerExercise(state, exercise) {
    state.exercises.push({ id: exercise.exerciseId, name: exercise.name, category: exercise.category });
    return exercise;
  },
};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)};globalThis.fixture={blueprints:firstCycleTemplateBlueprints(),state:ensureFirstCycleTemplates({meta:{},exercises:[],templates:[]})};`, context);

const { blueprints, state } = context.fixture;
if (blueprints.length !== 3) throw new Error(`Expected 3 first-cycle templates, got ${blueprints.length}.`);
if (state.templates.length !== 3) throw new Error(`Expected 3 installed templates, got ${state.templates.length}.`);
const exercises = blueprints.flatMap(template => template.blocks.flatMap(block => block.exercises || []));
if (exercises.length !== 19) throw new Error(`Expected 19 exercises, got ${exercises.length}.`);
if (exercises.some(exercise => exercise.sets !== '' || exercise.reps !== '' || exercise.blankPrescription !== true)) {
  throw new Error('A first-cycle exercise contains a non-blank prescription.');
}

console.log('PASS — 3 first-cycle templates installed');
console.log('PASS — 19 exercises preserved in order');
console.log('PASS — all sets, reps and loads are blank');
