import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin output tracing to this project so Next doesn't pick up the
  // parent C:\Users\palmz\package-lock.json as workspace root.
  outputFileTracingRoot: path.resolve(__dirname),

  // Cornerstone3D's WASM codec bundles call require('fs'/'path') for
  // Node — but we use them only client-side, so stub those modules out
  // for the browser bundle. Without this, Next's SSR compile errors on
  // 'Module not found: fs' inside @cornerstonejs/codec-* packages.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },

  // The DICOM viewer hits Cornerstone3D's heavy native ESM. Transpile it
  // through Next so the dev/server bundle understands the module shape
  // and tree-shakes correctly.
  transpilePackages: [
    "@cornerstonejs/core",
    "@cornerstonejs/tools",
    "@cornerstonejs/dicom-image-loader",
  ],
};

export default nextConfig;
