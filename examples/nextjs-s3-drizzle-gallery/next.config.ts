import type { NextConfig } from "next";

const config: NextConfig = {
  // The example has its own docs; Next's generated agent rules would only be noise here.
  agentRules: false,
  // Both are native/CommonJS: they have to be required, not bundled.
  serverExternalPackages: ["@libsql/client", "@20minutes/s3rver"],
};

export default config;
