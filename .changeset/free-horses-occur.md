---
"@softzweig/suitcase-client": minor
"@softzweig/suitcase-core": minor
"@softzweig/suitcase-drizzle": minor
"@softzweig/suitcase-http": minor
"@softzweig/suitcase-image-processor": minor
"@softzweig/suitcase-react": minor
"@softzweig/suitcase-s3": minor
"@softzweig/suitcase-server": minor
"@softzweig/suitcase-upload-queue": minor
---

Dependencies that have to be shared with the consumer are now peer dependencies: `zod`, `drizzle-orm`, the `@softzweig/spindle-*` packages, and the `@softzweig/suitcase-*` packages. npm 7 and pnpm 8 install peers on their own, so existing installs keep working; Yarn Berry and `--legacy-peer-deps` users have to install them explicitly. `@softzweig/spindle-memory` is an optional peer, needed only by the `memory` entry point.

Version conflicts that a nested copy used to hide now surface as peer warnings, so align `zod`, `drizzle-orm` and the suitcase packages with the ranges each package declares.
