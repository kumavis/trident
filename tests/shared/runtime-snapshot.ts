import { QuickJsWasmRuntime } from "../../src/runtime/QuickJsWasmRuntime.ts";

export const runtimeSnapshotTest = async (): Promise<void> => {
  const runtime = await QuickJsWasmRuntime.create();

  runtime.evalUtf8("globalThis.value = 1; 0;");
  const snapshot = runtime.takeSnapshot();

  runtime.evalUtf8("globalThis.value = 2; 0;");
  const beforeRestore = runtime.evalUtf8("globalThis.value");
  if (beforeRestore !== "2") {
    throw new Error(`Expected "2" before restore, received "${beforeRestore}"`);
  }

  runtime.restoreSnapshot(snapshot);
  const afterRestore = runtime.evalUtf8("globalThis.value");
  if (afterRestore !== "1") {
    throw new Error(`Expected "1" after restore, received "${afterRestore}"`);
  }
};

