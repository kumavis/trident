import { createForkableVm } from "../../src/index.ts";
import { assertJsonEqual, assertType } from "./assert.ts";
import type { VmTestCase } from "./vm-basic.ts";
import { usingVm } from "./vm-basic.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export const vmCycleCountTestCases: VmTestCase[] = [
  {
    name: "cycle count for simple arithmetic",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: Infinity }), (vm) => {
        const { result, cycleCount } = vm.evalWithMetrics("1 + 2");
        assertJsonEqual(result, 3, "arithmetic result");
        assertJsonEqual(cycleCount, 1, "exact cycle count for arithmetic");
      });
    },
  },
  {
    name: "cycle count for variable assignment",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: Infinity }), (vm) => {
        const { result, cycleCount } = vm.evalWithMetrics("let x = 42; x");
        assertJsonEqual(result, 42, "assignment result");
        assertJsonEqual(cycleCount, 1, "exact cycle count for assignment");
      });
    },
  },
  {
    name: "cycle count for small loop (10 iterations)",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: Infinity }), (vm) => {
        const { result, cycleCount } = vm.evalWithMetrics(`
          let sum = 0;
          for (let i = 0; i < 10; i++) {
            sum += i;
          }
          sum;
        `);
        assertJsonEqual(result, 45, "loop result");
        assertJsonEqual(cycleCount, 1, "exact cycle count for small loop");
      });
    },
  },
  {
    name: "cycle count for medium loop (100 iterations)",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: Infinity }), (vm) => {
        const { result, cycleCount } = vm.evalWithMetrics(`
          let sum = 0;
          for (let i = 0; i < 100; i++) {
            sum += i;
          }
          sum;
        `);
        assertJsonEqual(result, 4950, "loop result");
        assertJsonEqual(cycleCount, 1, "exact cycle count for medium loop");
      });
    },
  },
  {
    name: "cycle count for large loop (10000 iterations)",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: Infinity }), (vm) => {
        const { result, cycleCount } = vm.evalWithMetrics(`
          let sum = 0;
          for (let i = 0; i < 10000; i++) {
            sum += i;
          }
          sum;
        `);
        assertJsonEqual(result, 49995000, "loop result");
        assertJsonEqual(cycleCount, 3, "exact cycle count for large loop");
      });
    },
  },
  {
    name: "per-call maxCycles override",
    async run() {
      await usingVm(() => createForkableVm({ maxCycles: 50 }), (vm) => {
        // Should succeed with override - large enough to trigger interrupt checks
        const result = vm.eval("for (let i = 0; i < 10000; i++) {}", { maxCycles: 10000 });
        assertJsonEqual(result, undefined, "loop with override");

        // Should fail without override (uses VM default of 50) - use infinite loop to ensure it hits limit
        let error: Error | null = null;
        try {
          vm.eval("while (true) {}");
        } catch (e) {
          error = e as Error;
        }
        assertType(
          error,
          (e): e is Error => e instanceof Error,
          "error",
          "expected error"
        );
      });
    },
  },
];

