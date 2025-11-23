import test from "node:test";
import { QuickJsWasmRuntime } from "../../src/runtime/QuickJsWasmRuntime.ts";
import { assertEqual } from "../shared/assert.ts";

void test("QuickJsWasmRuntime evalUtf8 evaluates code", async () => {
  const runtime = await QuickJsWasmRuntime.create();
  const resultValue = runtime.evalUtf8("1 + 2");
  assertEqual(resultValue, 3, "evalUtf8");
});

void test("QuickJsWasmRuntime retains global state between evals", async () => {
  const runtime = await QuickJsWasmRuntime.create();
  runtime.evalUtf8("globalThis.foo = 41; 0;");
  const resultValue = runtime.evalUtf8("globalThis.foo + 1");
  assertEqual(resultValue, 42, "global state");
});

void test("QuickJsWasmRuntime callFunctionUtf8 invokes named function", async () => {
  const runtime = await QuickJsWasmRuntime.create();
  runtime.evalUtf8("globalThis.double = (value) => value * 2; 0;");
  const resultValue = runtime.callFunctionUtf8("double", [21]);
  assertEqual(resultValue, 42, "callFunctionUtf8");
});

void test("QuickJsWasmRuntime returns object proxies with callable methods", async () => {
  const runtime = await QuickJsWasmRuntime.create();
  const math = runtime.evalUtf8(`
    ({
      base: 40,
      add(value) {
        return this.base + value;
      },
    })
  `) as { add: (value: number) => number; base: number };
  assertEqual(math.base, 40, "proxy base");
  assertEqual(math.add(2), 42, "proxy method result");
});

