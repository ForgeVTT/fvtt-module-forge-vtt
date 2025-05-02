import { ForgeVTT } from "./ForgeVTT.mjs";
import { ForgeAPI } from "./ForgeAPI.mjs";
import "./hooks.mjs";

ForgeVTT.setupForge();

globalThis.ForgeVTT = ForgeVTT;
globalThis.ForgeAPI = ForgeAPI;
