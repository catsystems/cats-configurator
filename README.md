# CATS Configurator

<img src="https://github.com/catsystems/cats-docs/blob/main/logo/PNG/logo_with_smile.png" alt = "CATS Logo" width="300" height="300">

*Always land on your paws*

## Open Source
All CATS code is open source and can be used free of charge without warranty.

### Build Setup

``` bash
# install dependencies
npm install

# serve with hot reload at localhost:9080
npm start

# build electron application for production
npm run build
```

### How to debug

Because webpack's `devtool` option is set to `source-map` a source map is emitted as a separate file which makes debugging possible.

#### Visual Studio Code

Include the following under `.vscode/launch.json`:

```
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "launch",
      "name": "vuejs: chrome",
      "url": "http://localhost:8080"
    }
  ]
}
```

Set your breakpoints, start the app via `npm start`, select the `vuejs: chrome` configuration in debug view and press F5 or click the green play button.