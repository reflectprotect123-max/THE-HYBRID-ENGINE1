/*
 * `CameraView`, as far as node can go.
 *
 * A preview surface plus a shutter. It lives in its own plain-JS file rather
 * than inline in `setup.ts` for two reasons, both hard constraints:
 *
 *  - a `jest.mock` factory may not reference an out-of-scope variable, and any
 *    JSX (or a bare `React.createElement`) inside `setup.ts` is rewritten by
 *    NativeWind's babel plugin into a call on a module-level import — exactly
 *    such a reference. `require`-ing this file from the factory is a local
 *    binding and is allowed;
 *  - `takePictureAsync` is a method on the REF, and a host `View` ref does not
 *    have one. The screen holds a real ref and calls a real method through it,
 *    which is the wiring worth proving.
 *
 * This decides nothing the app decides. The shutter returns a photo or throws,
 * and everything downstream — what is recognised, what is parsed, what is shown
 * and what is refused — is the app's own code running unmocked.
 */
const React = require('react');
const { View } = require('react-native');

/** A JPEG the way `expo-camera` reports one, at a plausible phone resolution. */
const PHOTO = { uri: 'file:///cache/label-panel.jpg', width: 3024, height: 4032, format: 'jpg' };

let shutter = async () => PHOTO;

const CameraViewMock = React.forwardRef(function CameraViewMock(props, ref) {
  React.useImperativeHandle(ref, () => ({
    takePictureAsync: (options) => shutter(options),
  }));
  /* The props go straight onto the host view, so `accessibilityLabel` still
     finds it and a test can read any prop the screen passed. */
  return React.createElement(View, props);
});

module.exports = {
  CameraViewMock,
  PHOTO,
  /** Test-only. Drive the shutter: a different photo, or a throw. */
  __setShutter: (fn) => {
    shutter = fn;
  },
  __resetShutter: () => {
    shutter = async () => PHOTO;
  },
};
