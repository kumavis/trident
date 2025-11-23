# Metering Implementation Details

## How It Works

### Interrupt Handler Mechanism

QuickJS has a built-in interrupt handler system that allows external code to interrupt execution. The interrupt handler is a callback function that QuickJS calls **periodically during bytecode execution**.

### When is the callback invoked?

The `shouldInterrupt` callback is invoked by QuickJS's VM during execution. Specifically:

1. **During loops**: QuickJS checks for interrupts at loop boundaries and within loop iterations
2. **During function calls**: Checks occur at function entry/exit points
3. **Periodically during execution**: QuickJS has internal heuristics for when to check

This means:
- The callback is NOT called on every single bytecode instruction (that would be too slow)
- It IS called frequently enough to catch infinite loops quickly
- The exact frequency depends on QuickJS's internal implementation

**Note on terminology:** We call these "cycles" rather than "opcodes" because we're counting interrupt handler invocations, not actual bytecode instructions executed.

### Our Implementation

```typescript
// Global callback that QuickJS calls periodically during execution
function globalShouldInterrupt(_unused: unknown, runtimePtr: number): boolean {
  const state = runtimeInterruptState.get(runtimePtr);
  if (!state) {
    return false;
  }
  state.counter++;
  return state.counter > state.limit;  // Return true to interrupt
}
```

**Key Points:**
- The callback signature has two parameters: `(_unused, runtimePtr)` 
  - First param is always undefined (artifact of the WASM callback convention)
  - Second param is the runtime pointer we use to track state
- When we return `true`, QuickJS throws an `InternalError` with message "interrupted"
- When we return `false`, execution continues normally

### Counter Reset

The cycle counter is reset at the start of each:
- `vm.eval(code)` call
- `vm.callFunction(name, ...args)` call

This ensures that multiple simple operations don't accumulate towards the limit. The `maxCycles` option on the VM specifies a **per-call** limit, not a cumulative lifetime limit.

```typescript
evalUtf8(source: string): QuickJsValue {
  // Reset interrupt counter before each eval
  if (this.maxCycles !== undefined) {
    const state = runtimeInterruptState.get(this.runtimePtr);
    if (state) {
      state.counter = 0;  // <-- Reset here
    }
  }
  return this.invokeWithString(source, (ptr, len) => {
    return this.module._qjs_eval_utf8(ptr, len);
  });
}
```

## Test Demonstration

### Synchronous Infinite Loops (BLOCKED)

```javascript
const vm = await createForkableVm({ maxCycles: 1000 });

// while loop - interrupted after ~1000 cycles
try {
  vm.eval("while (true) {}");
  console.log("This won't execute");
} catch (e) {
  console.log("Caught:", e.message); // "interrupted"
}

// for loop - also interrupted
try {
  vm.eval("for (;;) {}");
  console.log("This won't execute");
} catch (e) {
  console.log("Caught:", e.message); // "interrupted"
}
```

**What happens:**
1. QuickJS starts executing the loop bytecode
2. At the start of each loop iteration (or periodically within), QuickJS calls our `shouldInterrupt` callback
3. The callback increments the counter and checks if it exceeds the limit
4. After ~1000 calls, it returns `true`
5. QuickJS immediately throws an `InternalError` with message "interrupted"

### Simple Eval (ALLOWED)

```javascript
const vm = await createForkableVm({ maxCycles: 1000 });

// This simple operation uses far fewer than 1000 cycles
const result = vm.eval("1 + 2"); // Works fine, returns 3
```

## Performance Considerations

- **Overhead**: The interrupt handler adds minimal overhead because it's not called on every instruction
- **No transforms needed**: Unlike some metering approaches, this doesn't require transforming/rewriting your code
- **Native implementation**: Uses QuickJS's built-in interrupt mechanism, which is implemented in C

## Per-call Control

### Overriding Cycle Limits

You can override the VM's default `maxCycles` for individual operations:

```javascript
const vm = await createForkableVm({ maxCycles: 100 });

// This uses the default limit (100 cycles)
vm.eval("1 + 2");

// This overrides with a higher limit just for this call
vm.eval("for (let i = 0; i < 1000; i++) {}", { maxCycles: 10000 });

// Next eval goes back to using the default (100 cycles)
vm.eval("3 + 4");
```

This is useful when you know certain operations need more cycles but don't want to raise the limit for everything.

## Forking with Different Limits

By default, forked VMs inherit the parent's `maxCycles`, but you can override it:

```javascript
const parent = await createForkableVm({ maxCycles: 1000 });

parent.eval("globalThis.x = 42");

// Fork inherits parent's limit (1000)
const child1 = await parent.fork();

// Fork with higher limit
const child2 = await parent.fork({ maxCycles: 5000 });

// Fork with lower limit
const child3 = await parent.fork({ maxCycles: 100 });

// Each VM has independent cycle counters and limits
try {
  child1.eval("while (true) {}"); // Hits 1000 cycle limit
} catch (error) {
  console.log("Child1 interrupted at 1000 cycles");
}

try {
  child2.eval("while (true) {}"); // Hits 5000 cycle limit
} catch (error) {
  console.log("Child2 interrupted at 5000 cycles");
}
```

This allows you to:
- Give child VMs different resource limits
- Create trusted execution contexts with higher limits
- Create sandboxed contexts with lower limits for experimental code
- Test the same code with different metering configurations


### Tracking Cycle Usage

Use `evalWithMetrics()` to get both the result and the cycle count:

```javascript
const vm = await createForkableVm({ maxCycles: 10000 });

const { result, cycleCount } = vm.evalWithMetrics("1 + 2");
console.log(`Result: ${result}`);        // 3
console.log(`Cycles used: ${cycleCount}`); // e.g., 2

// Compare different operations
const simple = vm.evalWithMetrics("1 + 2");
const loop = vm.evalWithMetrics(`
  let sum = 0;
  for (let i = 0; i < 100; i++) {
    sum += i;
  }
  sum;
`);

console.log(`Simple: ${simple.cycleCount} cycles`);
console.log(`Loop: ${loop.cycleCount} cycles`);
// Loop will use significantly more cycles
```

This is useful for:
- Profiling and understanding performance characteristics
- Setting appropriate cycle limits based on actual usage
- Debugging why certain operations are hitting limits


## Limitations

- The cycle count is approximate - it depends on when QuickJS decides to call the interrupt handler
- The counter represents "number of interrupt checks" not "actual bytecode instructions executed"
- Very simple operations might never trigger the interrupt handler if they complete before the first check
- The term "cycles" refers to interrupt handler invocations, not CPU cycles or bytecode operations
- Cycle counts are deterministic for the same code and VM configuration, but represent interrupt frequency rather than exact instruction counts

