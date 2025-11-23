import { createForkableVm } from "../../src/index.ts";
import { assertType } from "./assert.ts";
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
];


