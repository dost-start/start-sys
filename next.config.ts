import type { NextConfig } from "next";

// Minimal by design. Security response headers (HSTS, CSP, nosniff, frame-ancestors,
// Referrer-Policy, Permissions-Policy) and the noindex X-Robots-Tag land in S7-T11/S7-T12.
const nextConfig: NextConfig = {};

export default nextConfig;
