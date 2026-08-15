import { useCallback, useEffect, useState } from 'react';

/*
 * "Desktop view" for the coach bench on a phone.
 *
 * `/coach` is composed at 1440px and phone width is a supported second
 * viewport, not a replacement — the phone layout necessarily drops things a
 * wide layout can hold side by side. So a coach standing in a gym with a
 * phone sometimes wants the whole dashboard rather than the compromise, and
 * this is the switch for that: the same thing a browser's "Request desktop
 * site" does, except remembered, and scoped to this bench rather than to the
 * whole app.
 *
 * HOW it works, because it is not obvious: the layout is driven by CSS media
 * queries, which read the VIEWPORT, not any container. Nothing inside the
 * page can talk them out of it. The one lever that can is the viewport meta
 * tag — rewriting `width=device-width` to a fixed `width=1440` makes the
 * browser lay out as if the screen were 1440px and then scale it down, which
 * is exactly the desktop layout, pannable.
 *
 * Consequences worth being explicit about:
 *
 *  - It is a WHOLE-DOCUMENT switch. There is no way to apply it to one
 *    subtree, so this hook restores the original content on unmount and the
 *    frame only mounts it under `/coach`. Leaving 1440px set while the
 *    athlete app renders would break every athlete screen.
 *  - `maximum-scale=1` has to go with it. The original tag pins zoom, which
 *    would leave a coach staring at a 1440px layout with no way to zoom into
 *    it — worse than not offering the switch at all.
 *  - On a desktop browser the viewport meta is IGNORED entirely, so this
 *    does nothing there. The frame hides the control rather than showing one
 *    that silently fails.
 */

const KEY = 'hybrid-coach-desktop-view';
const DESKTOP = 'width=1440, initial-scale=0.28, viewport-fit=cover';

function metaTag(): HTMLMetaElement | null {
  return document.querySelector('meta[name="viewport"]');
}

/** Whether the viewport meta can do anything here at all. A desktop browser
 *  ignores it, so offering the switch there would be offering a dead
 *  control. `pointer: coarse` is the honest test — it asks about the input
 *  device rather than guessing from a width the user may have resized. */
export function useViewportMetaApplies(): boolean {
  const [applies, setApplies] = useState(false);
  useEffect(() => {
    setApplies(window.matchMedia?.('(pointer: coarse)').matches ?? false);
  }, []);
  return applies;
}

export function useDesktopView(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const tag = metaTag();
    if (!tag) return;
    const original = tag.getAttribute('content') ?? '';
    if (on) tag.setAttribute('content', DESKTOP);
    /* Restore on unmount — the frame is only mounted under `/coach`, and a
       1440px viewport left set behind would follow the user into the athlete
       app and break every screen there. */
    return () => { tag.setAttribute('content', original); };
  }, [on]);

  const toggle = useCallback(() => {
    setOn((current) => {
      const next = !current;
      try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* still works for this session */ }
      return next;
    });
  }, []);

  return { on, toggle };
}
