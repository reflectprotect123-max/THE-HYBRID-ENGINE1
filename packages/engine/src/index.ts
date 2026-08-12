/*
 * @hybrid/engine — every piece of training logic THE Hybrid System owns.
 *
 * Pure TypeScript: no DOM, no globals, no storage access. Anything that needs
 * the outside world takes it as an argument (`HrContext`) or through a port
 * (`Storage`). That is what lets the same maths run in the browser, in React
 * Native, and in a Vitest process asserting against vectors captured from the
 * original vanilla app.
 */

export * from './types';
export * from './constants';
export * from './num';
export * from './autoreg';
export * from './fold';
export * from './plates';
export * from './hr';
export * from './geo';
export * from './conditioning';
export * from './concept2';
export * from './session';
export * from './catalogue';
export * from './month';
export * from './setColumns';
export * from './lift';
export * from './balance';
export * from './insights';
export * from './logger';
export * from './db';
export * from './folders';
export * from './cloud';
export * from './ecosystem';
export * from './adaptive/types';
export * from './adaptive/explain';
export * from './adaptive/strength';
export * from './storage';
export * as emit from './emit';
