/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["prisma", "@prisma/client", "node-cron"]
  }
};

module.exports = nextConfig;
