import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

const globalVars = {
  ...globals.browser,
  ...globals.jquery,
  ...[
    "SparkMD5",
    "ui",
    "Actor",
    "AudioContainer",
    "CONST",
    "Dialog",
    "Entity",
    "ForgeAssetSyncApp",
    "FormApplication",
    "foundry",
    "game",
    "getProperty",
    "Hooks",
    "isNewerVersion",
    "mergeObject",
    "MESSAGES",
    "Module",
    "ModuleManagement",
    "setProperty",
    "Setup",
    "TextureLoader",
    "TokenDocument",
    "foundry",
  ].reduce((obj, str) => ({ ...obj, [str]: "readonly" }), {}),
  ...["CONFIG", "FilePicker"].reduce((obj, str) => ({ ...obj, [str]: "writable" }), {}),
};

export default defineConfig([
  globalIgnores(["**/node_modules", "**/dist"]),
  {
    extends: compat.extends(
      "eslint:recommended",
      "plugin:n/recommended",
      "plugin:prettier/recommended",
      "plugin:jsdoc/recommended"
    ),

    languageOptions: {
      globals: globalVars,
      ecmaVersion: 2023,
      sourceType: "module",
    },

    rules: {
      curly: "error",
      "jsdoc/check-tag-names": "error",
      "max-classes-per-file": "warn",
      "n/no-unsupported-features/es-builtins": "off",
      "n/no-unsupported-features/es-syntax": "off",
      "n/no-unsupported-features/node-builtins": "off",

      "n/no-sync": [
        "error",
        {
          allowAtRootLevel: true,
        },
      ],

      "no-await-in-loop": "off",
      "no-continue": "off",
      "no-else-return": "error",
      "no-plusplus": "off",
      "no-restricted-syntax": "off",
      "no-underscore-dangle": "off",

      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      "prefer-const": "error",
      "prefer-destructuring": "off",
      radix: "off",
    },
  },
]);
