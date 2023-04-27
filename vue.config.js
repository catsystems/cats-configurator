const path = require("path");

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
  },
  css: {
    loaderOptions: {
      sass: {
        additionalData: '@import "~@/assets/style/_variables.scss"',
      },
    },
  },
};
