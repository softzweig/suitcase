---
"@softzweig/suitcase-core": minor
"@softzweig/suitcase-server": minor
"@softzweig/suitcase-client": minor
"@softzweig/suitcase-drizzle": patch
---

Add opt-in resource metadata schemas and decorators. A schema types the client claim and is enforced by the server: a kind without one refuses client metadata, and a schema that does not allow `undefined` makes the claim required. Decorators can add server-owned fields, reuse matches on the stored metadata, and updates run through the same decorator with the update action. Upload hooks now see a required intent whenever the kind declares a non-optional intent schema. Also fixes NULL filters in the Drizzle repository.
