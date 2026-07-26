export interface TelemetryActionInput {
  action: string;
  requestId: string;
  method: string;
  path: string;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
}

export interface TelemetryActionResult {
  action: string;
  requestId: string;
  ok: boolean;
  durationMs: number;
  status: number;
  errorCode?: string;
  retryCount?: number;
}

export interface TelemetrySpan {
  setAttribute(name: string, value: string | number | boolean): void;
  recordException(error: unknown): void;
  end(): void;
}

export interface TelemetryHooks {
  startAction?(input: TelemetryActionInput): TelemetrySpan | undefined;
  actionFinished?(result: TelemetryActionResult): void | Promise<void>;
  metric?(name: string, value: number, attributes?: Record<string, string | number | boolean>): void | Promise<void>;
  event?(name: string, attributes?: Record<string, unknown>): void | Promise<void>;
}

export const noopTelemetry: TelemetryHooks = Object.freeze({});

export interface OpenTelemetryApiLike {
  trace: {
    getTracer(name: string, version?: string): {
      startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): {
        setAttribute(name: string, value: string | number | boolean): unknown;
        recordException(error: unknown): unknown;
        setStatus?(status: { code: number; message?: string }): unknown;
        end(): unknown;
      };
    };
  };
  metrics?: {
    getMeter(name: string, version?: string): {
      createCounter(name: string): { add(value: number, attributes?: Record<string, string | number | boolean>): unknown };
      createHistogram(name: string): { record(value: number, attributes?: Record<string, string | number | boolean>): unknown };
    };
  };
}

export function createOpenTelemetryHooks(api: OpenTelemetryApiLike, input?: { name?: string; version?: string }): TelemetryHooks {
  const name = input?.name ?? "@kavtuai/guildgate";
  const tracer = api.trace.getTracer(name, input?.version);
  const meter = api.metrics?.getMeter(name, input?.version);
  const actionCounter = meter?.createCounter("guildgate.actions");
  const duration = meter?.createHistogram("guildgate.action.duration");

  return {
    startAction(action) {
      const span = tracer.startSpan(`guildgate.action.${action.action}`, {
        attributes: {
          "guildgate.action": action.action,
          "guildgate.request_id": action.requestId,
          "http.request.method": action.method,
          "url.path": action.path,
          ...(action.userId ? { "enduser.id": action.userId } : {}),
          ...(action.resourceType ? { "guildgate.resource.type": action.resourceType } : {}),
          ...(action.resourceId ? { "guildgate.resource.id": action.resourceId } : {}),
        },
      });
      return {
        setAttribute: (key, value) => { span.setAttribute(key, value); },
        recordException: (error) => { span.recordException(error); },
        end: () => { span.end(); },
      };
    },
    actionFinished(result) {
      const attributes = {
        "guildgate.action": result.action,
        "guildgate.ok": result.ok,
        "http.response.status_code": result.status,
        ...(result.errorCode ? { "error.type": result.errorCode } : {}),
      };
      actionCounter?.add(1, attributes);
      duration?.record(result.durationMs, attributes);
    },
    metric(metricName, value, attributes) {
      meter?.createHistogram(metricName).record(value, attributes);
    },
  };
}
