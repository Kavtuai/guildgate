import type { AuditEvent, AuditStore } from "@kavtuai/guildgate";

interface QueryClient {
  query(sql: string, values: unknown[]): Promise<unknown>;
}

export function createPostgresAuditStore(client: QueryClient): AuditStore {
  return {
    async write(event: AuditEvent) {
      await client.query(
        `INSERT INTO guildgate_audit_events
          (id, request_id, action, actor, resource, result, reason_code,
           policy_version, changes, metadata, created_at)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
        [
          event.id,
          event.requestId,
          event.action,
          JSON.stringify(event.actor),
          JSON.stringify(event.resource ?? null),
          event.result,
          event.reasonCode ?? null,
          event.policyVersion,
          JSON.stringify(event.changes ?? null),
          JSON.stringify(event.metadata),
          event.createdAt,
        ],
      );
    },
  };
}
