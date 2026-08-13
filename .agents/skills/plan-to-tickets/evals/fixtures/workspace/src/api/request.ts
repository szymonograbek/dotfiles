export type ApiFailure =
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "offline" }
  | { kind: "unexpected"; status: number };

export async function requestJson<T>(path: string): Promise<T> {
  throw new Error(`Fixture only: ${path}`);
}
