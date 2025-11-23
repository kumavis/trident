# Trident

Status: Experiment, not fit for production.

Forkable QuickJS WebAssembly runtime that works the same in Node and modern browsers. Trident exposes a tiny API for evaluating code, exporting functions, and snapshotting VM state so you can clone execution contexts in milliseconds.

## Features
- `createForkableVm()` for evaluating scripts, calling exported globals, and disposing deterministically.
- `fork()` snapshots the parent VM’s memory so children inherit identical state but diverge independently.
- `createPreloadedVm()` runs bootstrap code exactly once before you start issuing calls.

## Usage

### Evaluate scripts
```ts
import { createForkableVm } from "trident";

const vm = await createForkableVm();
try {
  const value = vm.eval("40 + 2");
  console.log(value); // 42
} finally {
  vm.dispose();
}
```

### Fork VM state
You can fork a live VM!
```ts
import { createPreloadedVm } from "trident";

// createForkableVm + eval helper
const vmA = await createForkableVm();
vmA.eval(`
  globalThis.counter = 0;
  globalThis.increment = () => ++globalThis.counter;
`)

vmA.globalThis.increment(); // 1 (A)

const vmB = await vmA.fork(); // FORK! state is cloned into new vm! <----

vmB.globalThis.counter // 1 (B, starts from fork point)
vmB.globalThis.increment();  // 2 (B)
vmB.globalThis.increment();  // 3 (B)
vmB.globalThis.counter // 3 (B)

vmA.globalThis.counter // 1 (A, not affected by B)
vmA.globalThis.increment() // 2 (A)
vmB.globalThis.counter // 3 (B, not affected by A)

vmA.dispose();
vmB.dispose();
```
This also works for closure state:
```ts
const vmA = await createForkableVm();
vmA.eval(`
  globalThis.increment = (() => {
    let counter = 0;
    return () => ++counter;
  })()
`)
vmA.increment() // 1 (A)
const vmB = await vmA.fork()
vmA.increment() // 2 (A)
vmA.increment() // 3 (A)
vmB.increment() // 2 (B)
```


### Access `globalThis` directly
```ts
const vm = await createForkableVm();
vm.globalThis.answer = 42;
vm.eval("globalThis.message = `answer: ${globalThis.answer}`");
console.log(vm.globalThis.message); // "answer: 42"
vm.dispose();
```

### Call exported globals
```ts
const vm = await createForkableVm();
vm.eval("globalThis.times = (a, b) => a * b; 0;");
const result = vm.callFunction("times", 6, 7); // 42
vm.dispose();
```

### Preload & fork VM state
```ts
import { createPreloadedVm } from "trident";

// createForkableVm + eval helper
const parent = await createPreloadedVm(`
  globalThis.counter = 0;
  globalThis.increment = () => ++globalThis.counter;
`);

vmA.globalThis.increment(); // 1 (A)
const vmB = await vmA.fork(); // FORK! state is cloned into new vm!

vmB.globalThis.counter // 1 (B, starts from fork point)
vmB.globalThis.increment();  // 2 (B)
vmB.globalThis.increment();  // 3 (B)
vmB.globalThis.counter // 3 (B)

vmA.globalThis.counter // 1 (A, not affected by B)
vmA.globalThis.increment() // 2 (A)
vmB.globalThis.counter // 3 (B, not affected by A)

vmA.dispose();
vmB.dispose();
```

## Identity Discontinuity

VMs are each a new *Realm*, so they exhibit *Identity Discontinuity* with the host Realm and eachother.
That is to say `globalThis.Array !== vmA.globalThis.Array` and `vmA.globalThis.Array !== vmB.globalThis.Array`.
This can lead to confusion, for example when using `instanceof`:
```ts
const array = vmA.eval("[]");
array instanceof Array; // false (host)
array instanceof vmA.globalThis.Array; // true (A)
array instanceof vmB.globalThis.Array; // false (B)
```


## Development

### Scripts
- `npm run build` – bundle `src/` to `dist/` via tsup.
- `npm test` – run the Node and browser conformance suites (uses `--experimental-strip-types`, so Node 22+ is required).
- `npm run test:browser` / `npm run test:node` – run individual suites while iterating.
