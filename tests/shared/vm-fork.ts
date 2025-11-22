import { createForkableVm, type ForkableVm } from "../../src/index.ts";
import { ensureNumber, usingVm, type VmTestCase } from "./vm-basic.ts";

const disposeAll = (vms: ForkableVm[]): void => {
  for (const vm of vms) {
    vm.dispose();
  }
};

export const vmForkTestCases: VmTestCase[] = [
  {
    name: "fork clones state and diverges independently",
    async run() {
      await usingVm(() => createForkableVm(), async (parentVm) => {
        parentVm.eval("globalThis.x = 1; 0;");
        const childVm = await parentVm.fork();
        try {
          parentVm.eval("globalThis.x = globalThis.x + 1; 0;");
          childVm.eval("globalThis.x = globalThis.x + 10; 0;");
          const parentValue = parentVm.eval("globalThis.x");
          const childValue = childVm.eval("globalThis.x");
          ensureNumber(parentValue, 2, "parent after fork");
          ensureNumber(childValue, 11, "child after fork");
        } finally {
          childVm.dispose();
        }
      });
    },
  },
  {
    name: "multiple forks create identical baselines",
    async run() {
      await usingVm(() => createForkableVm(), async (vm) => {
        vm.eval("globalThis.state = { count: 5 }; 0;");
        const childA = await vm.fork();
        const childB = await vm.fork();
        try {
          childA.eval("globalThis.state.count += 1; 0;");
          childB.eval("globalThis.state.count += 10; 0;");
          const aValue = childA.eval("globalThis.state.count");
          const bValue = childB.eval("globalThis.state.count");
          const parentValue = vm.eval("globalThis.state.count");
          ensureNumber(parentValue, 5, "parent stays at baseline");
          ensureNumber(aValue, 6, "child A increments by 1");
          ensureNumber(bValue, 15, "child B increments by 10");
        } finally {
          disposeAll([childA, childB]);
        }
      });
    },
  },
  {
    name: "fork captures complex objects",
    async run() {
      await usingVm(() => createForkableVm(), async (vm) => {
        vm.eval("globalThis.payload = { nested: { value: 7 } }; 0;");
        const child = await vm.fork();
        try {
          const childValue = child.eval("globalThis.payload.nested.value");
          ensureNumber(childValue, 7, "child reads nested value");
          child.eval("globalThis.payload.nested.value = 100; 0;");
          const parentValue = vm.eval("globalThis.payload.nested.value");
          ensureNumber(parentValue, 7, "parent remains unchanged");
          const childUpdated = child.eval("globalThis.payload.nested.value");
          ensureNumber(childUpdated, 100, "child reflects mutation");
        } finally {
          child.dispose();
        }
      });
    },
  },
  {
    name: "closure state inside function definitions remains isolated per VM",
    async run() {
      await usingVm(() => createForkableVm(), async (vm) => {
        vm.eval(`
          globalThis.increment = (() => {
            let counter = 0;
            return () => {
              counter += 1;
              return counter;
            };
          })();
          0;
        `);
        ensureNumber(vm.callFunction("increment"), 1, "parent first increment");
        ensureNumber(vm.callFunction("increment"), 2, "parent second increment");

        const forked = await vm.fork();
        try {
          ensureNumber(forked.callFunction("increment"), 3, "child first increment");
          ensureNumber(vm.callFunction("increment"), 3, "parent third increment");
          ensureNumber(forked.callFunction("increment"), 4, "child second increment");
          ensureNumber(vm.callFunction("increment"), 4, "parent fourth increment");
        } finally {
          forked.dispose();
        }
      });
    },
  },
];

