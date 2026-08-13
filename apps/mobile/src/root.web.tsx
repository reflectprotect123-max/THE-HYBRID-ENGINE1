import { Harness } from '../parity/Harness';

/*
 * The web root is the parity harness, and ONLY the harness.
 *
 * The app itself cannot be exported to web: it depends on
 * react-native-ble-plx, expo-mlkit-ocr, react-native-maps and
 * expo-notifications' native paths, none of which have a web
 * implementation. Nothing here imports `./App`, so none of them enter this
 * graph.
 *
 * See `parity/README.md` for what the harness proves and what it does not.
 */
export const Root = Harness;
