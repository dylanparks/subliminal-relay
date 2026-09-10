const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

/**
 * Inlines emitted <script src="..."> bundles into the HTML.
 *
 * Figma loads a plugin's UI as a standalone document with no file server, so an external
 * script reference silently never loads and the panel renders blank. html-webpack-plugin's
 * `inlineSource` option does nothing on its own — it needs a companion plugin, and the one
 * this project had installed (html-webpack-inline-source-plugin) doesn't support
 * html-webpack-plugin v5. This does the same job against v5's own hook.
 */
class InlineScriptsPlugin {
  apply(compiler) {
    compiler.hooks.compilation.tap('InlineScriptsPlugin', (compilation) => {
      HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tap('InlineScriptsPlugin', (data) => {
        data.html = data.html.replace(
          /<script[^>]*\ssrc=["']?([^"'\s>]+)["']?[^>]*><\/script>/g,
          (tag, src) => {
            const asset = compilation.assets[src.replace(/^\.?\//, '')];
            if (!asset) return tag;
            // A literal </script> inside the bundle would close the tag early.
            const source = String(asset.source()).replace(/<\/script>/g, '<\\/script>');
            return `<script>${source}</script>`;
          },
        );
        return data;
      });
    });
  }
}

module.exports = (env, argv) => ({
  mode: argv.mode === 'production' ? 'production' : 'development',
  devtool: argv.mode === 'production' ? false : 'inline-source-map',

  entry: {
    code: './src/code.ts',
    ui: './src/ui/index.tsx',
  },

  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },

  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: './src/ui/index.html',
      filename: 'ui.html',
      chunks: ['ui'],
      inject: 'body',
    }),
    // Must come after HtmlWebpackPlugin — Figma requires a single self-contained HTML file.
    new InlineScriptsPlugin(),
  ],
});
