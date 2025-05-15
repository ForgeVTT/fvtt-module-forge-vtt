import { ForgeVTT } from "./ForgeVTT.mjs";
import { ForgeVTT_FilePicker } from "./applications/ForgeVTTFilePicker.mjs";
import { ForgeVTT_FilePicker_V2 } from "./applications/ForgeVTTFilePickerV2.mjs";

export class ForgeCompatibility {
  /**
   * The global isNewerVersion will be removed in v14, so we need a utility function to alias to whichever is available.
   * @param {string} version The version to check
   * @param {string} target The version to check against
   * @returns {boolean} True when the version is newer than the target, false otherwise
   */
  static isNewerVersion(version, target) {
    try {
      return foundry.utils.isNewerVersion(version, target);
    } catch {
      return isNewerVersion(version, target);
    }
  }

  static get TextureLoader() {
    if (ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "13")) {
      return foundry.canvas.TextureLoader;
    }
    return TextureLoader;
  }

  static get ModuleManagement() {
    if (ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "13")) {
      return foundry.applications.sidebar.apps.ModuleManagement;
    }
    return ModuleManagement;
  }

  static get Module() {
    if (ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "13")) {
      return foundry.packages.Module;
    }
    return Module;
  }

  static get mergeObject() {
    if (ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "11")) {
      return foundry.utils.mergeObject;
    }
    return window.mergeObject;
  }

  static get getProperty() {
    if (ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "11")) {
      return foundry.utils.getProperty;
    }
    return window.getProperty;
  }

  /**
   * Depending on the Foundry version in use, override the appropriate file
   * picker with our own.
   */
  static prepareFilePicker() {
    let isV13Plus = false;
    if (typeof foundry !== "undefined" && foundry?.applications?.apps?.FilePicker) {
      isV13Plus = true;
    } else {
      // If we can't find the new FilePicker, we are likely on a version before 13
      isV13Plus = false;
    }
    // Select the appropriate file picker based on version
    const fpClass = isV13Plus ? ForgeVTT_FilePicker_V2 : ForgeVTT_FilePicker;

    // Set the file picker on the appropriate global object
    if (isV13Plus) {
      globalThis.CONFIG.ux.FilePicker = fpClass;
    } else {
      FilePicker = fpClass;
    }

    // Get a reference to the target object we're configuring
    const targetFP = isV13Plus ? globalThis.CONFIG.ux.FilePicker : FilePicker;
    this.#filepicker = targetFP;

    // Delay the rest of the setup to the init hook, when game etc... are available
    Hooks.once("init", () => {
      const lastBrowsedDir = game.settings.get("forge-vtt", "lastBrowsedDirectory");

      // Set the default directory
      targetFP.LAST_BROWSED_DIRECTORY = ForgeVTT.usingTheForge ? ForgeVTT.ASSETS_LIBRARY_URL_PREFIX : "";

      // Apply the lastBrowsedDir if needed
      if (lastBrowsedDir && targetFP.LAST_BROWSED_DIRECTORY === ForgeVTT.ASSETS_LIBRARY_URL_PREFIX) {
        targetFP.LAST_BROWSED_DIRECTORY = lastBrowsedDir;
      }
    });
  }

  static #filepicker = null;

  static get FilePicker() {
    if (!FilePicker) {
      throw new Error("The FilePicker has not yet been configured.");
    }
    return this.#filepicker;
  }
}
