import {
  createForkableVm,
  createPreloadedVm,
  type ForkableVm,
  type QuickJsValue,
} from "../../src/index.ts";
import { assertJsonEqual, assertNumber, assertType } from "./assert.ts";

export interface VmTestCase {
  name: string;
  run(): Promise<void>;
}

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

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const vmBasicTestCases: VmTestCase[] = [
  {
    name: "evaluates arithmetic expressions",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const result = vm.eval("1 + 2");
        assertNumber(result, 3, "eval");
      });
    }
  },
  {
    name: "globalThis proxy reflects VM global object",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const vmGlobalThis = vm.globalThis as { counter?: number; greeting?: string };
        assertType(
          vmGlobalThis,
          isObjectLike,
          "globalThis proxy",
          "expected QuickJS proxy object"
        );
        vmGlobalThis.counter = 41;
        const counterValue = vm.eval("globalThis.counter");
        assertNumber(counterValue, 41, "globalThis host writes");

        vm.eval("globalThis.greeting = 'hi'; 0;");
        const greetingValue = vmGlobalThis.greeting;
        assertJsonEqual(greetingValue, "hi", "globalThis host reads");
      });
    }
  },
  {
    name: "globalThis assignment works without trailing expression",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const globals = vm.globalThis as { answer?: number; message?: string };
        assertType(globals, isObjectLike, "globalThis proxy", "expected QuickJS proxy object");
        globals.answer = 42;
        vm.eval("globalThis.message = `answer: ${globalThis.answer}`");
        assertJsonEqual(globals.message, "answer: 42", "globalThis assignment");
      });
    },
  },
  {
    name: "maintains global state across eval calls",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        vm.eval("globalThis.counter = 41; 0;");
        const result = vm.eval("globalThis.counter + 1");
        assertNumber(result, 42, "global state");
      });
    },
  },
  {
    name: "evaluates methods defined on objects",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const result = vm.eval(`
          const math = {
            add(a, b) {
              return a + b;
            },
          };
          math.add(40, 2);
        `);
        assertNumber(result, 42, "object method");
      });
    },
  },
  {
    name: "returns QuickJS object proxies with callable methods",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const math = vm.eval(`
          ({
            base: 40,
            add(a) {
              return this.base + a;
            },
          })
        `) as { add: (value: number) => number; base: number };
        assertType(math, isObjectLike, "math proxy", "expected QuickJS object proxy");
        const value = math.add(2);
        assertNumber(value, 42, "proxy method invocation");
      });
    },
  },
  {
    name: "callFunction invokes exported global functions",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        vm.eval("globalThis.times = (a, b) => a * b; 0;");
        const value = vm.callFunction("times", 6, 7);
        assertNumber(value, 42, "callFunction");
      });
    },
  },
  {
    name: "createPreloadedVm executes bootstrap code",
    async run() {
      await usingVm(() => createPreloadedVm("globalThis.answer = 42;"), (vm) => {
        const value = vm.eval("globalThis.answer");
        assertJsonEqual(value, 42, "preloaded VM");
      });
    },
  },
  {
    name: "QuickJS proxies enumerate properties via Object.keys",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const proxy = vm.eval("({ answer: 42, double: (n) => n * 2 })") as {
          answer?: number;
          double?: (value: number) => number;
        };
        assertType(proxy, isObjectLike, "QuickJS proxy", "expected QuickJS proxy object");
        assertNumber(proxy.answer ?? 0, 42, "proxy direct property access");
        const keys = Object.keys(proxy);
        assertJsonEqual(keys, ["answer", "double"], "Object.keys result");
      });
    },
  },
  {
    name: "JSON.stringify preserves QuickJS proxy properties",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const proxy = vm.eval("({ answer: 42 })");
        assertType(proxy, isObjectLike, "JSON proxy", "expected QuickJS proxy object");
        const serialized = JSON.stringify(proxy);
        assertJsonEqual(serialized, '{"answer":42}', "JSON serialization result");
      });
    },
  },
  {
    name: "QuickJS arrays implement host iteration",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const proxy = vm.eval("[1, 2, 3]");
        assertType(proxy, isObjectLike, "iterable proxy", "expected QuickJS proxy object");
        const iterableProxy = proxy as unknown as number[];
        const spreadValues = [...iterableProxy];
        assertJsonEqual(spreadValues, [1, 2, 3], "spread operator collects values");

        const collected: number[] = [];
        for (const value of iterableProxy) {
          collected.push(value);
        }
        assertJsonEqual(collected, [1, 2, 3], "for...of collects values");
      });
    },
  },
  {
    name: "callFunction works even after switching between VM instances",
    async run() {
      const firstVm = await createForkableVm();
      const secondVm = await createForkableVm();
      try {
        firstVm.eval(`
          globalThis.bump = (() => {
            let counter = 0;
            return () => {
              counter += 1;
              return counter;
            };
          })();
          0;
        `);
        secondVm.eval(`
          globalThis.bump = (() => {
            let counter = 100;
            return () => {
              counter += 1;
              return counter;
            };
          })();
          0;
        `);

        assertNumber(firstVm.callFunction("bump"), 1, "first VM initial call");
        assertNumber(secondVm.callFunction("bump"), 101, "second VM initial call");
        const valueAfterSwitch = firstVm.callFunction("bump");
        assertNumber(valueAfterSwitch, 2, "first VM after using second VM");
        assertNumber(secondVm.callFunction("bump"), 102, "second VM after switching back");
      } finally {
        firstVm.dispose();
        secondVm.dispose();
      }
    },
  },
];
