import { createForkableVm } from "../../src/index.ts";
import { assertJsonEqual, assertNumber, assertType } from "./assert.ts";
import { usingVm, type VmTestCase } from "./vm-basic.ts";

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const vmQuirkTestCases: VmTestCase[] = [
  {
    name: "Setting symbol properties on QuickJS proxies throws",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const proxy = vm.eval("({})") as Record<string | symbol, unknown>;
        assertType(proxy, isObjectLike, "QuickJS proxy", "expected QuickJS proxy object");
        const token = Symbol("token");
        let didThrow = false;
        try {
          proxy[token] = 123;
        } catch {
          didThrow = true;
        }
        if (!didThrow) {
          throw new Error("setting symbol properties should throw TypeError");
        }
      });
    },
  },
  {
    name: "Object.defineProperty mutates only the host shadow for QuickJS proxies",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const proxy = vm.eval(`
          (function () {
            globalThis.defineTarget = { existing: 1 };
            return globalThis.defineTarget;
          })()
        `) as Record<string, unknown>;
        assertType(proxy, isObjectLike, "defineTarget proxy", "expected QuickJS proxy object");
        Object.defineProperty(proxy, "shadowed", { value: 99, configurable: true });
        assertJsonEqual(proxy.shadowed, undefined, "proxy shadowed property read");
        const vmValue = vm.eval("globalThis.defineTarget.shadowed");
        assertJsonEqual(vmValue, undefined, "QuickJS object remains unchanged");
      });
    },
  },
  {
    name: "Spreading QuickJS arrays throws due to missing iterator",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const arrayProxy = vm.eval("[1, 2, 3]");
        assertType(arrayProxy, isObjectLike, "spread proxy", "expected QuickJS proxy object");
        let threw = false;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const values = [...(arrayProxy as unknown as Iterable<unknown>)];
          void values;
        } catch {
          threw = true;
        }
        if (!threw) {
          throw new Error("spreading QuickJS proxies should throw due to missing Symbol.iterator");
        }
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


