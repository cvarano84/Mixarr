/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["prisma", "@prisma/client", "node-cron", "prom-client"]
  },
  // prom-client and node-cron both pull in Node built-ins (fs, v8, cluster,
  // child_process). serverComponentsExternalPackages handles the RSC bundle
  // but not the instrumentation bundle, so we also mark them external in
  // webpack for the server build. The Node runtime resolves them via
  // require() at runtime, which is fine because the server is always Node,
  // never Edge.
  //
  // We also externalize the Node built-ins that prom-client / our metrics
  // module reach for (http etc.). Without this, webpack tries to resolve
  // them at build time when tracing through instrumentation.ts and fails.
  // Our code only calls into these paths under `NEXT_RUNTIME === 'nodejs'`
  // so the runtime require is safe.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push("prom-client", "node-cron", "http");
    }
    return config;
  },
};

module.exports = nextConfig;
