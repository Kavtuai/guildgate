declare class Buffer extends Uint8Array {
  static from(value: string | ArrayBuffer | ArrayBufferView, encoding?: string): Buffer;
  static concat(values: readonly Uint8Array[]): Buffer;
  static isBuffer(value: unknown): value is Buffer;
  static byteLength(value: string): number;
  toString(encoding?: string): string;
}

declare module "node:crypto" {
  export function randomBytes(size: number): Buffer;
  export function randomUUID(): string;
  export function createHash(algorithm: string): {
    update(value: string | Uint8Array): unknown;
    digest(encoding: string): string;
  };
  export function createHmac(algorithm: string, key: string | Uint8Array): {
    update(value: string | Uint8Array): unknown;
    digest(encoding: string): string;
  };
  export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean;
  export function createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array): {
    update(value: string | Uint8Array, inputEncoding?: string): Buffer;
    final(): Buffer;
    getAuthTag(): Buffer;
  };
  export function createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array): {
    update(value: Uint8Array): Buffer;
    final(): Buffer;
    setAuthTag(tag: Uint8Array): void;
  };
}

declare const process: {
  versions: { node: string };
  env: Record<string, string | undefined>;
  uptime(): number;
  memoryUsage(): { rss: number; heapUsed: number; heapTotal: number; external: number };
  cpuUsage(previousValue?: { user: number; system: number }): { user: number; system: number };
};

declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, callback: () => R): R;
  }
}

declare module "node:perf_hooks" {
  export function monitorEventLoopDelay(options?: { resolution?: number }): {
    mean: number;
    enable(): void;
    disable(): void;
    reset(): void;
  };
}

declare module "node:os" {
  export function loadavg(): number[];
}

declare module "node:net" {
  export function isIP(input: string): 0 | 4 | 6;
}
