import path from "node:path";
import type { StorybookConfig } from "@storybook/nextjs-vite";
import { stylexVitePlugin } from "../config/stylexVitePlugin.ts";

const config: StorybookConfig = {
  staticDirs: ["../public"],
  stories: ["../src/shared/**/*.stories.@(ts|tsx)", "../src/features/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/nextjs-vite",
    options: {},
  },
  viteFinal(config) {
    return {
      ...config,
      plugins: [
        ...(config.plugins ?? []),
        stylexVitePlugin({ rootDir: path.resolve(import.meta.dirname, "..") }),
      ],
    };
  },
};

export default config;
