# VM Forking & Isolation

This document summarizes how Trident implements forkable QuickJS runtimes and the guarantees the system provides for isolation between parent and child VMs.

## Execution Model

1. **Runtime creation.** `createForkableVm` is a thin wrapper that builds a `QuickJsForkableVm` by calling `QuickJsWasmRuntime.create()`, which loads the QuickJS WebAssembly module and initializes a fresh runtime realm (`_qjs_init_runtime`). Each VM therefore starts with its own linear memory and global object graph.
2. **Host interaction surface.** `QuickJsForkableVm` exposes `eval`, `callFunction`, and a `globalThis` proxy. Every public method runs inside `withExclusiveAccess*`, which rejects re-entrant calls once the VM is disposed or already busy. This prevents concurrent mutations during a fork and keeps the runtime in a coherent state.
3. **Memory snapshots.** The runtime exposes `takeSnapshot()` and `restoreSnapshot()`. The snapshot is a byte-for-byte copy of the WebAssembly heap (`HEAPU8`). Restoring replaces the child heap contents and invokes `_qjs_post_restore` when the embedded runtime needs to rebuild internal pointers.

## Fork Lifecycle

When `fork()` is invoked on a live VM:

1. `withExclusiveAccessAsync` pauses other operations so the heap cannot change mid-copy.
2. The parent calls `runtime.takeSnapshot()` to capture its entire state, including JS heap, globals, and C-level bookkeeping.
3. A new `QuickJsWasmRuntime` is instantiated **without** running `_qjs_init_runtime` (passing `initializeRuntime: false`). This yields an uninitialized heap that will immediately be overwritten by the snapshot.
4. `restoreSnapshot` copies the bytes into the child heap and runs `_qjs_post_restore` if the compiled runtime exposes it.
5. A brand-new `QuickJsForkableVm` is returned to the caller. The child shares no references with the parent beyond the serialized snapshot, so subsequent mutations diverge cleanly.

Because the fork is just a memory copy, it completes in milliseconds and scales with WASM heap size rather than JS object graphs.

## Isolation Guarantees

Trident’s isolation story combines multiple layers:

- **Heap isolation.** Parent and child VMs own distinct WebAssembly memories after the fork. Mutations in one heap never touch the other because they write to different memory buffers. Tests such as `vmForkTestCases` assert that primitive fields, nested objects, and closure state diverge after forking.
- **Realm boundaries.** QuickJS creates a brand-new realm per VM. All primordials (`Array`, `Object`, etc.) differ from host primordials and from other VMs’ primordials. The `vmIdentityHostTestCases` and `vmIdentitySiblingTestCases` suites verify that constructors, functions, arrays, and objects never compare strictly equal across realms. This avoids prototype pollution and `instanceof` leaks.
- **Proxy-based value transport.** Values crossing the VM boundary are represented as QuickJS proxy objects/functions. Each retrieval produces a distinct proxy, so retaining one VM’s objects inside another VM or the host only affects that realm.
- **Single-operation guardrails.** The `busy` flag in `QuickJsForkableVm` ensures that no two operations – including `fork`, `eval`, or `callFunction` – run simultaneously. This prevents races where a snapshot could capture half-written state or concurrent host calls could mutate shared buffers mid-copy.
- **Deterministic disposal.** `dispose()` flips a flag checked by `throwIfUnavailable()`. Any operation after disposal fails fast, ensuring that a parent cannot accidentally keep mutating after you intentionally tear it down.

## Usage Patterns

- **Preload once, fork many.** `createPreloadedVm` runs bootstrap code a single time, then you can call `fork` on the prepared parent to spawn children that inherit warmed caches, module registries, or precomputed data.
- **State branching.** Use forks to branch deterministic simulations or isolate user code execution. Because each fork begins from a shared snapshot, you can run experiments in parallel and discard them without affecting the parent.
- **Global surface.** Prefer interacting through exported globals (`globalThis` or `callFunction`) rather than holding onto proxies indefinitely. This keeps the boundary explicit and avoids relying on object identity.

## Test Coverage

The fork and isolation behavior is covered by:

- `tests/shared/vm-fork.ts` – clones mutate independently, nested objects and closures survive snapshots, and multiple forks start from identical baselines.
- `tests/shared/vm-identity.ts` – ensures VM primordials never match host or sibling primordials and that QuickJS proxies remain realm-specific.
- `tests/shared/vm-basic.ts` – exercises `globalThis` proxies, property enumeration, `callFunction`, and JSON serialization across the host boundary.
- `tests/shared/runtime-snapshot.ts` – verifies that `takeSnapshot`/`restoreSnapshot` rewinds runtime state.

Together these suites guarantee that VM forks are fast, deterministic, and hermetically isolated.



