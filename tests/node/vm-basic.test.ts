import assert from "node:assert/strict";
import test from "node:test";
import { createForkableVm } from "../../src/index.ts";
import { vmBasicTestCases } from "../shared/vm-basic.ts";
import { vmForkTestCases } from "../shared/vm-fork.ts";

for (const testCase of [...vmBasicTestCases, ...vmForkTestCases]) {
  void test(`Forkable VM (node) – ${testCase.name}`, async () => {
    await testCase.run();
  });
}

void test("Forkable VM dispose is idempotent and blocks further use", async () => {
  const vm = await createForkableVm();
  vm.eval("1 + 2");
  vm.dispose();
  vm.dispose();
  assert.throws(() => vm.eval("1 + 3"), /VM has been disposed/);
});

