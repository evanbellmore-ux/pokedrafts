// Private server contracts. These are never a browser persistence or RPC API.
export type ExecutionOwnership = { account: string; owner: string; fence: number };
export type ExecutionClaim = { ledger: string; revision: number; fence: number; leaseUntil: number };
export type ExecutionHistory = { sha256: string; bytes: string };
export type ExecutionCheckpoint = ExecutionOwnership & {
  revision: number;
  ledger: string;
  history?: ExecutionHistory[];
};
export type ExecutionRelease = ExecutionOwnership & { revision: number };
export type ExecutionPin = { base: Record<string, unknown>; params: Record<string, unknown> };
export interface SQLQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end?(): Promise<void>;
}
export interface ExecutionStore {
  claim(account: string, owner: string, leaseMs: number): Promise<ExecutionClaim>;
  checkpoint(input: ExecutionCheckpoint): Promise<{ revision: number }>;
  release(input: ExecutionRelease): Promise<void>;
  readHistory(sha256: string): Promise<string | null>;
  readPool(key: string): Promise<Record<string, unknown> | null>;
  savePool(pool: Record<string, unknown>, ownership?: ExecutionOwnership): Promise<void>;
  putPin(base: Record<string, unknown>, params: Record<string, unknown>): Promise<string>;
  readPin(id: string): Promise<ExecutionPin | null>;
}
