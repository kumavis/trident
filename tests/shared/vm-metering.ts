import { createForkableVm } from "../../src/index.ts";
import { assertJsonEqual, assertType } from "./assert.ts";
import type { VmTestCase } from "./vm-basic.ts";
import { usingVm } from "./vm-basic.ts";

export const vmMeteringTestCases: VmTestCase[] = [
  {
    name: "metering prevents infinite while loop",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: 1000 }), (vm) => {
        let error: Error | null = null;
        try {
          // This should throw because it exceeds the cycle limit
          vm.eval("while (true) {}");
        } catch (e) {
          error = e as Error;
        }
        assertType(
          error,
          (e): e is Error => e instanceof Error,
          "infinite loop error",
          "expected error to be thrown"
        );
      });
    },
  },
  {
    name: "metering prevents infinite for loop",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: 1000 }), (vm) => {
        let error: Error | null = null;
        try {
          // This should throw because it exceeds the cycle limit
          vm.eval("for (;;) {}");
        } catch (e) {
          error = e as Error;
        }
        assertType(
          error,
          (e): e is Error => e instanceof Error,
          "infinite for loop error",
          "expected error to be thrown"
        );
      });
    },
  },
  {
    name: "metering allows simple eval",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: 1000 }), (vm) => {
        // This should succeed because it's within the cycle limit
        const result = vm.eval("1 + 2");
        assertJsonEqual(result, 3, "simple eval with metering");
      });
    },
  },
  {
    name: "metering allows multiple simple evals",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: 1000 }), (vm) => {
        // Each eval should reset the counter
        const result1 = vm.eval("1 + 2");
        assertJsonEqual(result1, 3, "first eval");
        
        const result2 = vm.eval("3 + 4");
        assertJsonEqual(result2, 7, "second eval");
        
        const result3 = vm.eval("5 + 6");
        assertJsonEqual(result3, 11, "third eval");
      });
    },
  },
  {
    name: "VM without metering allows large loops",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        // Without metering, we can run a large loop
        const result = vm.eval(`
          let sum = 0;
          for (let i = 0; i < 10000; i++) {
            sum += i;
          }
          sum;
        `);
        assertJsonEqual(result, 49995000, "large loop without metering");
      });
    },
  },
  {
    name: "metering works in forked VM",
    async run() {
      const parent = await createForkableVm({ maxCycles: 1000 });
      try {
        // Parent has metering
        let parentError: Error | null = null;
        try {
          parent.eval("while (true) {}");
        } catch (e) {
          parentError = e as Error;
        }
        assertType(
          parentError,
          (e): e is Error => e instanceof Error,
          "parent metering error",
          "expected error"
        );

        // Fork inherits metering
        const child = await parent.fork();
        try {
          let childError: Error | null = null;
          try {
            child.eval("while (true) {}");
          } catch (e) {
            childError = e as Error;
          }
          assertType(
            childError,
            (e): e is Error => e instanceof Error,
            "child metering error",
            "expected error"
          );
        } finally {
          child.dispose();
        }
      } finally {
        parent.dispose();
      }
    },
  },
  {
    name: "closure state preserved after metering error",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: 100 }), (vm) => {
        // Set up a counter in closure
        vm.eval(`
          globalThis.counter = 0;
          globalThis.incrementUntilLimit = () => {
            while (true) {
              globalThis.counter++;
            }
          };
        `);

        // Try to run infinite loop - will hit metering limit
        let error: Error | null = null;
        try {
          vm.callFunction("incrementUntilLimit");
        } catch (e) {
          error = e as Error;
        }

        assertType(
          error,
          (e): e is Error => e instanceof Error,
          "metering error",
          "expected error"
        );

        // Counter should have been incremented before the limit was hit
        const counterValue = vm.eval("globalThis.counter") as number;
        assertType(
          counterValue > 0,
          (v): v is true => v === true,
          "counter incremented",
          `expected counter > 0, got ${counterValue}`
        );
      });
    },
  },
  {
    name: "fork inherits parent maxCycles by default",
    async run() {
      const parent = await createForkableVm({ maxCycles: 100 });
      try {
        const child = await parent.fork();
        try {
          // Child should have same limit as parent
          let error: Error | null = null;
          try {
            child.eval("while (true) {}");
          } catch (e) {
            error = e as Error;
          }
          assertType(
            error,
            (e): e is Error => e instanceof Error,
            "child metering error",
            "expected error"
          );
        } finally {
          child.dispose();
        }
      } finally {
        parent.dispose();
      }
    },
  },
  {
    name: "fork can override maxCycles",
    async run() {
      const parent = await createForkableVm({ maxCycles: 100 });
      try {
        // Fork with higher limit
        const childWithHigher = await parent.fork({ maxCycles: 10000 });
        try {
          // Should succeed with higher limit
          const result = childWithHigher.eval("for (let i = 0; i < 1000; i++) {}");
          assertJsonEqual(result, undefined, "higher limit succeeded");
        } finally {
          childWithHigher.dispose();
        }

        // Fork with lower limit
        const childWithLower = await parent.fork({ maxCycles: 10 });
        try {
          // Should fail with lower limit - use infinite loop to ensure it hits limit
          let error: Error | null = null;
          try {
            childWithLower.eval("while (true) {}");
          } catch (e) {
            error = e as Error;
          }
          assertType(
            error,
            (e): e is Error => e instanceof Error,
            "lower limit error",
            "expected error"
          );
        } finally {
          childWithLower.dispose();
        }
      } finally {
        parent.dispose();
      }
    },
  },
  {
    name: "metering enforced when calling function by name",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: 100 }), (vm) => {
        vm.eval(`
          globalThis.infiniteLoop = () => {
            while (true) {}
          };
        `);

        let error: Error | null = null;
        try {
          vm.callFunction("infiniteLoop");
        } catch (e) {
          error = e as Error;
        }
        assertType(
          error,
          (e): e is Error => e instanceof Error,
          "callFunction metering error",
          "expected error"
        );
      });
    },
  },
  {
    name: "metering enforced when calling function from eval result",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: 100 }), (vm) => {
        const fn = vm.eval(`
          (() => {
            while (true) {}
          })
        `) as () => void;

        let error: Error | null = null;
        try {
          fn();
        } catch (e) {
          error = e as Error;
        }
        assertType(
          error,
          (e): e is Error => e instanceof Error,
          "eval result function metering error",
          "expected error"
        );
      });
    },
  },
  {
    name: "per-call maxCycles override does not change VM default",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: 100 }), (vm) => {
        // First, use per-call override with a high limit - should succeed
        const result1 = vm.eval("for (let i = 0; i < 1000; i++) {}", { maxCycles: 10000 });
        assertJsonEqual(result1, undefined, "high limit eval succeeded");

        // Now eval without options - should use VM's default (100) and fail on infinite loop
        let error: Error | null = null;
        try {
          vm.eval("while (true) {}");
        } catch (e) {
          error = e as Error;
        }
        assertType(
          error,
          (e): e is Error => e instanceof Error,
          "default limit error",
          "expected VM to use default limit (100), not the override (10000)"
        );

        // Verify we can still use overrides again
        const result2 = vm.eval("for (let i = 0; i < 1000; i++) {}", { maxCycles: 10000 });
        assertJsonEqual(result2, undefined, "second high limit eval succeeded");
      });
    },
  },
];

