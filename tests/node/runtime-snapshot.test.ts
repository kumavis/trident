import test from "node:test";
import { runtimeSnapshotTest } from "../shared/runtime-snapshot.ts";

void test("QuickJsWasmRuntime snapshot/restore (node)", async () => {
  await runtimeSnapshotTest();
});

