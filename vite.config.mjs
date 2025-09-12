import * as fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
const execPromise = promisify(exec);
import { defineConfig } from "vite";

const currentDate = new Date();
const currentYear = currentDate.getFullYear();

export default defineConfig({
  build: {
    rollupOptions: {
      input: "src/index.mjs",
      output: {
        dir: "dist",
        entryFileNames: "forgevtt-module.js",
        format: "umd",
      },
      watch: {
        exclude: ["**/node_modules/**"],
      },
    },
    sourcemap: true,
  },
  esbuild: {
    minifyIdentifiers: false,
    banner: `/**
 * Copyright (C) 2021-${currentYear} - The Forge VTT Inc.
 * Author: Youness Alaoui <kakaroto@forge-vtt.com>
 * This file is part of The Forge VTT.
 *
 * All Rights Reserved
 *
 * NOTICE:  All information contained herein is, and remains
 * the property of The Forge VTT. The intellectual and technical concepts
 * contained herein are proprietary of its author and may be covered by
 * U.S. and Foreign Patents, and are protected by trade secret or copyright law.
 * Dissemination of this information or reproduction of this material
 * is strictly forbidden unless prior written permission is obtained
 * from the author.
 */`,
  },
  publicDir: false,
  plugins: [copyBuildPlugin()],
});

/**
 * This Vite plugin gets the latest tag from Git and updates the module's manifest, using the tag
 * name as the version number.
 * @returns {Plugin} A Vite plugin for updating the module's manifest.
 */
// function updateManifestPlugin() {
//   return {
//     name: "update-manifest",
//     writeBundle: async () => {
//       // Read and parse the manifest
//       const manifestContents = await fs.readFile("module.json", "utf-8");
//       const manifestJSON = JSON.parse(manifestContents);
//       // Get latest git tag
//       let version = manifestJSON.version || "";
//       if (process.env.GITHUB_REF_NAME) {
//         console.log(`Using env var for version: ${process.env.GITHUB_REF_NAME}`);
//         version = process.env.GITHUB_REF_NAME;
//       } else {
//         await execPromise("git describe --tags").then(({ stdout }) => (version = stdout.trim()));
//       }

//       // Update manifest fields
//       manifestJSON.version = version.replace(/^v/, "");
//       manifestJSON.download = `https://github.com/ForgeVTT/fvtt-module-forge-vtt/releases/download/${version}/module.zip`;

//       // Write updated manifest
//       await fs.writeFile("module.json", JSON.stringify(manifestJSON, null, 2));
//     },
//   };
// }

/**
 * This Vite plugin copies all distributable files into the "package" directory
 * @returns {Plugin} A Vite plugin for updating the module's manifest.
 */
function copyBuildPlugin() {
  return {
    name: "copy-build",
    writeBundle: async () => {
      // Ensure no old build artefacts remain
      await fs.rmdir("package", { recursive: true }).catch(() => null);

      // Ensure thetarget directories exist
      await fs.mkdir("package/dist", { recursive: true }).catch(() => null);

      await Promise.all([
        fs.copyFile("dist/forgevtt-module.js", "package/dist/forgevtt-module.js"),
        fs.cp("images", "package/images", { recursive: true }),
        fs.cp("styles", "package/styles", { recursive: true }),
        fs.cp("templates", "package/templates", { recursive: true }),
        fs.copyFile("assets-sync.js", "package/assets-sync.js"),
        fs.copyFile("module.json", "package/module.json"),
      ]);
    },
  };
}
