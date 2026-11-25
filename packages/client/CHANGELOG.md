# @softzweig/suitcase-client

## 0.2.1

### Patch Changes

- [`2d43e83`](https://github.com/softzweig/suitcase/commit/2d43e83ed5d295c19c8fab0f5d0c19e45d29182b) Thanks [@bonrow](https://github.com/bonrow)! - Republish the packages with the MIT license and public GitHub Packages metadata.
- Updated dependencies [[`2d43e83`](https://github.com/softzweig/suitcase/commit/2d43e83ed5d295c19c8fab0f5d0c19e45d29182b)]:
  - @softzweig/suitcase-core@0.2.1

## 0.2.0

### Minor Changes

- [#41](https://github.com/softzweig/suitcase/pull/41) [`90b96a5`](https://github.com/softzweig/suitcase/commit/90b96a52ca73e5c05eb2e9537a7d3e1486d00f57) Thanks [@bonrow](https://github.com/bonrow)! - Add opt-in resource metadata schemas and decorators. A schema types the client claim and is enforced by the server: a kind without one refuses client metadata, and a schema that does not allow `undefined` makes the claim required. Decorators can add server-owned fields, reuse matches on the stored metadata, and updates run through the same decorator with the update action. Upload hooks now see a required intent whenever the kind declares a non-optional intent schema. Also fixes NULL filters in the Drizzle repository.

### Patch Changes

- Updated dependencies [[`90b96a5`](https://github.com/softzweig/suitcase/commit/90b96a52ca73e5c05eb2e9537a7d3e1486d00f57)]:
  - @softzweig/suitcase-core@0.2.0

## 0.1.0

### Minor Changes

- [`f07135b`](https://github.com/softzweig/suitcase/commit/f07135be2cbea30851a829611755acf4248a4027) Thanks [@bonrow](https://github.com/bonrow)! - Initial v0.1 release of the Suitcase packages.
  
  Suitcase provides a database- and storage-agnostic definition, upload flow, and authorization model for user-generated content. This release includes the core contracts, server services, HTTP transport, client and React bindings, Drizzle persistence, S3 storage, upload and job queues, and client-side image processing.

### Patch Changes

- Updated dependencies [[`f07135b`](https://github.com/softzweig/suitcase/commit/f07135be2cbea30851a829611755acf4248a4027)]:
  - @softzweig/suitcase-core@0.1.0
