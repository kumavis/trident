export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, received ${String(actual)}`);
  }
}

export function assertTruthy(value: unknown, label: string): void {
  if (!value) {
    throw new Error(`${label} expected truthy value, received ${String(value)}`);
  }
}

export function assertType<T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
  label: string,
  customMessage?: string
): asserts value is T {
  if (!guard(value)) {
    const detail = customMessage ?? `failed type assertion (received ${String(value)})`;
    throw new Error(`${label} ${detail}`);
  }
}

export function assertNumber(
  value: unknown,
  expected: number,
  label: string
): asserts value is number {
  if (typeof value !== "number") {
    throw new Error(`${label} expected number result`);
  }
  if (value !== expected) {
    throw new Error(`${label} expected ${expected}, received ${String(value)}`);
  }
}

export function assertJsonEqual(value: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(value);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} expected ${expectedJson}, received ${actualJson}`);
  }
}


