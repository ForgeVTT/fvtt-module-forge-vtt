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
    if (version === undefined) {
      return false;
    }
    if (target === undefined) {
      return true;
    }
    try {
      return foundry.utils.isNewerVersion(version, target);
    } catch {
      return isNewerVersion(version, target);
    }
  }

  static Dialog = foundry?.appv1?.api?.Dialog || globalThis.Dialog;
  static FormApplication = foundry?.appv1?.api?.FormApplication || globalThis.FormApplication;
  static Module = foundry?.packages?.Module || globalThis.Module;
  static ModuleManagement = foundry?.applications?.sidebar?.apps?.ModuleManagement || globalThis.ModuleManagement;
  static TextureLoader = foundry?.canvas?.TextureLoader || globalThis.TextureLoader;

  static diffObject = foundry?.utils?.diffObject || globalThis.diffObject;
  static duplicate = foundry?.utils?.duplicate || globalThis.duplicate;
  static encodeURL = foundry?.utils?.encodeURL || globalThis.encodeURL;
  static getProperty = foundry?.utils?.getProperty || globalThis.getProperty;
  static getRoute = foundry?.utils?.getRoute || globalThis.getRoute;
  static mergeObject = foundry?.utils?.mergeObject || globalThis.mergeObject;

  static get chatMessageStyles() {
    if (ForgeVTT.isFoundryNewerThan("12")) {
      return CONST.CHAT_MESSAGE_STYLES;
    }
    return CONST.CHAT_MESSAGE_TYPES;
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
      globalThis.FilePicker = fpClass;
    }

    // Get a reference to the target object we're configuring
    const targetFP = isV13Plus ? globalThis.CONFIG.ux.FilePicker : globalThis.FilePicker;
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
    if (!this.#filepicker) {
      throw new Error("The FilePicker has not yet been configured.");
    }
    return this.#filepicker;
  }
}
