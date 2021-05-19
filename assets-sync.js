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
        COMPLETE: `Sync Completed Successfully!`,
        WITHERRORS: `Sync Completed with Errors. Check console for more details.`,
        FAILED: `Failed to Sync. Check console for more details.`,
        CANCELLED: "Sync process Cancelled"
    };
    constructor(app=null, {forceLocalRehash=false, overwriteLocalMismatches=false}={}) {
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

        this.app.updateProgress(0, "", missingDirs.size);
        for (const dir of missingDirs) {
            const createdDir = await this.createDirectory(dir, {retries: this.retries});
            if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) {
                return this.updateMapFile();
            }
            if (createdDir) createdDirCount++;
            this.app.updateProgress(createdDirCount, dir, missingDirs.size);
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
        this.updateMapFile();
        if (this.status === ForgeAssetSync.SYNC_STATUSES.CANCELLED) return;

        if (!synced.length && failed.length) this.setStatus(ForgeAssetSync.SYNC_STATUSES.FAILED);
        else if (synced.length && failed.length) this.setStatus(ForgeAssetSync.SYNC_STATUSES.WITHERRORS);
        else this.setStatus(ForgeAssetSync.SYNC_STATUSES.COMPLETE);
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

        this.app.updateProgress(0, "", assets.size);
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
                this.app.updateProgress(assetIndex, asset.name, assets.size);

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
        this.app.updateProgress(0, "", referenceDirs.size);
        // use filepicker.browse to check in the paths provided in referenceassets
        for (const dir of referenceDirs) {
            try {
                const fp = await FilePicker.browse("data", dir);
                this.app.updateProgress(dirIndex, dir, referenceDirs.size);
                
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
            const result = FilePicker.upload("data", "/", file);
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
            const isImage = CONST.IMAGE_FILE_EXTENSIONS.some(e => url.endsWith(e));
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
            const upload = await FilePicker.upload("data", path, file);

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
                label: "Update Foundry World to use Local Asset (Coming Soon)",
                disabled: true
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
            value: (this.currentAssetIndex / this.totalAssetCount).toFixed(2) * 100,
            countValue: this.currentAssetIndex || 0,
            countMax: this.totalAssetCount || 0
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

    async updateProgress(current, name, total) {
        this.totalAssetCount = total;
        this.currentAssetIndex = current;
        this.currentAsset = name;
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
            case ForgeAssetSync.SYNC_STATUSES.PREPARING:
                this.syncStatusIcon = `syncing`;
                this.isSyncing = true;
                break;

            case ForgeAssetSync.SYNC_STATUSES.SYNCING:
                this.syncStatusIcon = `syncing`;
                this.isSyncing = true;
                break;
    
            case ForgeAssetSync.SYNC_STATUSES.POSTSYNC:
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
        this.updateProgress(0, "", 0);
        this.syncWorker = null;
    }
    close(...args) {
        super.close(...args);
        this.cancel();
    }
}
