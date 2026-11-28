# @softzweig/suitcase-s3

## 0.2.0

### Minor Changes

- [#51](https://github.com/softzweig/suitcase/pull/51) [`00e0507`](https://github.com/softzweig/suitcase/commit/00e05071d3498d63a0bbc3b5c46bb8035f65e66f) Thanks [@vinznt](https://github.com/vinznt)! - Dependencies that have to be shared with the consumer are now peer dependencies: `zod`, `drizzle-orm`, the `@softzweig/spindle-*` packages, and the `@softzweig/suitcase-*` packages. npm 7 and pnpm 8 install peers on their own, so existing installs keep working; Yarn Berry and `--legacy-peer-deps` users have to install them explicitly. `@softzweig/spindle-memory` is an optional peer, needed only by the `memory` entry point.
  
  Version conflicts that a nested copy used to hide now surface as peer warnings, so align `zod`, `drizzle-orm` and the suitcase packages with the ranges each package declares.

### Patch Changes

- Updated dependencies [[`00e0507`](https://github.com/softzweig/suitcase/commit/00e05071d3498d63a0bbc3b5c46bb8035f65e66f), [`c9ece62`](https://github.com/softzweig/suitcase/commit/c9ece62abae9b565bad1ff6c7cb7d0aa535b67c2)]:
  - @softzweig/suitcase-core@1.0.0
  - @softzweig/suitcase-server@1.0.0

## 0.1.2

### Patch Changes

- [`2d43e83`](https://github.com/softzweig/suitcase/commit/2d43e83ed5d295c19c8fab0f5d0c19e45d29182b) Thanks [@bonrow](https://github.com/bonrow)! - Republish the packages with the MIT license and public GitHub Packages metadata.
- Updated dependencies [[`2d43e83`](https://github.com/softzweig/suitcase/commit/2d43e83ed5d295c19c8fab0f5d0c19e45d29182b)]:
  - @softzweig/suitcase-core@0.2.1
  - @softzweig/suitcase-server@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`90b96a5`](https://github.com/softzweig/suitcase/commit/90b96a52ca73e5c05eb2e9537a7d3e1486d00f57)]:
  - @softzweig/suitcase-core@0.2.0
  - @softzweig/suitcase-server@0.2.0

## 0.1.0

### Minor Changes

- [`f07135b`](https://github.com/softzweig/suitcase/commit/f07135be2cbea30851a829611755acf4248a4027) Thanks [@bonrow](https://github.com/bonrow)! - Initial v0.1 release of the Suitcase packages.
  
  Suitcase provides a database- and storage-agnostic definition, upload flow, and authorization model for user-generated content. This release includes the core contracts, server services, HTTP transport, client and React bindings, Drizzle persistence, S3 storage, upload and job queues, and client-side image processing.

### Patch Changes

- Updated dependencies [[`f07135b`](https://github.com/softzweig/suitcase/commit/f07135be2cbea30851a829611755acf4248a4027)]:
  - @softzweig/suitcase-core@0.1.0
  - @softzweig/suitcase-server@0.1.0
