import { ForgeVTT } from "./ForgeVTT.mjs";
import { ForgeAPI } from "./ForgeAPI.mjs";
import { ForgeCompatibility } from "./ForgeCompatibility.mjs";
import "./hooks.mjs";

ForgeVTT.setupForge();

globalThis.ForgeVTT = ForgeVTT;
globalThis.ForgeAPI = ForgeAPI;
globalThis.ForgeCompatibility = ForgeCompatibility;
globalThis.ForgeVTT_FilePicker = ForgeCompatibility.FilePicker;
