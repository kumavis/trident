import { QuickJsForkableVm } from "./vm/QuickJsForkableVm.ts";
import type { CreateVmOptions, ForkableVm } from "./types.ts";

export { QuickJsWasmRuntime } from "./runtime/QuickJsWasmRuntime.ts";
export type { QuickJsValue, ForkableVm, CreateVmOptions } from "./types.ts";

export async function createForkableVm(options: CreateVmOptions = {}): Promise<ForkableVm> {
  return QuickJsForkableVm.create(options);
}

export async function createPreloadedVm(
  bootstrapCode: string,
  options: CreateVmOptions = {}
): Promise<ForkableVm> {
  const vm = await createForkableVm(options);
  try {
    await vm.eval(bootstrapCode);
    return vm;
  } catch (error) {
    await vm.dispose();
    throw error;
  }
}

