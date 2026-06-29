// Tailwind v4 runs as a PostCSS plugin (consumed by postcss-loader in
// webpack.config.js). Tailwind handles its own autoprefixing in v4.
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
