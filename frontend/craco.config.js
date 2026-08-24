// craco.config.js
const path = require("path");

// craco.config.js itself reads process.env (e.g. ENABLE_HEALTH_CHECK below) before
// react-scripts' own env.js ever runs, so it needs the same .env cascade CRA uses
// downstream — otherwise a bare `dotenv.config()` here would only ever load `.env`
// and, since dotenv never overrides an already-set var, silently lock every build
// (including `npm run build`) to `.env`'s values even when `.env.production` sets
// something different.
const NODE_ENV = process.env.NODE_ENV || "development";
[
  `.env.${NODE_ENV}.local`,
  NODE_ENV !== "test" && ".env.local", // excluded for test, same as CRA — keeps test runs reproducible across machines
  `.env.${NODE_ENV}`,
  ".env",
].filter(Boolean).forEach((f) => {
  require("dotenv").config({ path: path.resolve(__dirname, f) });
});

// Check if we're in development/preview mode (not production build)
// Craco sets NODE_ENV=development for start, NODE_ENV=production for build
const isDevServer = process.env.NODE_ENV !== "production";

// Environment variable overrides
const config = {
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

let webpackConfig = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  jest: {
    configure: (jestConfig) => {
      // Jest doesn't see the webpack "@" alias below, so it needs its own mapping.
      jestConfig.moduleNameMapper = {
        ...jestConfig.moduleNameMapper,
        "^@/(.*)$": "<rootDir>/src/$1",
        // react-router-dom v7's package.json "exports" map is too modern for this
        // project's Jest 27 resolver (bundled via react-scripts) to understand —
        // it can't pick a matching condition and fails with "Cannot find module".
        // Point straight at the real CJS entry file instead (its own "main" field
        // is stale and points at a file that doesn't exist in the published dist).
        "^react-router-dom$": "<rootDir>/node_modules/react-router-dom/dist/index.js",
        "^react-router$": "<rootDir>/node_modules/react-router/dist/development/index.js",
        "^react-router/dom$": "<rootDir>/node_modules/react-router/dist/development/dom-export.js",
      };
      jestConfig.collectCoverageFrom = [
        "src/**/*.{js,jsx}",
        "!src/index.js",
        "!src/reportWebVitals.js",
        // Thin shadcn/Radix wrapper primitives — not app logic, and largely
        // exercised indirectly through the pages/components that use them.
        "!src/components/ui/**",
      ];
      // axios ships as ESM-only starting with recent versions — Jest's default
      // transformIgnorePatterns skips node_modules entirely, so without this it
      // fails to parse axios's `import` syntax.
      jestConfig.transformIgnorePatterns = ["node_modules/(?!(axios)/)"];
      return jestConfig;
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {

      // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
        ],
      };

      // Add health check plugin to webpack if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }
      return webpackConfig;
    },
  },
};

webpackConfig.devServer = (devServerConfig) => {
  // Add health check endpoints if enabled
  if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
    const originalSetupMiddlewares = devServerConfig.setupMiddlewares;

    devServerConfig.setupMiddlewares = (middlewares, devServer) => {
      // Call original setup if exists
      if (originalSetupMiddlewares) {
        middlewares = originalSetupMiddlewares(middlewares, devServer);
      }

      // Setup health endpoints
      setupHealthEndpoints(devServer, healthPluginInstance);

      return middlewares;
    };
  }

  return devServerConfig;
};

// Wrap with visual edits (automatically adds babel plugin, dev server, and overlay in dev mode)
if (isDevServer) {
  try {
    const { withVisualEdits } = require("@emergentbase/visual-edits/craco");
    webpackConfig = withVisualEdits(webpackConfig);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('@emergentbase/visual-edits/craco')) {
      console.warn(
        "[visual-edits] @emergentbase/visual-edits not installed — visual editing disabled."
      );
    } else {
      throw err;
    }
  }
}

module.exports = webpackConfig;
