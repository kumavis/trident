import { runtimeSnapshotTest } from "../shared/runtime-snapshot.ts";

declare const describe: (name: string, suite: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;

describe("QuickJsWasmRuntime snapshot/restore (browser)", () => {
  it("restores previous state from snapshot", async () => {
    await runtimeSnapshotTest();
  });
});

