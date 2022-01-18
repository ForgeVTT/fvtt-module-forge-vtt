/**
 * Copyright (C) 2021 - The Forge VTT Inc.
 * Author: Evan Clarke
 *         Youness Alaoui <kakaroto@kakaroto.ca>
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
 */


/**
 * @class ForgeAssetSync
 * Worker-class to reconcile Forge assets with local (ie. Foundry server) assets and download any missing files.
 * A worker should be instantiated anytime a unique reconciliation is needed.
 */
 class ForgeAssetSync {
    /**
     * Sync Status enum
     * @returns {Object} STATUSES
     */
     static SYNC_STATUSES = {
        READY: `Ready to Sync`,
        PREPARING: `Preparing Assets for Sync`,
        NOKEY: `Missing API Key. Please enter key in Module Settings then try again`,
        SYNCING: `Syncing Assets...`,
        POSTSYNC: `Cleaning up Sync Data`,
        DBREWRITE: `Updating game to use local assets...`,
        COMPLETE: `Sync Completed Successfully!`,
        WITHERRORS: `Sync Completed with Errors. Check console for more details.`,
        FAILED: `Failed to Sync. Check console for more details.`,
        CANCELLED: "Sync process Cancelled"
    };
    constructor(app=null, {forceLocalRehash=false, overwriteLocalMismatches=false, updateFoundryDb=false}={}) {
        // Number of retries to perform for error-prone operations
        this.retries = 2;

        // Array of matched local files
        this.localFiles = null;

        // Object containing local files and dirs
        this.localInventory = null;

        // Map of Name=>ForgeAssetSyncMapping
        this.assetMap = null;

        // Map of Hash=>etag[]
        this.etagMap = null;

        // Dictates whether all local files should be rehashed
        this.forceLocalRehash = forceLocalRehash;

        // Dictates if local files with mismatched hashes should be overwrittent
        this.overwriteLocalMismatches = overwriteLocalMismatches;

        // Dictates if the local game database needs to be rewritten to use local assets
        this.updateFoundryDb = updateFoundryDb;

        // Holds the current syncing status
        this.status = ForgeAssetSync.SYNC_STATUSES.READY;

        // Array of Assets that successfully synced
        this.syncedAssets = [];

        // Array of Assets that failed to sync
        this.failedAssets = [];

        // Reference the current Sync App instance
        this.app = app;
    }

    /**
     * Sets the sync status and updates the sync app
     * @param {String} status 
     */
    async setStatus(status) {
        this.status = status;
        if (this.app) return this.app.updateStatus(status);
    }

    /**
     * Sync orchestrator method
     */
    async sync() {

        /* ------------------------------- Preparation ------------------------------ */
        if (this.status !== ForgeAssetSync.SYNC_STATUSES.READY) throw new Error(`Sync already started`);
        
        await this.setStatus(ForgeAssetSync.SYNC_STATUSES.PREPARING);

        // 1. Does user have an API token set?
        const apiKey = game.settings.get("forge-vtt", "apiKey");

        if (!apiKey || !apiKey?.length) {
            await this.setStatus(ForgeAssetSync.SYNC_STATUSES.NOKEY);
            throw Error("Forge VTT | Asset Sync: please set an API Key in Settings before attempting to sync!");
        }
        // logging/notification
        console.log("Forge VTT | Asset Sync: starting sync");
        // 2. get the existing mapping
        const {etagMap, assetMap} = await ForgeAssetSync.fetchAssetMap({retries: this.retries});
        this.assetMap = assetMap;
        this.etagMap = etagMap;

        if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) return;
        /* ----------------------------- Reconciliation ----------------------------- */

        // 1. get Forge inventory
        const {forgeDirMap, forgeFileMap} = await this.buildForgeInventory();
        const forgeDirSet = new Set(forgeDirMap.keys());
        const forgeFileSet = new Set(forgeFileMap.keys());

        if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) return;
        // 2. Build Local inventory
        this.localInventory = await this.buildLocalInventory(forgeDirSet);
        const {localDirSet, localFileSet} = this.localInventory;

        if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) return;
        // look for missing dirs
        const missingDirs = ForgeAssetSync.reconcileSets(forgeDirSet, localDirSet);

        let createdDirCount = 0;

        this.app.updateProgress({current: 0, name: "", total: missingDirs.size, step: "Creating missing folders", type: "Folder"});
        for (const dir of missingDirs) {
            const createdDir = await this.createDirectory(dir, {retries: this.retries});
            if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) {
                return this.updateMapFile();
            }
            if (createdDir) createdDirCount++;
            this.app.updateProgress({current: createdDirCount, name: dir});
        }

        if (createdDirCount !== missingDirs.size) {
            throw Error("Forge VTT | Asset Sync failed: Could not create necessary directories in Foundry server!")
        }

        if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) {
            return this.updateMapFile();
        }
        this.setStatus(ForgeAssetSync.SYNC_STATUSES.SYNCING);
        const {synced, failed} = await this.assetSyncProcessor(forgeFileMap, localFileSet);

        // logging/notification
        console.log(`Forge VTT | Asset Sync complete. ${synced.length + failed.length} assets processed.${failed?.length ? ` ${failed.length} failed to sync` : ``}`);
        
        if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) {
            return this.updateMapFile();
        }
        this.setStatus(ForgeAssetSync.SYNC_STATUSES.POSTSYNC);

        // update map
        await this.updateMapFile();
        if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) return;
        if (!synced.length && failed.length) return this.setStatus(ForgeAssetSync.SYNC_STATUSES.FAILED);
        else if (synced.length && failed.length) return this.setStatus(ForgeAssetSync.SYNC_STATUSES.WITHERRORS);

        let rewriteErrors = false;
        if (this.updateFoundryDb) {
            this.setStatus(ForgeAssetSync.SYNC_STATUSES.DBREWRITE);
            const migration = new WorldMigration(this.app, forgeFileMap);
            const success = await migration.migrateWorld();
            if (!success) {
                rewriteErrors = true;
                new Dialog({title: "World database conversion", content: migration.errorMessage, buttons: {ok: {label: "OK"}}}).render(true);
            }
        }
        if (rewriteErrors) return this.setStatus(ForgeAssetSync.SYNC_STATUSES.WITHERRORS);
        this.setStatus(ForgeAssetSync.SYNC_STATUSES.COMPLETE);
    }

    async cancelSync() {
        this.setStatus(ForgeAssetSync.SYNC_STATUSES.CANCELLED);
    }

    async updateMapFile() {
        const mapFileData = this.buildAssetMapFileData();
        return ForgeAssetSync.uploadAssetMapFile(mapFileData);
    }

    /**
     * Processes syncing tasks for a given Forge assets 
     * @param {Map} assets
     * @param {Set} localFiles
     * @returns {Promise<Object>} Object containing synced and failed assets
     */
    async assetSyncProcessor(assets, localFiles) {
        if (!assets || !localFiles) {
            throw Error(`Forge VTT | Asset Sync could not process assets`);
        }

        const synced = [];
        const failed = [];
        let assetIndex = 1;

        this.app.updateProgress({current: 0, name: "", total: assets.size, step: "Synchronizing assets", type: "Asset"});
        for (const [key, asset] of assets) {
            if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) break;
            try {

                // Check if there is a local file match for this asset
                const localFileExists = localFiles.has(encodeURL(asset.name));

                // If there is, jump to the reconcile method
                if (localFileExists) {
                    await this.reconcileLocalMatch(asset);
                } else {
                    // If not, the asset needs to be fully synced
                    await this.syncAsset(asset);
                }
                this.app.updateProgress({current: assetIndex, name: asset.name});

                // If all is good, mark the asset as synced
                // @todo maybe predicate this on receiving a "true" from previous methods?
                synced.push(asset);
            } catch (error) {
                console.warn(error);
                // If any errors occured mark the asset as failed and move on
                failed.push(asset);
            }

            assetIndex++;
        }

        return {synced, failed}
    }

    _updateAssetMapping(asset, etag) {
        const assetMapping = this.assetMap.get(asset.name);
        const newMapRow = ForgeAssetSync.buildMappingRow(asset, {etag: etag, hash: asset.hash});
        if (assetMapping) newMapRow.firstSyncDate = assetMapping.firstSyncDate;
        this.assetMap.set(asset.name, newMapRow);
    }
    _updateEtagMapping(hash, etag) {
        const etagValues = this.etagMap.get(hash) || new Set();
        etagValues.add(etag);
        this.etagMap.set(hash, etagValues);
    }
    /**
     * Verifies that the local file corresponding to an asset matches the expected hash from the remote asset
     * 
     * @returns              true if they match
     */
    async _verifyLocalFileMatchesRemote(asset, expectedEtag, etag) {
        const etagValues = this.etagMap.get(asset.hash) || new Set();
        // Verify if the local file has one of the expected etags for this asset
        if (expectedEtag === etag || etagValues.has(etag)) {
            return true;
        } else if (!expectedEtag) {
            // We don't know the exact etag to expect, so let's hash the file instead
            const localHash = await ForgeAssetSync.fetchLocalHash(asset.name);
            // Save the etag for this hash
            this._updateEtagMapping(localHash, etag);
            // Verify if the hashes match
            if (localHash === asset.hash) {
                return true;
            }
        }
        return false;
    }
    /**
     * Reconcile a Forge Asset with a Local File
     * If local file exists, then it's either from a previous sync and needs to be ignored/updated,
     * or it's not from a previous sync and needs to be ignored/overwritten
     * @param {*} asset 

     * @returns {Promise<Boolean>} Asset Reconciled
     */
    async reconcileLocalMatch(asset) {
        // Get mapped data for this asset
        const assetMapping = this.assetMap.get(asset.name);
        const expectedEtag = assetMapping && assetMapping.localHash === asset.hash ? assetMapping.localEtag : null;

        // If an asset mapping exists, then the file comes from a previous sync
        if (!this.forceLocalRehash && assetMapping) {
            // Asset has not been modified remotely, don't do anything
            if (assetMapping.forgeHash === asset.hash) return true;
            // Asset has been modified remotely, compare with local hash
            const etag = await ForgeAssetSync.fetchLocalEtag(asset.name);
            // If the local file is the same as the remote, then no need to sync
            const matches = await this._verifyLocalFileMatchesRemote(asset, expectedEtag, etag);
            if (matches) {
                this._updateAssetMapping(asset, etag);
                return true;
            }
            if (!this.overwriteLocalMismatches) {
                // If local etag changed, file was modified locally, do not overwrite
                if (etag !== assetMapping.localEtag) {
                    console.log(`Conflict detected: ${asset.name} has been modified both locally and remotely`);
                    return false;
                }
            }
            return this.syncAsset(asset);
        } else {
            // File doesn't come from a previous sync (or we force a local rehash)
            // If we're not overwriting local files and we're not re-hashing existing ones, then we're done
            if (!this.forceLocalRehash && !this.overwriteLocalMismatches) return false;
            const etag = await ForgeAssetSync.fetchLocalEtag(asset.name);

            // If the local file is the same as the remote, then consider it 'synced' and keep track of it for the future
            const matches = await this._verifyLocalFileMatchesRemote(asset, expectedEtag, etag);
            if (matches) {
                this._updateAssetMapping(asset, etag);
                return true;
            }
            // If the local file is different from the remote, then overwrite or mark as conflict
            if (this.overwriteLocalMismatches || (assetMapping && etag === assetMapping.localEtag)) {
                return this.syncAsset(asset);
            } else {
                // If local etag changed, file was modified locally, do not overwrite
                console.log(`Conflict detected: ${asset.name} exists locally and is different from the expected remote asset`);
                return false;
            }
        }
        
        return true;
    }

    /**
     * Fully sync a Forge asset
     * 1. Download the Asset blob
     * 2. Upload the Asset to Foundry server
     * 3. Fetch the new file's etag
     * 4. Update asset map
     * 5. Update etag map
     * @param {*} asset 
     */
    async syncAsset(asset) {
        const assetMap = this.assetMap;
        const etagMap = this.etagMap;

        // Fetch the Forge asset blob
        const blob = await ForgeAssetSync.fetchBlobFromUrl(asset.url, {retries: this.retries});

        // Upload to Foundry
        const upload = await ForgeAssetSync.uploadAssetToFoundry(asset, blob);

        // Fetch the etag of the uploaded file
        const etag = await ForgeAssetSync.fetchLocalEtag(asset.name);

        // Insert/Update Asset Mapping row
        const localFileData = {etag: etag, hash: asset.hash};
        const assetMapRow = assetMap.get(asset.name);
        const newAssetMapRow = ForgeAssetSync.buildMappingRow(asset, localFileData);

        if (assetMapRow) newAssetMapRow.firstSyncDate = assetMapRow.firstSyncDate;

        assetMap.set(newAssetMapRow.forgeName, newAssetMapRow);

        // Insert/Update a Etag mapping Row
        const etagValues = etagMap.get(asset.hash) || new Set();
        etagValues.add(etag);
        etagMap.set(asset.hash, etagValues);

        return true;
    }

    /**
     * Creates a new ForgeAssetSyncMapping instance with the provided data
     * @todo error handling
     * @param {*} asset 
     */
    static buildMappingRow(assetData={}, localFileData={}) {
        return {
            forgeName: assetData?.name,
            forgeHash: assetData?.hash,
            localEtag: localFileData?.etag,
            localHash: localFileData?.hash,
            firstSyncDate: new Date(),
            lastSyncDate: new Date()
        };
    }

    // compare inventories
    /**
     * Reconcile a source inventory with the target
     * Returns any missing assets
     * @param {Set} source A Set of keys from an Asset Inventory
     * @param {Set} target A Set of keys from an Asset Inventory
     * @returns {Set} a Set of missing assets
     */
    static reconcileSets(source, target) {
        if (!source || !target) {
            return;
        }

        const missing = new Set();

        // iterate through the source
        for (const item of source) {
            if (!target.has(item)) {
                missing.add(item);
            }
        }

        return missing;
    }

    /**
     * Call the Forge API and retrieve asset list
     * @returns {Array} Array of Forge Assets
     */
    static async getForgeAssets() {
        const assetsResponse = await ForgeAPI.call("assets");

        if (!assetsResponse || assetsResponse.error) {
            const error = assetsResponse?.error || `Forge VTT | Asset Sync: Unknown error occurred communicating with the Forge API`;
            ui.notifications.error(error);
            throw new Error(error);
        }

        if (assetsResponse.assets.length === 0) {
            ui.notifications.warn(`You have no assets in your Forge Assets Library`);
        }


        return assetsResponse.assets;
    }    

    /**
     * Build Forge file inventory, keyed on Name (Asset Path)
     * @returns {Promise<Object>} Object containing two Maps of Name=>ForgeAsset -- one for dirs and one for files
     */
    async buildForgeInventory() {
        const forgeAssets = await ForgeAssetSync.getForgeAssets();
        
        if (!forgeAssets) throw new Error("Could not error Forge VTT Assets Library content");;

        const forgeDirMap = new Map();
        const forgeFileMap = new Map();

        for (const asset of forgeAssets) {
            if (!asset.name) continue;
            asset.name = ForgeAssetSync.sanitizePath(asset.name);
            if (asset.name.endsWith("/")) forgeDirMap.set(asset.name, asset);
            else forgeFileMap.set(asset.name, asset); 
        }

        return {forgeDirMap, forgeFileMap};
    }

    /**
     * Build local inventory of dirs and files based on a set of reference assets (eg. Forge assets)
     * @returns {Promise<Object>} LocalInventory -- contains a list of dirs and a list of file paths
     */
    async buildLocalInventory(referenceDirs) {
        referenceDirs = referenceDirs || new Set();
        // Add the root dir to the reference list
        referenceDirs.add("/");

        const localFileSet = new Set();
        const localDirSet = new Set();
        
        let dirIndex = 1;
        this.app.updateProgress({current: 0, name: "", total: referenceDirs.size, step: "Listing local files", type: "Folder"});
        // use filepicker.browse to check in the paths provided in referenceassets
        for (const dir of referenceDirs) {
            try {
                const fp = await FilePicker.browse("data", dir);
                this.app.updateProgress({current: dirIndex, name: dir});
                
                dirIndex++;
                if (!fp || decodeURIComponent(fp.target) !== dir) continue;

                localDirSet.add(dir);
                fp.files.forEach(f => localFileSet.add(f));
            } catch (error) {
                if (error.match("does not exist")) continue;
                else throw Error(error);
            }
            
        }

        return { localDirSet, localFileSet };
    }

    /**
     * Use Fetch API to get the etag header from a local file
     * @param {*} path 
     * @todo add error handling
     */
    static async fetchLocalEtag(path) {
        const headers = new Headers();
        let etag;
        const request = await fetch(`/${encodeURL(path)}`, {
            method: "HEAD",
            headers
        });

        etag = request?.headers?.get("etag");

        return etag;
    }

    /**
     * Get the hash for a local file
     * @param {String} path 
     */
    static async fetchLocalHash(path) {
        try {
            const request = await fetch(`/${path}`, {
                method: "GET",
                headers: new Headers()
            });

            if (!request.ok) {
                if (request.status === 404) {
                    throw new Error(`Asset ${path} not found`);
                }

                throw new Error(`An error occurred fetching this asset: ${path}`);
            }

            const blob = await request?.blob();

            if (blob) return await ForgeVTT_FilePicker.etagFromFile(blob);

        } catch(error) {
            console.warn(error);
        }
    }

    // build etag inventory

    // check/update mapping

    /**
     * Fetch the Asset Map file from the Foundry server
     * @todo maybe implement a proper custom exception method to throw and catch?
     */
    static async fetchAssetMap({retries=0}={}) {
        let errorType = null;
        let assetMap = new Map();
        let etagMap = new Map();

        try {
            const request = await fetch("/forge-assets.json");

            if (!request.ok) {
                switch (request.status) {
                    case 404:
                        errorType = `notfound`;
                        throw new Error(`Forge VTT | Asset Mapping file not found, but will be created with a successful sync.`);
                
                    default:
                        // @todo error handling -- maybe retry?
                        errorType = `unknown`;
                        throw new Error(`Forge VTT | Server error retrieving Forge Asset map!${retries ? ` Retrying...` : ``}`);
                }
            }

            const mapJson = await request.json().catch(err => null);
            
            if (!mapJson || (!mapJson.etags && !mapJson.assets)) {
                errorType = `empty`;
                throw new Error("Forge VTT | Asset Mapping file is empty.");
            }

            for (const row of mapJson.etags) {
                try {
                    etagMap.set(row.hash, new Set(row.etags));
                } catch (err) {}
            }

            for (const asset of mapJson.assets) {
                assetMap.set(asset.forgeName, asset);
            }

        } catch(error) {
            switch (errorType) {
                case `notfound`:
                case `empty`:
                    console.log(error);
                    break;

                case `unknown`:
                    console.warn(error);

                    if (retries > 0) {
                        return ForgeAssetSync.fetchAssetMap({retries: retries - 1});
                    }
            
                default:
                    throw new Error(error);
            }
        }

        return {etagMap, assetMap};
    }



    /**
     * Constructs an object for casting into a JSON and uploading
     * @returns {Object} Mapping File Data
     */
    buildAssetMapFileData() {
        // Coerce Asset/etag Maps into arrays for JSON-ifying
        const assetMapArray = this.assetMap instanceof Map ? [...this.assetMap.values()] : (this.assetMap instanceof Array ? this.assetMap : []);
        const etagMapArray = [];
        
        for (const [key, value] of this.etagMap) {
            try {
                if (key) etagMapArray.push({hash: key, etags: Array.from(value)});
            } catch (err) {}
        } 

        return {assets: assetMapArray, etags: etagMapArray}
    }

    /**
     * Upload Asset Mapping file from the provided map.
     */
    static async uploadAssetMapFile(fileData) {
        if (!fileData) {
            return false;
        }

        const fileName = "forge-assets.json";
        const fileType = "application/json";
        const file = new File([JSON.stringify(fileData, null, 2)], fileName, {type: fileType});

        try {
            const result = FilePicker.upload("data", "/", file, {}, {notify: false});
            console.log(`Forge VTT | Asset mapping file upload succeeded.`)
            return result;
        } catch (error) {
            console.warn(`Forge VTT | Asset mapping file upload failed. Please try sync again.`)
            return false;
        }
        
    }

    /**
     * Download a single asset blob from its URL
     * @param {URL} url - the URL of the Asset to fetch a Blob of
     * @returns {Promise<Blob>} A Promise resolving to the Asset's Blob
     */
    static async fetchBlobFromUrl(url, {retries=0}={}) {
        if (!url) throw new Error(`Forge VTT | Asset Sync: no URL provided for Blob download`);

        try {
            const imageExtensions = isNewerVersion(ForgeVTT.foundryVersion, "9.0") ? Object.keys(CONST.IMAGE_FILE_EXTENSIONS) : CONST.IMAGE_FILE_EXTENSIONS;
            const isImage = imageExtensions.some(e => url.endsWith(e));
            const queryParams = isImage ? `?optimizer=disabled` : ``;
            const request = await fetch(`${url}${queryParams}`);

            if (!request.ok) {
                throw new Error(`Forge VTT | Failed to download asset file from The Forge`);
            }

            return await request.blob();
        } catch(error) {
            console.warn(error);
            if (retries > 0) return ForgeAssetSync.fetchBlobFromUrl(url, {retries: retries - 1});
        }
    }

    /**
     * Upload an Asset to Foundry
     * @param {ForgeAsset} asset 
     * @param {Blob} blob 
     */
    static async uploadAssetToFoundry(asset, blob) {     
        if (!asset) throw new Error(`Forge VTT | No Asset provided for uploading to Foundry.`);
        if (!asset.name) throw new Error(`Forge VTT | Asset with URL ${asset.url} has no name and cannot be uploaded.`);
        if (asset.name.endsWith("/")) throw new Error(`Forge VTT | Asset with URL ${asset.url} appears to be a folder.`);
        if (!blob) throw new Error(`Forge VTT | No Blob data provided for ${asset.name} and therefore it cannot be uploaded to Foundry.`);
        
        try {
            const nameParts = asset.name.split("/");
            const fileName = nameParts.pop();
            const path = `/${nameParts.join("/")}`;
            const file = new File([blob], fileName, {type: blob.type});
            const upload = await FilePicker.upload("data", path, file, {}, {notify: false});

            return upload;
        } catch (error) {
            console.warn(error);
        }   
    }

    /**
     * For a given path, create the recursive directory tree necessary to reach the path
     * @param {String} path 
     */
    async createDirectory(path, {retries=0}={}) {
        path = path.replace(/\/+$|^\//g, "").replace(/\/+/g, "/");

        const pathParts = path.split("/");

        for (let i = 0; i < pathParts.length; i++) {
            const subPath = pathParts.slice(0, i + 1).join("/") + "/";
            const pathExists = this.localPathExists(subPath);

            if (!pathExists) {
                try {
                    await FilePicker.createDirectory("data", subPath);
                    this.localInventory.localDirSet.add(subPath);

                    return true;
                } catch (error) {
                    const message = error.message ?? error;
                    if (message.includes("EEXIST:")) {
                        // There might be a case where the folder already exists, especially in the case of Windows
                        // where the case sensitivity could cause folder `music` to be created and `Music` to fail because
                        // it already exists.
                        this.localInventory.localDirSet.add(subPath);
                        return true;
                    }
                    console.warn(error);

                    if (retries > 0) return this.createDirectory(path, {retries: retries - 1});
                    else return false;
                }
            }
        }
    }
     
    /**
     * Checks for the existence of a local path using the provided comparison path
     * @param {String} path 
     * @returns {Boolean} pathExists
     */ 
    localPathExists(path) {
        return !!(this.localInventory?.localDirSet?.has(path) || this.localInventory?.localFileSet?.has(path));
    }

    /**
     * Sanitises a given path, removing extraneous slashes and other problematic characters for Windows OS
     * @see https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file#naming-conventions
     * @param {*} path 
     * @returns 
     */
    static sanitizePath(path) {
        path = path.replace(/\:+/g, "_58_")
            .replace(/\<+/g, "_60_")
            .replace(/\>+/g, "_62_")
            .replace(/\"+/g, "_34_")       
            .replace(/\|+/g, "_124_")
            .replace(/\?+/g, "_63_")
            .replace(/\*+/g, "_42_")
            // Slashes should be handled elsewhere
            // .replace(/)
            // .replace(\)

        return path;
    }
}


/**
 * @class ForgeAssetSyncApp
 * Forge Asset Sync Application
 * This app spawns an instance of ForgeAssetSync and calls the `sync` method when the Sync button is clicked.
 * This class must derive from FormApplication so it can be registered as a settings menu
 */
class ForgeAssetSyncApp extends FormApplication {
    constructor(data, options) {
        super(data,options);

        /**
         * A boolean to capture if there is a sync in progress
         */
        this.isSyncing = false;

        /**
         * The current status of the sync. Values pulled from ForgeAssetSync.SYNC_STATUSES.
         */
        this.currentStatus = ForgeAssetSync.SYNC_STATUSES.READY;

        /**
         * The currently processed Asset
         */
        this.currentAsset = ``;
        this.currentAssetIndex = 0;
        this.currentSyncStep = "";
        this.currentAssetType = "Asset";
        this.totalAssetCount = 1;

        /**
         * The general status of the sync to be used for determining which icon/animation to display
         */
        this.syncStatusIcon = `ready`

        /**
         * Last timestamp where the UI was refresh for progress bar purposes.
         * This will limit the refreshes to 1 per second instead of as much as the CPU can take. Without throttling it, the UI becomes unusable.
         */
        this._lastRefresh = 0;

        /**
         * Options For Sync
         */
        this.syncOptions = [
            {
                name: "overwriteLocalMismatches",
                htmlName: "overwrite-local-mismatches",
                checked: false,
                label: "Overwrite Mismatched Local Files",
                disabled: false
            },
            {
                name: "forceLocalRehash",
                htmlName: "force-local-rehash",
                checked: false,
                label: "Force resync (ignores assets cache)",
                disabled: false
            },
            {
                name: "updateFoundryDb",
                htmlName: "update-foundry-db",
                checked: false,
                label: "Update Foundry World & Compendiums to use Local Assets",
                disabled: false
            }
        ]
    }

    /**
     * Get the default options for the Application, merged with the super's
     */
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: `forgevtt-asset-sync`,
            title: `Forge VTT - Asset Sync`,
            template: `modules/forge-vtt/templates/asset-sync-form.hbs`,
            resizable: true,
            width: 500,
            height: "auto"
        });
    }

    /**
     * Builds the syncProgress property
     */
    get syncProgress() {
        
        return {
            value: ((this.currentAssetIndex / this.totalAssetCount) || 0).toFixed(2) * 100,
            countValue: this.currentAssetIndex || 0,
            countMax: this.totalAssetCount || 0,
            step: this.currentSyncStep || "",
            type: this.currentAssetType || "Asset"
        }
    }
    
    /**
     * Get data for template rendering
     * @returns 
     */
    getData() {
        const apiKey = game.settings.get("forge-vtt", "apiKey");

        if (!apiKey) {
            this.currentStatus = ForgeAssetSync.SYNC_STATUSES.NOKEY;
            ui.notifications.error(ForgeAssetSync.SYNC_STATUSES.NOKEY);
            this.syncStatusIcon = `failed`;
        }
        let iconClass = null;
        
        if (this.syncStatusIcon === "ready")
            iconClass = "fas fa-clipboard-check";
        if (this.syncStatusIcon === "complete")
          iconClass = "fas fa-check";
        if (this.syncStatusIcon === "failed")
          iconClass = "fas fa-times";
        if (this.syncStatusIcon === "witherrors")
          iconClass = "fas fa-exclamation";
        
        const syncButtonText = this.isSyncing ? "Cancel" : "Sync";
        const syncButtonIcon = this.isSyncing ? "fas fa-ban" : "fas fa-sync";
        return {
            canSync: true,
            isSyncing: this.isSyncing,
            currentStatus: this.currentStatus,
            currentAsset: this.currentAsset,
            syncButtonIcon: syncButtonIcon,
            syncButtonText: syncButtonText,
            syncOptions: this.syncOptions,
            syncProgress: this.syncProgress,
            syncStatusIcon: this.syncStatusIcon,
            syncStatusIconClass: iconClass,
        }
    }

    async updateProgress({current, name, total, step, type}={}) {
        if (total !== undefined) {
            this.totalAssetCount = total;
        }
        if (name !== undefined) {
            this.currentAsset = name;
        }
        if (current !== undefined) {
            this.currentAssetIndex = current;
        }
        if (step !== undefined) {
            this.currentSyncStep = step;
        }
        if (type !== undefined) {
            this.currentAssetType = type;
        }
        if (this._lastRefresh < Date.now() - 1000) {
            await this.render();
            this._lastRefresh = Date.now();
        }
    }

    /**
     * Update the Sync status with the provided status data
     * @param {*} status 
     */
    async updateStatus(status) {
        this.currentStatus = status;

        switch (status) {
            case ForgeAssetSync.SYNC_STATUSES.SYNCING:
            case ForgeAssetSync.SYNC_STATUSES.PREPARING:
            case ForgeAssetSync.SYNC_STATUSES.POSTSYNC:
            case ForgeAssetSync.SYNC_STATUSES.DBREWRITE:
                this.syncStatusIcon = `syncing`;
                this.isSyncing = true;
                break;

            case ForgeAssetSync.SYNC_STATUSES.COMPLETE:
                this.syncStatusIcon = `complete`;
                this.isSyncing = false;
                break;

            case ForgeAssetSync.SYNC_STATUSES.CANCELLED:
                this.syncStatusIcon = `ready`;
                this.isSyncing = false;
                break;
            
            case ForgeAssetSync.SYNC_STATUSES.NOKEY:
            case ForgeAssetSync.SYNC_STATUSES.FAILED:
                this.syncStatusIcon = `failed`;
                this.isSyncing = false;
                break;

            case ForgeAssetSync.SYNC_STATUSES.WITHERRORS:
                this.syncStatusIcon = `witherrors`;
                this.isSyncing = false;
                break;

            default:
                break;
        }
        
        return this.render();
    }

    /**
     * Activate Listeners for the app
     * @param {jQuery} html the HTML of the app
     */
    activateListeners(html) {
        const syncButton = html.find("button[name='sync']");
        const optionInputs = html.find("div.options input");

        syncButton.on("click", event => this._onClickSyncButton(event, html));
        optionInputs.on("click", event => this._onClickOption(event, html));
    }

    /**
     * Handle Sync Button Click
     * @param {Event} event the event that spawned this handler
     * @param {jQuery} html the HTML of the app
     */
    async _onClickSyncButton(event, html) {
        if (this.syncWorker) return this.cancel();

        // Get the values of the option boxes
        const optionInputs = html.find("div.options input");
        const options = {};
        optionInputs.each((i, el) => {
            if (el?.dataset?.optionName) options[el.dataset.optionName] = hasProperty(el, "checked") ? el.checked : el.value;
        });

        try {
            this.syncWorker = new ForgeAssetSync(this, options);
            await this.syncWorker.sync();
        } catch (error) {
            console.warn(error);
            await this.updateStatus(ForgeAssetSync.SYNC_STATUSES.FAILED);
        } finally {
            this.syncWorker = null;
            await this.render();
        }
        
    }

    /**
     * Click Option Handler
     * @param {*} event 
     * @param {*} html 
     */
    _onClickOption(event, html) {
        const optionName = event.currentTarget?.dataset?.optionName;

        if (!optionName) return;

        const option = this.syncOptions.find(o => o.name === optionName);

        if (!option) return;

        option.checked = event.currentTarget.checked;
    }

    cancel() {
        if (this.syncWorker)
            this.syncWorker.cancelSync();
        this.updateProgress({current: 0, name: "", total: 0, step: "", type: "Asset"});
        this.syncWorker = null;
    }
    close(...args) {
        super.close(...args);
        this.cancel();
    }
}


class WorldMigration {
    constructor(app, assets, assetsPrefix=null) {
        this.app = app;
        this.assetsPrefix = assetsPrefix || ForgeVTT.ASSETS_LIBRARY_URL_PREFIX;
        this.assets = assets;
        // migrator that is used to migrate an entity
        this.migrator = new EntityMigration(this._migrateEntityPath.bind(this));
        // Cache the dir listing of data folder
        this._cachedBrowse = {};
        // Cache the dir listing of data folder, with extension filter for files with no extensions
        this._cachedBrowseNoExt = {};
        // List of assets that were not migrated
        this._onlineAssets = new Set();
        // List of packages that are referenced but not installed locally
        this._missingPackages = new Set();
        // Store whethere the world metadata itself needs an update which could not be performed
        this._metadataNeedsUpdate = false;
    }

    get errorMessage() {
        let messages = [];
        if (this._metadataNeedsUpdate) {
            messages.push("The world metadata (background image or world description) needs to be updated manually.");
        }
        if (this._missingPackages.size) {
            messages.push("The following packages (modules or systems) are not installed locally but were used by this world.");
            messages.push(...Array.from(this._missingPackages).map(n => `&nbsp;&nbsp;&nbsp;&nbsp;<em>${n}</em>`));
            messages.push("Make sure to install them and re-run the sync process.")
        }
        if (this._onlineAssets.size) {
            messages.push("This world still refers to assets which are not in your assets library, and will not be usable in an offline environment.");
            messages.push("This assets might have been deleted, or in someone else's assets library or simply links to an external image.");
            messages.push(...Array.from(this._onlineAssets).map(n => `&nbsp;&nbsp;&nbsp;&nbsp;<a href="${n}" target="_blank">${n}</a>`));
        }
        return messages.reduce((m, l) => `${m}<p>${l}</p>`, "")
    }

    async _doesDirectoryExist(path, directory) {
        const listing = this._cachedBrowse[path] || await FilePicker.browse("data", path);
        if (listing.target !== path) return false;
        this._cachedBrowse[path] = listing;
        return listing.dirs.includes(path ? `${path}/${directory}` : directory);
    }
    async _doesFileExist(path, filename) {
        // Foundry does not include files with no extensions in the listing, so need to use a trick to make it happen, and keep two caches
        let listing;
        if (filename.includes(".")) {
            listing = this._cachedBrowse[path] || await FilePicker.browse("data", path);
            if (listing.target !== path) return false;
            this._cachedBrowse[path] = listing;
        } else {
            listing = this._cachedBrowseNoExt[path] || await FilePicker.browse("data", path, {extensions: [""]});
            if (listing.target !== path) return false;
            this._cachedBrowseNoExt[path] = listing;
        }
        return listing.files.includes(path ? `${path}/${filename}` : filename);
    }
    async _createDir(path, directory) {
        const ret = await FilePicker.createDirectory("data", path ? `${path}/${directory}` : directory);
        this._cachedBrowse[path] = null;
        this._cachedBrowseNoExt[path] = null;
        return ret;
    }


    async _editWorld(data) {
        return fetch(getRoute("setup"), {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({action: "editWorld", name: this.name, ...data})
        }).then(r => r.json());
    }
    // Creates directories in the path for an asset file but safely renames a folder if a file with
    // the same name exists (which can happen because of exports with symlinked folders)
    // Returns the new path for the asset
    async _safeMkdirpAsset(path, conflictSuffix="_") {
        const parts = path.split("/");
        const folders = parts.slice(0, -1);
        const filename = parts.slice(-1)[0];
        let subPath = "";
        for (let idx = 0; idx < folders.length; idx++) {
            const folder = decodeURI(folders[idx]);
            const newSubPath = subPath ? `${subPath}/${folder}` : folder;
            folders[idx] = folder;
            if (!await this._doesDirectoryExist(subPath, folder)) {
                if (await this._doesFileExist(subPath, folder)) {
                    // Add suffix to the folder and retry this same index
                    folders[idx] += conflictSuffix;
                    idx--;
                    continue;
                }
                await this._createDir(subPath, folder)
            }
            subPath = newSubPath;
        }
        return [...folders, filename].join("/");
    }
    splitPath(path) {
        const parts = path.split("/");
        const folders = parts.slice(0, -1);
        const filename = parts.slice(-1)[0];
        return [folders.join("/"), filename];
    }

    async migrateWorld() {
        const manifest = duplicate(game.world.data || game.world);
        this.name = manifest.name;

        const background = await this._migrateEntityPath(manifest.background);
        const description = await this.migrator._migrateHTML(manifest.description);
        this._metadataNeedsUpdate = false;
        if (manifest.background !== background || manifest.description !== description) {
            const response = await this._editWorld({background, description});
            this._metadataNeedsUpdate = !!response.error;
            if (response.error) {
                console.error("Failed to modify the background/description of the world to use the local asset", response.error);
            }
        }

        let idx = 0;
        this.app.updateProgress({current: 0, name: "", total: 9, step: "Migrating world content", type: "Database"});
        for (let collection of [game.actors, game.messages, game.items, game.journal,
                            game.macros, game.playlists, game.scenes, game.tables, game.users]) {
            if (!collection) continue;
            const dbType = collection.documentName || collection.entity; // 0.8.x vs 0.7.x
            if (!dbType) continue;
            this.app.updateProgress({current: idx++, name: collection.name});
            try {
                const entities = collection.contents || collection.entities; // v9 vs 0.8.x
                await this._migrateDatabase(entities, dbType);
            } catch (err) {
                console.error(`Error migrating ${dbType}s database : `, err);
            }
        }
        this.app.updateProgress({current: 0, name: "", total: game.packs.size, step: "Migrating compendium packs", type: "Compendium"});
        idx = 0;
        for (let pack of game.packs) {
            const dbType = pack.documentName || pack.entity; // 0.8.x vs 0.7.x
            if (!dbType) continue;
            this.app.updateProgress({current: idx++, name: pack.title});
            try {
                const entities = await (pack.getDocuments || pack.getEntities).call(pack);
                await this._migrateDatabase(entities, dbType, {pack: pack.collection});
            } catch (err) {
                console.error(`Error migrating ${dbType}s compendium : `, err);
            }
        }
        if (this._onlineAssets.size) {
            console.log("Assets that are not available offline : ", this._onlineAssets);
        }
        if (this._missingPackages.size) {
            console.log("Referenecd packages that are not installed locally : ", this._missingPackages);
        }
        return !this._metadataNeedsUpdate && this._onlineAssets.size === 0 && this._missingPackages.size === 0;
    }

    async _migrateDatabase(entities, type, options) {
        const migrated = await EntityMigration.mapAsync(entities, async (entity) => {
            try {
                const dataJson = JSON.stringify(entity.data);
                const migrated = await this._migrateEntity(type, JSON.parse(dataJson));
                // Instead of trying to recursively compare the entity before/after migration
                // we just compare their string representation
                if (JSON.stringify(migrated) === dataJson) return null;
                const diff = diffObject(entity.data, migrated);
                diff._id = migrated._id;
                return diff;
            } catch (err) {
                console.error(err);
                return null;
            }
        })
        const changes = migrated.filter(d => !!d);
        if (changes.length) {
            const klass = CONFIG[type].documentClass || CONFIG[type].entityClass;  // v9 vs 0.8.x
            const updateMethod =  (klass.updateDocuments || klass.update).bind(klass); // v9 vs 0.8.x
            try {
                await updateMethod(changes, options);
            } catch (err) {
                // Error in the update, maybe one entity has bad data the server rejects. 
                // Do them one at a time, to make sure as many valid entities are migrated
                for (const change of changes) {
                    await updateMethod(change, options).catch(err => null);
                }
                throw err;
            }
        }
        return true;
    }
    async _migrateEntity(type, data) {
        return this.migrator.migrateEntity(type, data);
    }


    async _migrateEntityPath(entityPath, {isAsset=true, supportsWildcard=false}={}) {
        if (!entityPath || !entityPath.startsWith(this.assetsPrefix)) {
            // passthrough for non-assets library paths
            if (isAsset && entityPath && (entityPath.startsWith("http://") || entityPath.startsWith("https://"))) {
                this._onlineAssets.add(entityPath);
            }
            return entityPath;
        }
        const path = entityPath.slice(this.assetsPrefix.length);
        const parts = path.split("/");
        const userid = parts[0];
        const [name, query] = parts.slice(1).join("/").split("?") // Remove userid from url to get target path
        if (userid === "bazaar") {
            const type = parts[1];
            if (type === "core") {
                // Core files are directly taken from core foundry, nothing to do here
                return parts.slice(2).join("/");
            } else {
                const pkgName = parts[2];
                const assetsDir = parts[3];
                const pkgPath = parts.slice(4).join("/");
                const localPath = `${type}/${pkgName}/${pkgPath}`;
                // Verify that the format is "<type>/<name>/assets/<path>", otherwise, the path might be wrong/weird/unexpected
                if (assetsDir !== "assets") {
                    if (isAsset) this._onlineAssets.add(entityPath);
                    return entityPath;
                }
                // Worlds from the Bazaar would get exported but with no access to the actual assets as part of the package
                if (type === "worlds") {
                    try {
                        // make sure the folder exists before uploading, possibly changing the path if needed (directory name exists as a file)
                        const newPath = await this._safeMkdirpAsset(localPath);
                        const [subPath, filename] = this.splitPath(newPath);
                        // Don't download/reupload if the file already exists (the same image could appear multiple times in a world, we only need to sync it once)
                        if (await this._doesFileExist(subPath, filename))
                            return newPath;
                        // Fetch the Forge asset blob
                        const blob = await ForgeAssetSync.fetchBlobFromUrl(entityPath);
                
                        // Upload to Foundry
                        const upload = await ForgeAssetSync.uploadAssetToFoundry({name: newPath}, blob);
                        if (upload && upload.path)
                            return upload.path;
                    } catch (err) {
                        console.error("Error downloading/uploading world asset: ", err);
                    }
                    if (isAsset) this._onlineAssets.add(entityPath);
                    return entityPath;
                }
                // TODO: should maybe use game.modules.get to see if the module exists, rather than the directory
                if (!await this._doesDirectoryExist(type, pkgName)) {
                    this._missingPackages.add(pkgName);
                    return entityPath;
                }
                return localPath;
            }
        } else {
            const asset = this.assets.get(decodeURI(name));
            const queryString = query ? `?${query}` : "";
            // Same path, not bazaar and same url.. so it's not coming from someone else's library
            if (asset && `${asset.url}${queryString}` === entityPath) {
                return `${name}${queryString}`;
            }
            // Wildcards will never work through https and can't be found in the Map, so we might as well just replace them as is
            if (supportsWildcard && name.includes("*")) {
                return `${name}${queryString}`;
            }
            if (isAsset) this._onlineAssets.add(entityPath);
            return entityPath;
        }
    }
}
class EntityMigration {
    constructor(callback) {
        this.callback = callback;
    }
    
    static async mapAsync(list, map) {
        return Promise.all(list.map(map));
    }
    
    static async strReplaceAsync(str, regex, asyncFn) {
        const promises = [];
        str.replace(regex, (match, ...args) => {
            const promise = asyncFn(match, ...args);
            promises.push(promise);
        });
        const data = await Promise.all(promises);
        return str.replace(regex, () => data.shift());
    }
    async migrateEntity(type, data) {
        switch (type) {
            case 'Actor':
            case 'actors':
                data.img = await this._migrateEntityPath(data.img);
                if (data.token)
                    data.token = await this.migrateEntity('tokens', data.token);
                if (data.items)
                    data.items = await this.constructor.mapAsync(data.items, item => this.migrateEntity('items', item));
                if (data.data && data.data.details && data.data.details.biography && data.data.details.biography.value)
                    data.data.details.biography.value = await this._migrateHTML(data.data.details.biography.value);
                break;
            case 'tokens':
                data.img = await this._migrateEntityPath(data.img, {isAsset: true, supportsWildcard: true});
                if (data.effects)
                    data.effects = await this.constructor.mapAsync(data.effects, effect => this._migrateEntityPath(effect));
                if (data.actorData)
                    data.actorData = await this.migrateEntity('actors', data.actorData);
                break;
            case 'JournalEntry':
            case 'journal':
                data.img = await this._migrateEntityPath(data.img);
                data.content = await this._migrateHTML(data.content);
                break;
            case 'Item':
            case 'items':
                data.img = await this._migrateEntityPath(data.img);
                if (data.data && data.data.description && data.data.description.value)
                    data.data.description.value = await this._migrateHTML(data.data.description.value);
                break;
            case 'Macro':
            case 'macros':
            case 'tiles':
            case 'RollTable':
            case 'tables':
                data.img = await this._migrateEntityPath(data.img);
                break;
            case 'chat':
            case 'Message':
                data.sound = await this._migrateEntityPath(data.sound);
                data.content = await this._migrateHTML(data.content);
                break;
            case "Playlist":
            case 'playlists':
                data.sounds = await this.constructor.mapAsync(data.sounds, sound => this.migrateEntity('sound', sound));
                break;
            case 'sound':
                data.path = await this._migrateEntityPath(data.path);
                break;
            case "Scene":
            case "scenes":
                data.img = await this._migrateEntityPath(data.img);
                data.thumb = await this._migrateEntityPath(data.thumb, {base64name: "thumbnails"});
                data.description = await this._migrateHTML(data.description);
                if (data.drawings)
                    data.drawings = await this.constructor.mapAsync(data.drawings, drawing => this.migrateEntity('drawings', drawing));
                if (data.notes)
                    data.notes = await this.constructor.mapAsync(data.notes, note => this.migrateEntity('notes', note));
                if (data.templates)
                    data.templates = await this.constructor.mapAsync(data.templates, template => this.migrateEntity('templates', template));
                if (data.tiles)
                    data.tiles = await this.constructor.mapAsync(data.tiles, tile => this.migrateEntity('tiles', tile));
                if (data.tokens)
                    data.tokens = await this.constructor.mapAsync(data.tokens, token => this.migrateEntity('tokens', token));
                break;
            case 'drawings':
            case 'templates':
                data.texture = await this._migrateEntityPath(data.texture);
                break;
            case 'notes':
                data.icon = await this._migrateEntityPath(data.icon);
                break;
            case "users":
                data.avatar = await this._migrateEntityPath(data.avatar);
                break;
            case 'settings':
                break;
        }
        return data;
    }

    async _migrateHTML(content) {
        if (!content) return content;
        return this.constructor.strReplaceAsync(content, /(?:(src=")([^"]*)")|(?:(src=')([^']*)')|(?:(href=")([^"]*)")|(?:(href=')([^']*)')/g, 
            async (match, ...groups) => {
            const prefix = (groups[0] || groups[2] || groups[3] || groups[4]); // src=" or href="
            const url = (groups[1] || groups[3] || groups[5] || groups[7]);
            const suffix = match.substr(-1); // closing quote
            const migrated = await this._migrateEntityPath(url, {isAsset: prefix.includes("src")});
            return prefix + migrated + suffix;
        });
    }

    async _migrateEntityPath(entityPath, {isAsset=true, supportsWildcard=false, base64name="base64data"}={}) {
        return this.callback(entityPath, {isAsset, supportsWildcard, base64name});
    }
}