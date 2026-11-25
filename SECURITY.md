# Security Policy

## Supported versions

Suitcase is pre-1.0. Security fixes are applied to the latest published 0.x version of each package.
Older versions are supported on a best-effort basis only.

## Reporting a vulnerability

Do not open a public issue, discussion, or pull request for a security problem.

Report it privately through GitHub:

https://github.com/softzweig/suitcase/security/advisories/new

If private vulnerability reporting is unavailable, you can send a private initial message to
`@bonedfps` on Discord and we can move the report to a secure channel. Prefer GitHub advisories
when available. Do not include exploit details in a public message.

Please include:

- the affected package and version
- a description of the issue and its impact
- steps or a minimal proof of concept to reproduce it
- any known workarounds

## What to expect

We will acknowledge the report, investigate it, and coordinate a fix and disclosure timeline with
you. Please give us reasonable time to release a fix before publishing details.

## Scope

Reports are welcome for authentication or authorization bypasses, path traversal, unsafe URL
handling, SQL injection, leaked signed URLs or credentials, metadata or owner validation bypasses,
and other vulnerabilities in the published `@softzweig/suitcase-*` packages.

Examples and documentation are provided as illustrative code. Report issues there if they could
mislead users into an insecure deployment, but they are lower priority than vulnerabilities in the
published packages.

## Safe harbor

We will not pursue legal action against researchers who:

- test against their own deployments and data
- avoid privacy violations, data destruction, and service disruption
- report findings privately and allow time for a fix
