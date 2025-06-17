const path = require("path");
const webpack = require("webpack");

const packageJson = require('./package.json');

module.exports = {
  lintOnSave: false,
  transpileDependencies: ["vuetify"],
  pluginOptions: {
    electronBuilder: {
      preload: "src/preload.js",
      externals: ["serialport"],
      outputDir: "builds",
    },
  },
  configureWebpack: {
    devtool: "source-map",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src/"),
      },
    },
    plugins: [
      new webpack.DefinePlugin({
        // Define a global constant '__APP_VERSION__' that can be accessed in the Vue app
        // JSON.stringify is important because it makes '1.0.0' become '"1.0.0"' in the bundled code
        __APP_VERSION__: JSON.stringify(packageJson.version)
      })
    ],
  },
  css: {
    loaderOptions: {
      sass: {
        additionalData: '@import "~@/assets/style/_variables.scss"',
      },
    },
  },
};
