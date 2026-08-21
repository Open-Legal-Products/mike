/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("path");
const fs = require("fs");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");

const frontendSharedUi = (filename) =>
  path.resolve(__dirname, "..", "frontend", "src", "shared", "ui", filename);

const frontendComponent = (...segments) =>
  path.resolve(
    __dirname,
    "..",
    "frontend",
    "src",
    "app",
    "components",
    ...segments,
  );

module.exports = async (_env, options) => {
  const isDev = options.mode !== "production";

  // npm and webpack do not read .env files themselves. Load the add-in's
  // local development configuration here so `npm run dev`, `bun dev`, and
  // `npm start` all receive the same values without a shell-specific `source`
  // step. Node's loader preserves variables already supplied by the shell, so
  // explicit CI/deployment overrides continue to win.
  const localEnvPath = path.join(__dirname, ".env");
  if (isDev && fs.existsSync(localEnvPath)) {
    if (typeof process.loadEnvFile !== "function") {
      throw new Error(
        "The Word add-in requires Node.js 22 or newer to load word-addin/.env.",
      );
    }
    process.loadEnvFile(localEnvPath);
  }

  if (!isDev) {
    const required = [
      "REACT_APP_API_BASE_URL",
      "REACT_APP_SUPABASE_URL",
      "REACT_APP_SUPABASE_ANON_KEY",
      "REACT_APP_WEB_APP_URL",
    ];
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (missing.length > 0) {
      throw new Error(
        `Production Word build is missing: ${missing.join(", ")}`,
      );
    }
  }

  /** @type {import('webpack-dev-server').Configuration} */
  const devServerConfig = {
    port: 3200,
    hot: true,
    // compress defaults to true, and the gzip middleware buffers
    // text/event-stream bodies until the response ends — which turns the /chat
    // SSE proxy into one giant blob delivered only when generation finishes.
    // Disable it so streamed tokens reach the task pane as they arrive.
    compress: false,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    static: [
      {
        directory: path.join(__dirname, "assets"),
        publicPath: "/assets",
      },
    ],
  };

  if (isDev) {
    // Dev-only: self-signed HTTPS cert for the webpack-dev-server on
    // localhost:3200. office-addin-dev-certs installs its CA into the OS
    // keychain, which pops an admin prompt — impossible to approve in
    // automated/headless environments. DEV_HTTPS_CERT/DEV_HTTPS_KEY serve
    // existing cert files directly instead (the driving browser must then
    // tolerate the untrusted cert, e.g. --ignore-certificate-errors).
    if (process.env.DEV_HTTPS_CERT && process.env.DEV_HTTPS_KEY) {
      const fs = require("fs");
      devServerConfig.server = {
        type: "https",
        options: {
          cert: fs.readFileSync(process.env.DEV_HTTPS_CERT),
          key: fs.readFileSync(process.env.DEV_HTTPS_KEY),
        },
      };
    } else {
      // Required lazily so production builds (`--mode production`) don't
      // depend on this dev-only package at all.
      const { getHttpsServerOptions } = require("office-addin-dev-certs");
      const httpsOptions = await getHttpsServerOptions();
      devServerConfig.server = { type: "https", options: httpsOptions };
    }

    // Word loads the task pane over HTTPS, and its WebView blocks "mixed content"
    // (HTTP requests from an HTTPS page). The Mike API and local Supabase only
    // serve HTTP, so calling them directly fails with "Load failed". Proxy them
    // through this HTTPS dev server instead, so the pane makes only same-origin
    // calls (`/auth/...` and `/api/...`) that webpack forwards to the local HTTP
    // backends server-side. Targets are overridable so the proxy tracks whatever
    // ports the backend is actually on.
    const supaTarget =
      process.env.SUPABASE_PROXY_TARGET || "http://127.0.0.1:54321";
    const apiTarget = process.env.API_PROXY_TARGET || "http://localhost:3001";
    devServerConfig.proxy = [
      {
        context: ["/auth", "/rest", "/storage"],
        target: supaTarget,
        changeOrigin: true,
        secure: false,
      },
      {
        context: ["/api"],
        target: apiTarget,
        changeOrigin: true,
        secure: false,
        pathRewrite: { "^/api": "" },
      },
    ];
  }

  /** @type {import('webpack').Configuration} */
  const config = {
    // Keep readable stack traces locally without publishing application source
    // and embedded source content in production artifacts.
    devtool: isDev ? "source-map" : false,
    entry: {
      taskpane: "./src/taskpane/index.tsx",
      commands: "./src/commands/commands.ts",
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: isDev ? "[name].js" : "[name].[contenthash:8].js",
      chunkFilename: isDev ? "[id].js" : "[id].[contenthash:8].js",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      modules: [path.resolve(__dirname, "node_modules"), "node_modules"],
      alias: {
        // Cross-app source files must use the add-in's React runtime so the
        // bundle never picks up a second copy from frontend/node_modules.
        "react$": require.resolve("react"),
        "react/jsx-runtime$": require.resolve("react/jsx-runtime"),
        "react-dom$": require.resolve("react-dom"),
        "lucide-react$": require.resolve(
          "lucide-react/dist/esm/lucide-react.js",
        ),
        // The frontend's public icon set is canonical. Webpack imports those
        // same SVGs and emits content-hashed copies for the add-in bundle.
        "@icons": path.resolve(__dirname, "..", "frontend", "public", "icons"),
        "@mike/edit-card-ui": frontendSharedUi("EditCardUI.tsx"),
        "@mike/edit-cards-section-ui": frontendSharedUi(
          "EditCardsSectionUI.tsx",
        ),
        "@mike/pre-response-wrapper-ui": frontendSharedUi(
          "PreResponseWrapperUI.tsx",
        ),
        "@mike/document-event-blocks-ui": frontendSharedUi(
          "DocumentEventBlocksUI.tsx",
        ),
        "@mike/glass-card-ui": frontendSharedUi("GlassCardUI.tsx"),
        "@mike/modal-ui": frontendSharedUi("ModalUI.tsx"),
        "@mike/header-buttons-ui": frontendSharedUi(
          "HeaderButtonsUI.tsx",
        ),
        "@mike/pill-button-ui": frontendSharedUi("PillButtonUI.tsx"),
        "@mike/dropdown-ui": frontendSharedUi("DropdownUI.tsx"),
        "@mike/citation-pill-ui": frontendSharedUi("CitationPillUI.tsx"),
        "@mike/model-toggle-ui": frontendSharedUi("ModelToggleUI.tsx"),
        // The web app's Mike glyph, imported directly: it renders inline SVG
        // from React alone, so there is nothing app-specific to fork.
        "@mike/mike-icon": frontendComponent("chat", "mike-icon.tsx"),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          // Type-checking is done separately via `tsc --noEmit`.
          use: {
            loader: "ts-loader",
            options: { transpileOnly: true },
          },
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader", "postcss-loader"],
        },
        {
          test: /\.svg$/i,
          type: "asset/resource",
          generator: {
            filename: "icons/[name].[contenthash][ext]",
          },
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/index.html",
        chunks: ["taskpane"],
      }),
      new HtmlWebpackPlugin({
        filename: "commands.html",
        template: "./src/commands/commands.html",
        chunks: ["commands"],
      }),
      // Expose env vars to the bundle so TypeScript process.env calls compile
      new webpack.EnvironmentPlugin({
        // Development defaults stay on the HTTPS dev-server origin, whose
        // proxies reach the HTTP backends without mixed-content failures.
        REACT_APP_API_BASE_URL: isDev
          ? process.env.REACT_APP_API_BASE_URL || "/api"
          : undefined,
        REACT_APP_SUPABASE_URL: isDev
          ? process.env.REACT_APP_SUPABASE_URL || ""
          : undefined,
        // Keep the key sourced by scripts/dev.sh; only the URL is made
        // same-origin so authentication also travels through the HTTPS proxy.
        REACT_APP_SUPABASE_ANON_KEY: isDev
          ? process.env.REACT_APP_SUPABASE_ANON_KEY || ""
          : undefined,
        // Deployment override only. Leaving it empty makes DEFAULT_MODEL_ID in
        // src/taskpane/lib/modelCatalog.ts the single source of the default
        // model — this config file cannot import that TypeScript constant, so
        // repeating its value here would be a second copy that silently drifts.
        REACT_APP_DEFAULT_MODEL: process.env.REACT_APP_DEFAULT_MODEL || "",
        // The Mike web app origin — the task pane links here (e.g. the
        // account/api-keys page); it never fetches from it.
        REACT_APP_WEB_APP_URL: isDev
          ? process.env.REACT_APP_WEB_APP_URL || "https://app.mikeoss.com"
          : undefined,
      }),
    ],
    devServer: devServerConfig,
  };

  return config;
};
