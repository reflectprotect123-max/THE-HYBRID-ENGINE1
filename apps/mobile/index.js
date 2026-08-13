import { registerRootComponent } from 'expo';
import { Root } from './src/root';

// Extensionless on purpose — Metro resolves `./src/root` to `root.web.tsx` for
// the parity harness and `root.tsx` for android/ios. See `src/root.tsx`.
registerRootComponent(Root);
