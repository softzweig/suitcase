import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightThemeBlack from "starlight-theme-black";

// Actions sets GITHUB_REPOSITORY, so the deployed site, canonical URLs and edit links follow the
// repository it actually runs from. The default keeps local builds on the intended public home.
const repository = process.env.GITHUB_REPOSITORY ?? "softzweig/suitcase";
const [owner, repo] = repository.split("/");
const base = `/${repo ?? "suitcase"}`;

export default defineConfig({
  site: `https://${owner ?? "softzweig"}.github.io`,
  base,
  integrations: [
    starlight({
      title: "Suitcase",
      description: "Database- and storage-agnostic user-generated content for TypeScript.",
      plugins: [
        starlightThemeBlack({
          footerText: "Suitcase documentation, built with Astro Starlight.",
        }),
      ],
      customCss: ["./src/styles/theme.css"],
      editLink: {
        baseUrl: `https://github.com/${repository}/edit/main/apps/docs/`,
      },
      social: [
        {
          href: `https://github.com/${repository}`,
          icon: "github",
          label: "GitHub",
        },
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", link: "/" },
            { label: "Installation", slug: "start/installation" },
            { label: "Concepts", slug: "start/concepts" },
            { label: "Your first upload", slug: "start/first-upload" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Defining resources", slug: "guides/definitions" },
            { label: "The upload flow", slug: "guides/uploads" },
            { label: "Resolving resources", slug: "guides/resolving" },
            { label: "React hooks", slug: "guides/react" },
            { label: "Storage adapters", slug: "guides/storage" },
            { label: "Cached download URLs", slug: "guides/cached-downloads" },
            { label: "Persistence", slug: "guides/persistence" },
            { label: "Background jobs", slug: "guides/jobs" },
            { label: "Image processing", slug: "guides/image-processing" },
          ],
        },
        {
          label: "Packages",
          items: [
            { label: "Package map", slug: "packages" },
            { label: "core", slug: "packages/core" },
            { label: "server", slug: "packages/server" },
            { label: "client", slug: "packages/client" },
            { label: "react", slug: "packages/react" },
            { label: "http", slug: "packages/http" },
            { label: "drizzle", slug: "packages/drizzle" },
            { label: "s3", slug: "packages/s3" },
            { label: "upload-queue", slug: "packages/upload-queue" },
            { label: "job-queue", slug: "packages/job-queue" },
            { label: "image-processor", slug: "packages/image-processor" },
          ],
        },
        {
          label: "Examples",
          items: [{ label: "Runnable apps", slug: "examples" }],
        },
      ],
    }),
  ],
});
