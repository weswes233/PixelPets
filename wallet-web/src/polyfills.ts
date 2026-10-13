// Browser bundle only: the shared chain client uses Node's Buffer API. Imported first by bridge.ts.
import { Buffer } from 'buffer';
const scope = globalThis as unknown as { Buffer?: typeof Buffer };
if (!scope.Buffer) scope.Buffer = Buffer;
