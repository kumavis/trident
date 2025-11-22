import {
  createForkableVm,
  createPreloadedVm,
  type ForkableVm,
  type QuickJsValue,
} from "../../src/index.ts";

export interface VmTestCase {
  name: string;
  run(): Promise<void>;
}

export const ensureNumber = (value: QuickJsValue, expected: number, context: string) => {
  if (typeof value !== "number") {
    throw new Error(`${context} expected number result`);
  }
  if (value !== expected) {
    throw new Error(`${context} expected ${expected}, received ${String(value)}`);
  }
};

export const ensureValue = (value: QuickJsValue, expected: QuickJsValue, context: string) => {
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error(`${context} expected ${JSON.stringify(expected)}, received ${JSON.stringify(value)}`);
  }
};

export const usingVm = async (
  factory: () => Promise<ForkableVm>,
  task: (vm: ForkableVm) => Promise<void> | void
) => {
  const vm = await factory();
  try {
    await task(vm);
  } finally {
    vm.dispose();
  }
};

export const vmBasicTestCases: VmTestCase[] = [
  {
    name: "evaluates arithmetic expressions",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const result = vm.eval("1 + 2");
        ensureNumber(result, 3, "eval");
      });
    },
  },
  {
    name: "maintains global state across eval calls",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        vm.eval("globalThis.counter = 41; 0;");
        const result = vm.eval("globalThis.counter + 1");
        ensureNumber(result, 42, "global state");
      });
    },
  },
  {
    name: "callFunction invokes exported global functions",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        vm.eval("globalThis.times = (a, b) => a * b; 0;");
        const value = vm.callFunction("times", 6, 7);
        ensureNumber(value, 42, "callFunction");
      });
    },
  },
  {
    name: "createPreloadedVm executes bootstrap code",
    async run() {
      await usingVm(() => createPreloadedVm("globalThis.answer = 42;"), (vm) => {
        const value = vm.eval("globalThis.answer");
        ensureValue(value, 42, "preloaded VM");
      });
    },
  },
];

