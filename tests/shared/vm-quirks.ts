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
];


