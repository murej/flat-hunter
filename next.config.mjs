/** @type {import('next').NextConfig} */
const nextConfig = {
  // langmail is a napi-rs native module (.node binary) — Turbopack cannot bundle it,
  // so mark it external so Node.js loads it at runtime instead.
  serverExternalPackages: ["langmail"],
};

export default nextConfig;
