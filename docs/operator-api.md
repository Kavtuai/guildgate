# Operator API

`createOperatorActions()` creates guarded actions; the application registers routes.

Users can list their sessions and revoke one or all other sessions. Owners can inspect audit pages, maintenance state, blocks, rate policies, metrics and circuit state.

Audit pagination uses an opaque cursor and a stable `(createdAt, id)` order. The default page size is 50 and the maximum is 200. A custom audit store should implement `listPage()` in the backing query rather than paginating a truncated array.

Stored session metadata is private unless the application supplies a mapper that returns approved public fields. Raw session tokens are never returned.

All owner writes pass through normal session, origin, CSRF, rate, policy and audit controls.
