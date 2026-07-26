export interface SessionRevocationMessage {
  sessionIdHash: string;
  userId?: string;
  revokedAt: string;
  source?: string;
}

export interface SessionRevocationBus {
  publish(message: SessionRevocationMessage): Promise<void>;
  subscribe(listener: (message: SessionRevocationMessage) => void | Promise<void>): () => void;
}

export class MemorySessionRevocationBus implements SessionRevocationBus {
  private readonly listeners = new Set<(message: SessionRevocationMessage) => void | Promise<void>>();

  async publish(message: SessionRevocationMessage): Promise<void> {
    await Promise.allSettled([...this.listeners].map((listener) => listener(structuredClone(message))));
  }

  subscribe(listener: (message: SessionRevocationMessage) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function bindRevocationBus(input: {
  bus: SessionRevocationBus;
  revokeLocal(sessionIdHash: string): void;
}): () => void {
  return input.bus.subscribe((message) => input.revokeLocal(message.sessionIdHash));
}
