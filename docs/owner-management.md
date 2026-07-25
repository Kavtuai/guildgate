# Owner management routes

Kernel owner methods are internal application APIs. They do not inspect an HTTP request by themselves. Expose them only through actions that require an owner session.

```ts
const setMaintenance = gate.action({
  name: "owner.maintenance.set",
  parse(value) {
    const body = value as Record<string, unknown>;
    if (typeof body.enabled !== "boolean") throw new Error("enabled is required");
    return {
      enabled: body.enabled,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    };
  },
  resource: () => ({ type: "policy", id: "maintenance" }),
  rateLimit: { limit: 5, windowMs: 60_000 },
  idempotency: { ttlMs: 10 * 60_000 },
  authorize: (context) => ({
    allowed: context.isOwner,
    code: context.isOwner ? undefined : "GUILD_ACCESS_DENIED",
  }),
  async execute(_context, input) {
    await gate.owner.setMaintenance({
      enabled: input.enabled,
      reason: input.reason,
      allowOwners: true,
    });
    return { enabled: input.enabled };
  },
  audit: { changes: (result) => result },
});
```

Use the same structure for user, guild, or IP blocks and for session revocation. Keep the actor, reason, affected subject, and policy version in audit records.

A read-only owner page can use:

```ts
const sessions = await gate.sessions.list(userId);
const auditRows = await gate.config.stores.audit.list?.({ userId, limit: 100 });
```

Do not return session hashes, OAuth ciphertext, raw IP values, or internal exception stacks to the browser.
