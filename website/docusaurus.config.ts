import { themes as prismThemes } from "prism-react-renderer";

import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "LaptopShop API",
  tagline: "Tài liệu kỹ thuật, kiến trúc, database và nghiệp vụ",
  favicon: "img/logo.svg",
  url: "https://quocduy21-10.github.io",
  baseUrl: "/laptopshop-api/",
  organizationName: "QuocDuy21-10",
  projectName: "laptopshop-api",
  onBrokenLinks: "throw",
  i18n: { defaultLocale: "vi", locales: ["vi"] },
  markdown: {
    format: "detect",
    mermaid: true,
    hooks: { onBrokenMarkdownLinks: "throw" },
  },
  themes: [
    "@docusaurus/theme-mermaid",
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        docsDir: "../docs",
        docsRouteBasePath: "/",
        indexBlog: false,
        language: ["en"],
      },
    ],
  ],
  presets: [
    [
      "classic",
      {
        docs: {
          path: "../docs",
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          exclude: ["superpowers/**"],
          editUrl: "https://github.com/QuocDuy21-10/laptopshop-api/edit/main/",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: "LaptopShop API",
      logo: { alt: "LaptopShop", src: "img/logo.svg" },
      items: [
        {
          href: "https://github.com/QuocDuy21-10/laptopshop-api",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: { style: "dark", copyright: "LaptopShop API documentation" },
    prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula },
  } satisfies Preset.ThemeConfig,
};

export default config;
