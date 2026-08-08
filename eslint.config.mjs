import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import vue from "eslint-plugin-vue";
import globals from "globals";

export default [
  {
    ignores: ["builds/**", "dist/**", "node_modules/**", "out/**"],
  },
  eslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.{js,mjs,vue}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        __APP_VERSION__: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "vue/multi-word-component-names": [
        "error",
        { ignores: ["App", "Footer", "Home", "Snackbar"] },
      ],
      "vue/no-v-text-v-html-on-component": "error",
      "vue/attributes-order": "off",
      "vue/attribute-hyphenation": "off",
      "vue/first-attribute-linebreak": "off",
      "vue/order-in-components": "off",
      "vue/v-slot-style": "off",
    },
  },
  prettier,
];
