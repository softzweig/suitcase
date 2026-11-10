# @suitcase/sample

Minimal publishable package and template for new `@suitcase` libraries.

```ts
import { greet } from "@suitcase/sample";

greet({ recipient: "Suitcase" }); // "Hello, Suitcase!"
```

- Build: `tsc --project tsconfig.build.json` → `dist/`
- Types: `./dist/index.d.ts`
- Published to GitHub Packages as a private (`restricted`) package.
