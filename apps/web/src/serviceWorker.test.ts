// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  activateWaiting,
  onWaitingWorker,
  resetServiceWorkerForTests,
  startServiceWorker,
} from './serviceWorker';

/*
 * THE REGRESSION. Registration used to live inside `UpdateBanner`, which is
 * mounted inside `Shell` — the athlete chrome — so the coach workspace, the
 * logger, the planner and the guided builder ran with no service worker. An
 * installable PWA needs a worker with a fetch handler, so `/coach` could not
 * be installed as an app at all.
 *
 * The last test in this file is the one that actually guards it, and it is a
 * source assertion on purpose: the property is "registration happens ABOVE the
 * route fork", which is a fact about where the call sits, not about anything a
 * rendered component exposes.
 */

function fakeRegistration(over: Partial<ServiceWorkerRegistration> = {}) {
  return { waiting: null, installing: null, addEventListener: vi.fn(), ...over } as unknown as ServiceWorkerRegistration;
}

function install(register: () => Promise<ServiceWorkerRegistration>, controller: unknown = {}) {
  const listeners: Record<string, (() => void)[]> = {};
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register,
      controller,
      addEventListener: (type: string, fn: () => void) => {
        (listeners[type] ??= []).push(fn);
      },
    },
  });
  return listeners;
}

describe('startServiceWorker', () => {
  beforeEach(() => resetServiceWorkerForTests());
  afterEach(() => {
    // @ts-expect-error removing the stub we installed
    delete navigator.serviceWorker;
  });

  it('registers the worker', async () => {
    const register = vi.fn().mockResolvedValue(fakeRegistration());
    install(register);
    startServiceWorker();
    await Promise.resolve();
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('registers ONCE however many times it is called', async () => {
    // Two registrations of the same script race for one scope, and the winner
    // is whichever attached its listeners first.
    const register = vi.fn().mockResolvedValue(fakeRegistration());
    install(register);
    startServiceWorker();
    startServiceWorker();
    startServiceWorker();
    await Promise.resolve();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('does not throw where service workers do not exist', () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    // A browser without them, or a private window that refuses, must not take
    // the app down — offline support is lost, not the session.
    expect(() => startServiceWorker()).not.toThrow();
  });

  it('does not throw when registration itself fails', async () => {
    const register = vi.fn().mockRejectedValue(new Error('nope'));
    install(register);
    expect(() => startServiceWorker()).not.toThrow();
    await Promise.resolve();
  });

  it('tells subscribers about a worker that was already waiting from a previous visit', async () => {
    const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
    install(vi.fn().mockResolvedValue(fakeRegistration({ waiting: worker })));
    startServiceWorker();
    await Promise.resolve();

    const seen = vi.fn();
    onWaitingWorker(seen);
    // Subscribed AFTER the fact — the banner mounts deep in the tree while
    // registration happens at the root, so this ordering is the normal case.
    expect(seen).toHaveBeenCalledWith(worker);
  });

  it('stops telling a subscriber once it unsubscribes', async () => {
    const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
    install(vi.fn().mockResolvedValue(fakeRegistration({ waiting: worker })));
    const seen = vi.fn();
    const off = onWaitingWorker(seen);
    off();
    startServiceWorker();
    await Promise.resolve();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('activateWaiting', () => {
  beforeEach(() => resetServiceWorkerForTests());

  it('asks the waiting worker to take over', () => {
    const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
    activateWaiting(worker);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});

describe('where registration is called from', () => {
  it('is App, at module scope, above every route', () => {
    // The regression this guards: registration used to live inside
    // `UpdateBanner`, a component rendered by the athlete Shell, which left the
    // coach bench with no worker and therefore uninstallable.
    //
    // The second half of this assertion — that `UpdateBanner.tsx` does not
    // itself register — is GONE because the file is: the athlete surface was
    // deleted on 15 August 2026 and the banner went with it. Reading a deleted
    // file here would throw ENOENT and fail the suite for the wrong reason,
    // which is the crash-instead-of-fail shape this repository keeps hitting.
    // What survives is the half that is still checkable and still the point:
    // registration happens in App, at module scope.
    const app = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8');
    expect(app).toMatch(/^startServiceWorker\(\);$/m);
  });
});
