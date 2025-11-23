import { QuickJsWasmRuntime } from "../../src/runtime/QuickJsWasmRuntime.ts";
import { assertEqual } from "../shared/assert.ts";

declare const describe: (name: string, suite: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;

describe("QuickJsWasmRuntime (browser)", () => {
  it("evaluates code snippets", async () => {
    const runtime = await QuickJsWasmRuntime.create();
    const resultValue = runtime.evalUtf8("1 + 3");
    assertEqual(resultValue, 4, "evalUtf8");
  });

  it("keeps global state between evaluations", async () => {
    const runtime = await QuickJsWasmRuntime.create();
    runtime.evalUtf8("globalThis.answer = 40; 0;");
    const resultValue = runtime.evalUtf8("globalThis.answer + 2");
    assertEqual(resultValue, 42, "global state");
  });

  it("invokes named functions via callFunctionUtf8", async () => {
    const runtime = await QuickJsWasmRuntime.create();
    runtime.evalUtf8("globalThis.increment = (n) => n + 1; 0;");
    const resultValue = runtime.callFunctionUtf8("increment", [4]);
    assertEqual(resultValue, 5, "callFunctionUtf8");
  });

  it("returns object proxies with callable methods", async () => {
    const runtime = await QuickJsWasmRuntime.create();
    const counter = runtime.evalUtf8(`
      ({
        base: 40,
        increment(delta) {
          this.base += delta;
          return this.base;
        },
      })
    `) as { base: number; increment: (value: number) => number };
    assertEqual(counter.base, 40, "counter initial base");
    const updated = counter.increment(2);
    assertEqual(updated, 42, "counter increment result");
    assertEqual(counter.base, 42, "counter base after increment");
  });
});

