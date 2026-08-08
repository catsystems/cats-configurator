import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

export default createVuetify({
  components,
  directives,
  display: {
    thresholds: {
      xs: 0,
      sm: 600,
      md: 960,
      lg: 1264,
      xl: 1904,
      xxl: 2560,
    },
  },
  theme: {
    defaultTheme: "catsLight",
    themes: {
      catsLight: {
        dark: false,
        colors: {
          primary: "#ffa726",
          "on-primary": "#ffffff",
          error: "#ff5252",
          "on-error": "#ffffff",
        },
      },
      catsDark: {
        dark: true,
        colors: {
          background: "#121212",
          surface: "#212121",
          primary: "#ffa726",
          "on-primary": "#ffffff",
          error: "#ff5252",
          "on-error": "#ffffff",
          info: "#2196f3",
          success: "#4caf50",
          warning: "#fb8c00",
        },
      },
    },
  },
  defaults: {
    VBtn: {
      style: "text-transform: capitalize",
    },
    VSelect: {
      density: "compact",
      variant: "solo",
    },
    VTextField: {
      density: "compact",
      variant: "solo",
    },
  },
});
