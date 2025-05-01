import { ForgeVTT } from "./ForgeVTT.mjs";

Hooks.on("init", () => ForgeVTT.init());
Hooks.on("setup", () => ForgeVTT.setup());
Hooks.on("ready", () => ForgeVTT.ready());
Hooks.on("i18nInit", () => ForgeVTT.i18nInit());
