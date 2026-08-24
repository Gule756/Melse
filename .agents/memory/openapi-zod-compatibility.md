---
name: OpenAPI and generated Zod compatibility
description: Compatibility note for numeric fields in this workspace's Orval-generated Zod client.
---

Use OpenAPI `number` for numeric API fields when targeting the current generated Zod package; OpenAPI `integer` is emitted as `zod.int()`, which the installed Zod 3 runtime does not provide.

**Why:** Code generation can succeed while the chained library typecheck fails on the generated validator.

**How to apply:** Prefer `number` unless integer-specific validation is required and the generator/runtime versions have been upgraded together.