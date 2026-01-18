const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@hypervision/ar-core",
    "@hypervision/chess-domain",
    "@hypervision/engine",
    "@hypervision/modules",
    "@hypervision/ui-kit"
  ],
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"]
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      os: false,
      path: false,
      perf_hooks: false,
      readline: false,
      worker_threads: false
    };

    // Enable WebAssembly
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true
    };

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource"
    });

    return config;
  }
};

export default nextConfig;
