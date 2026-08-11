// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestProvider, useRest } from './rest';

/*
 * Rest-timer completion fires both a vibrate and a Notification (when
 * permission is already granted) — see task 1.4 of the PWA parity plan.
 * This suite exercises the real completion path (start a short rest, let
 * it elapse) rather than reaching into an internal function, since the
 * completion logic lives inside the provider's effect, not as an export.
 */

function setup() {
  return renderHook(() => useRest(), { wrapper: RestProvider });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('rest timer completion notification', () => {
  it('fires a Notification when permission is already granted', () => {
    const NotificationMock = vi.fn();
    // @ts-expect-error test override
    NotificationMock.permission = 'granted';
    // @ts-expect-error test override
    global.Notification = NotificationMock;

    const { result } = setup();

    act(() => {
      result.current.start(1);
    });
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(NotificationMock).toHaveBeenCalledWith(
      'Rest complete',
      expect.objectContaining({ body: expect.any(String) }),
    );
  });

  it('does not fire a Notification when permission is not granted', () => {
    const NotificationMock = vi.fn();
    // @ts-expect-error test override
    NotificationMock.permission = 'denied';
    // @ts-expect-error test override
    global.Notification = NotificationMock;

    const { result } = setup();

    act(() => {
      result.current.start(1);
    });
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(NotificationMock).not.toHaveBeenCalled();
  });

  it('does not throw when Notification is unsupported', () => {
    // @ts-expect-error test override
    delete global.Notification;

    const { result } = setup();

    expect(() => {
      act(() => {
        result.current.start(1);
      });
      act(() => {
        vi.advanceTimersByTime(1100);
      });
    }).not.toThrow();
  });
});
