/* eslint-disable @typescript-eslint/no-var-requires */
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");

module.exports = async (_env, options) => {
  const isDev = options.mode !== "production";

  /** @type {import('webpack-dev-server').Configuration} */
  const devServerConfig = {
    port: 3000,
    hot: true,
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
    // localhost:3000. Required lazily so production builds (`--mode production`)
    // don't depend on this dev-only package at all.
    const { getHttpsServerOptions } = require("office-addin-dev-certs");
    const httpsOptions = await getHttpsServerOptions();
    devServerConfig.server = { type: "https", options: httpsOptions };

    // Word loads the task pane over HTTPS, and its WebView blocks "mixed content"
    // (HTTP requests from an HTTPS page). The Mike API and local Supabase only
    // serve HTTP, so calling them directly fails with "Load failed". Proxy them
    // through this HTTPS dev server instead, so the pane makes only same-origin
    // HTTPS calls (REACT_APP_SUPABASE_URL=https://localhost:3000,
    // REACT_APP_API_BASE_URL=https://localhost:3000/api) that webpack forwards to
    // the local HTTP backends server-side. Targets are overridable so the proxy
    // tracks whatever ports the backend is actually on.
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
    devtool: "source-map",
    entry: {
      taskpane: "./src/taskpane/index.tsx",
      commands: "./src/commands/commands.ts",
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      alias: {
        // Shared design system (the @mike/shared package) lives in the
        // monorepo's packages/. Same name the web app imports.
        "@mike/shared": path.resolve(__dirname, "../packages/shared"),
        // De-dupe React when resolving the shared (external) sources.
        react: path.resolve(__dirname, "node_modules/react"),
        "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      },
      // Resolve bare imports (cva, lucide-react, radix, …) from the add-in's
      // own node_modules even for the shared sources that live outside this
      // directory; the trailing "node_modules" keeps default walk-up behaviour.
      modules: [path.resolve(__dirname, "node_modules"), "node_modules"],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          // transpileOnly so ts-loader compiles the shared .tsx sources that
          // live outside this project's rootDir without cross-project type
          // errors; type-checking is done separately via `tsc --noEmit`.
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
        REACT_APP_API_BASE_URL: "http://localhost:3001",
        REACT_APP_SUPABASE_URL: "",
        REACT_APP_SUPABASE_ANON_KEY: "",
        REACT_APP_DEFAULT_MODEL: "claude-sonnet-4-6",
        NODE_ENV: isDev ? "development" : "production",
      }),
    ],
    devServer: devServerConfig,
  };

  return config;
};
