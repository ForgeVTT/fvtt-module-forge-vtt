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
   * @returns {ForgeVTT_FilePicker | ForgeVTT_FilePicker_V2} - The file picker
   * application that we plan to use.
   */
  static prepareFilePicker() {
    if (this.isNewerVersion(ForgeVTT.foundryVersion, "13")) {
      globalThis.CONFIG.ux.FilePicker = ForgeVTT_FilePicker_V2;
      return globalThis.CONFIG.ux.FilePicker;
    }
    globalThis.FilePicker = ForgeVTT_FilePicker;
    return globalThis.FilePicker;
  }
}
