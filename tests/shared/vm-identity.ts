import { createForkableVm } from "../../src/index.ts";
import { assertNumber, assertType } from "./assert.ts";
import type { VmTestCase } from "./vm-basic.ts";
import { usingVm } from "./vm-basic.ts";

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFunctionLike = (value: unknown): value is (...args: unknown[]) => unknown =>
  typeof value === "function";

export const vmIdentityHostTestCases: VmTestCase[] = [
  {
    name: "VM primordials do not share identity with host primordials",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const vmGlobals = vm.globalThis as { Object?: unknown; Array?: unknown };
        const vmObjectCtorFromGlobal = vmGlobals.Object;
        const vmArrayCtorFromGlobal = vmGlobals.Array;
        const vmObjectCtorFromEval = vm.eval("Object");
        const vmArrayCtorFromEval = vm.eval("Array");

        assertType(
          vmObjectCtorFromGlobal,
          isFunctionLike,
          "QuickJS Object constructor (globalThis)",
          "expected function value"
        );
        assertType(
          vmArrayCtorFromGlobal,
          isFunctionLike,
          "QuickJS Array constructor (globalThis)",
          "expected function value"
        );
        assertType(
          vmObjectCtorFromEval,
          isFunctionLike,
          "QuickJS Object constructor (eval)",
          "expected function value"
        );
        assertType(
          vmArrayCtorFromEval,
          isFunctionLike,
          "QuickJS Array constructor (eval)",
          "expected function value"
        );

        if (vmObjectCtorFromGlobal === Object) {
          throw new Error("QuickJS Object constructor should not equal host Object");
        }
        if (vmArrayCtorFromGlobal === Array) {
          throw new Error("QuickJS Array constructor should not equal host Array");
        }
        if (vmObjectCtorFromEval === Object) {
          throw new Error("eval(Object) result should not equal host Object");
        }
        if (vmArrayCtorFromEval === Array) {
          throw new Error("eval(Array) result should not equal host Array");
        }
      });
    },
  },
  {
    name: "QuickJS arrays fail host Array checks",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const arrayProxy = vm.eval("[1, 2, 3]");
        assertType(arrayProxy, isObjectLike, "QuickJS array", "expected array proxy object");
        const firstEntry = (arrayProxy as Record<string, unknown>)["0"];
        assertNumber(firstEntry, 1, "array index access");
        if (Array.isArray(arrayProxy)) {
          throw new Error("Array.isArray should return false for QuickJS proxies");
        }
        if (arrayProxy instanceof Array) {
          throw new Error("QuickJS array proxies should not satisfy host instanceof Array");
        }
      });
    },
  },
  {
    name: "Fetching the same QuickJS function twice returns distinct proxies",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        vm.eval(`
          globalThis.identitySource = () => 7;
          0;
        `);
        const firstFn = vm.eval("globalThis.identitySource");
        const secondFn = vm.eval("globalThis.identitySource");
        assertType(firstFn, isFunctionLike, "first function proxy", "expected function");
        assertType(secondFn, isFunctionLike, "second function proxy", "expected function");
        if (firstFn === secondFn) {
          throw new Error("distinct proxies should not be strictly equal");
        }
        assertNumber(firstFn(), 7, "first proxy invocation");
        assertNumber(secondFn(), 7, "second proxy invocation");
      });
    },
  },
  {
    name: "QuickJS NaN does not equal itself with strict equality",
    async run() {
      await usingVm(() => createForkableVm(), (vm) => {
        const nanValue = vm.eval("NaN");
        assertType(
          nanValue,
          (candidate): candidate is number => typeof candidate === "number",
          "QuickJS NaN",
          "expected number result"
        );
        if (nanValue === nanValue) {
          throw new Error("NaN should not be strictly equal to itself");
        }
        if (!Number.isNaN(nanValue)) {
          throw new Error("Number.isNaN should identify QuickJS NaN results");
        }
      });
    },
  },
];

export const vmIdentitySiblingTestCases: VmTestCase[] = [
  {
    name: "non-primitive values from different VMs never compare strictly equal",
    async run() {
      await usingVm(() => createForkableVm(), async (firstVm) => {
        const secondVm = await createForkableVm();
        try {
          const firstObject = firstVm.eval("({ marker: 'from-first' })");
          const secondObject = secondVm.eval("({ marker: 'from-second' })");
          assertType(firstObject, isObjectLike, "first VM object", "expected object proxy");
          assertType(secondObject, isObjectLike, "second VM object", "expected object proxy");
          if (firstObject === secondObject) {
            throw new Error("object proxies from distinct VMs should not share identity");
          }

          const firstArray = firstVm.eval("[1, 2, 3]");
          const secondArray = secondVm.eval("[1, 2, 3]");
          assertType(firstArray, isObjectLike, "first VM array", "expected array proxy");
          assertType(secondArray, isObjectLike, "second VM array", "expected array proxy");
          if (firstArray === secondArray) {
            throw new Error("array proxies from distinct VMs should not share identity");
          }

          const firstFunction = firstVm.eval("(function () { return 'first'; })");
          const secondFunction = secondVm.eval("(function () { return 'second'; })");
          assertType(firstFunction, isFunctionLike, "first VM function", "expected function proxy");
          assertType(secondFunction, isFunctionLike, "second VM function", "expected function proxy");
          if (firstFunction === secondFunction) {
            throw new Error("function proxies from distinct VMs should not share identity");
          }
        } finally {
          secondVm.dispose();
        }
      });
    },
  },
  {
    name: "primordials from different VMs do not match each other",
    async run() {
      const firstVm = await createForkableVm();
      const secondVm = await createForkableVm();
      try {
        const firstObjectCtor = firstVm.eval("Object");
        const secondObjectCtor = secondVm.eval("Object");
        const firstArrayCtor = firstVm.eval("Array");
        const secondArrayCtor = secondVm.eval("Array");
        assertType(firstObjectCtor, isFunctionLike, "first VM Object constructor", "expected function");
        assertType(secondObjectCtor, isFunctionLike, "second VM Object constructor", "expected function");
        assertType(firstArrayCtor, isFunctionLike, "first VM Array constructor", "expected function");
        assertType(secondArrayCtor, isFunctionLike, "second VM Array constructor", "expected function");
        if (firstObjectCtor === secondObjectCtor) {
          throw new Error("Object constructors from distinct VMs should not be identical");
        }
        if (firstArrayCtor === secondArrayCtor) {
          throw new Error("Array constructors from distinct VMs should not be identical");
        }
      } finally {
        firstVm.dispose();
        secondVm.dispose();
      }
    },
  },
];

export const vmIdentityTestCases: VmTestCase[] = [
  ...vmIdentityHostTestCases,
  ...vmIdentitySiblingTestCases,
];


