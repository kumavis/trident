import { QuickJsWasmRuntime } from "../../src/runtime/QuickJsWasmRuntime.ts";
import { assertEqual } from "./assert.ts";

export const runtimeSnapshotTest = async (): Promise<void> => {
  const runtime = await QuickJsWasmRuntime.create();

  runtime.evalUtf8("globalThis.value = 1; 0;");
  const snapshot = runtime.takeSnapshot();

  runtime.evalUtf8("globalThis.value = 2; 0;");
  const beforeRestore = runtime.evalUtf8("globalThis.value");
  assertEqual(beforeRestore, 2, "value before restore");

  runtime.restoreSnapshot(snapshot);
  const afterRestore = runtime.evalUtf8("globalThis.value");
  assertEqual(afterRestore, 1, "value after restore");
};

