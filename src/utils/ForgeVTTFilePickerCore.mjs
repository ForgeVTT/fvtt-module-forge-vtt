import { ForgeVTT } from "../ForgeVTT.mjs";
import { ForgeAPI } from "../ForgeAPI.mjs";
import { ForgeCompatibility } from "../ForgeCompatibility.mjs";

/**
 * Core functionality for the Forge VTT FilePicker integration.
 * This class contains shared logic that's used by both v12 and v13 adapter implementations.
 */
export class ForgeVTTFilePickerCore {
  /**
   * Cache for the forge bucket index
   * @type {Array|null}
   * @private
   */
  static _forgeBucketIndex = null;

  /**
   * Last browsed directory in the Forge assets
   * @type {string}
   */
  static LAST_BROWSED_DIRECTORY = "";

  /* -------------------------------------------- */
  /*  Constants                                   */
  /* -------------------------------------------- */

  /**
   * @returns {string} The bucket label for the Forge's asset library
   */
  static get forgeAssetsBucketName() {
    return "The Forge Assets";
  }

  /**
   * @returns {string} The bucket label for the user's own asset library
   */
  static get myLibraryBucketName() {
    return "My Assets Library";
  }

  /**
   * @returns {string} The bucket prefix for a folder shared via API from another user's asset library
   */
  static get sharedPrefixBucketName() {
    return "Shared Folder: ";
  }

  /**
   * @returns {string} The bucket label for another user's asset library shared via API key
   */
  static get customAPIKeyBucketName() {
    return "Custom API Key";
  }

  /* -------------------------------------------- */
  /*  Forge API Methods                           */
  /* -------------------------------------------- */

  /**
   * Retrieves the Forge VTT buckets asynchronously.
   * @param {object} [existingStatus] - Existing status object to use instead of fetching a new one
   * @returns {Promise<Array>} A promise that resolves to an array of Forge VTT buckets
   */
  static async getForgeVTTBucketsAsync(existingStatus) {
    const status =
      existingStatus ||
      ForgeAPI.lastStatus ||
      (await ForgeAPI.status().catch((error) => {
        console.error(error);
        return {};
      }));
    return this.getForgeVTTBuckets(status);
  }

  /**
   * Retrieves and caches the Forge VTT buckets.
   * @param {object} status - The status object from the Forge API
   * @returns {Array} An array of Forge VTT buckets
   */
  static getForgeVTTBuckets(status = ForgeAPI.lastStatus || {}) {
    if (this._forgeBucketIndex) {
      return this._forgeBucketIndex;
    }

    const buckets = [];
    const apiKey = game.settings.get("forge-vtt", "apiKey");

    if (status.user) {
      // We're logged in, add access to our own assets library
      buckets.push({
        label: this.myLibraryBucketName,
        userId: status.user,
        jwt: null,
        key: "my-assets",
      });
    }

    if (apiKey && ForgeAPI.isValidAPIKey(apiKey)) {
      // User has set a custom API key
      const info = ForgeAPI._tokenToInfo(apiKey);
      buckets.push({
        label: this.customAPIKeyBucketName,
        userId: info.id,
        jwt: apiKey,
        key: ForgeAPI._tokenToHash(apiKey),
      });
    }

    const sharedBuckets = [];
    for (const sharedKey of status.sharedAPIKeys || []) {
      const keyHash = ForgeAPI._tokenToHash(sharedKey);
      // Add the bucket if it isn't already in the list
      if (ForgeAPI.isValidAPIKey(sharedKey) && !sharedBuckets.find((b) => b.key === keyHash)) {
        const info = ForgeAPI._tokenToInfo(sharedKey);
        let name = info.keyName;
        if (name?.length > 50) {
          name = `${name.slice(0, 50)}…`;
        }
        sharedBuckets.push({
          label: `${this.sharedPrefixBucketName}${name}`,
          userId: info.id,
          jwt: sharedKey,
          key: keyHash,
        });
      }
    }

    // Sort the share-URL buckets by name
    sharedBuckets.sort((a, b) => a.label.localeCompare(b.label));
    buckets.push(...sharedBuckets);

    if (ForgeAPI.lastStatus) {
      this._forgeBucketIndex = buckets;
    }

    return buckets;
  }

  /**
   * Retrieves the Forge VTT bucket based on the provided key or index.
   * @param {string|number} bucketKey - The key or index of the bucket to retrieve
   * @returns {object|undefined} The Forge VTT bucket object, or undefined if not found
   */
  static getForgeVttBucket(bucketKey) {
    const buckets = this.getForgeVTTBuckets();

    // From Foundry v12, buckets are keyed by index not by hash
    const isHashKey = isNaN(bucketKey) || !ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "12");
    const bucketIndex = isHashKey ? buckets.findIndex((b) => b.key === bucketKey) : bucketKey;

    return buckets[bucketIndex];
  }

  /**
   * Converts a bucket key or index to call options for the ForgeAPI.
   * @param {string|number} bucketKey - The key or index of the bucket
   * @returns {object} The call options object with appropriate authentication
   */
  static bucketToCallOptions(bucketKey) {
    if (!bucketKey) {
      return {};
    }

    const bucket = this.getForgeVttBucket(bucketKey);
    if (bucket) {
      if (bucket.key === "my-assets") {
        return { cookieKey: true };
      }
      if (bucket.jwt) {
        return { apiKey: bucket.jwt };
      }
    }

    // If the bucket is not found, bail. Otherwise the assets and bucket the user is shown in the FilePicker will not match.
    ui.notifications.error("Unknown asset source. Please select a different source in the dropdown.");
    return {};
  }

  /* -------------------------------------------- */
  /*  Directory and Bucket Handling              */
  /* -------------------------------------------- */

  /**
   * Gets the appropriate bucket key format based on Foundry version.
   * @param {object} bucket - The bucket object
   * @param {Array} buckets - The array of all available buckets
   * @param {boolean} isV12OrLater - Whether the Foundry version is v12 or later
   * @returns {string|number} The appropriate bucket key
   */
  static getBucketKey(bucket, buckets, isV12OrLater) {
    return isV12OrLater ? buckets.findIndex((b) => b.key === bucket.key) : bucket.key;
  }

  /**
   * Retrieves the root directory of a bucket.
   * @param {object} bucket - The bucket object
   * @returns {string|undefined} The root directory of the bucket, or undefined if not set
   */
  static getBucketRootDir(bucket) {
    const info = bucket.jwt && ForgeAPI._tokenToInfo(bucket.jwt);
    // Get the key's root dir and trim the leading slash
    return info?.keyOptions?.assets?.rootDir?.replace(/^\/+/, "");
  }

  /**
   * Returns the relative path of a file within a bucket.
   * @param {object} bucket - The bucket object
   * @param {string} path - The full path of the file
   * @returns {string} The relative path of the file within the bucket
   */
  static getBucketRelativePath(bucket, path) {
    const rootDir = this.getBucketRootDir(bucket);
    if (rootDir && path.startsWith(rootDir)) {
      return path.slice(rootDir.length);
    }
    // Old custom API keys do not have a root dir, so if the user id matches, the target is in here somewhere
    return path;
  }

  /**
   * Infers the current Forge directory from a given path.
   * @param {string} target - The target path to infer the directory from
   * @param {object} superInferFn - The parent class's _inferCurrentDirectory function
   * @returns {Array} [source, target, bucket] for the inferred directory
   */
  static inferForgeDirectory(target, superInferFn) {
    const buckets = this.getForgeVTTBuckets();

    if (!target) {
      if (buckets.length === 0) {
        // No buckets, so no assets library access
        return superInferFn(target);
      }

      const userBucket = buckets[0];
      const userBucketKey = this.getBucketKey(
        userBucket,
        buckets,
        ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "12")
      );

      return ["forgevtt", "", userBucketKey];
    }

    if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
      const assetPath = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length);

      // Handle Forge Bazaar paths
      if (ForgeVTT.usingTheForge && assetPath.startsWith("bazaar/")) {
        const parts = assetPath.split("/").slice(1, -1); // Remove bazaar prefix and filename from the path
        const bazaarPath = [parts[0], parts[1], ...parts.slice(3)].join("/"); // Remove assets folder name from the path
        return ["forge-bazaar", bazaarPath, undefined];
      }

      // Non-bazaar - so it's a forgevtt asset
      const parts = assetPath.split("/");
      const userId = parts[0];
      // Remove userid and filename from url to get target path
      const forgePath = `${decodeURIComponent(parts.slice(1, -1).join("/"))}/`;

      // Check if this is the user's own asset
      const userBucket = buckets.find((b) => b.userId === userId);
      if (userBucket) {
        const userBucketKey = this.getBucketKey(
          userBucket,
          buckets,
          ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "12")
        );
        return ["forgevtt", forgePath, userBucketKey];
      }

      // Find the bucket which permits access to this asset
      const sharedBucket = buckets.find(
        (bucket) =>
          userId === bucket.userId &&
          (!this.getBucketRootDir(bucket) || forgePath.startsWith(this.getBucketRootDir(bucket)))
      );

      if (sharedBucket) {
        const sharedBucketKey = this.getBucketKey(
          sharedBucket,
          buckets,
          ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "12")
        );
        const sharedBucketRelativePath = this.getBucketRelativePath(sharedBucket, forgePath);
        return ["forgevtt", sharedBucketRelativePath, sharedBucketKey];
      }

      // Fallback - default to our own assets library
      const defaultBucket = buckets[0];
      const defaultBucketKey = this.getBucketKey(
        defaultBucket,
        buckets,
        ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "12")
      );
      return ["forgevtt", "", defaultBucketKey];
    }

    if (ForgeVTT.usingTheForge) {
      // If not an assets URL but the path is not a known core data folder and isn't a module or system folder
      // then we can assume that it won't be a folder that exists in data and we can infer the source as being
      // from the assets library, even if it's a relative path
      const dataDirs = ["systems", "modules"];
      const publicDirs = ["cards", "icons", "sounds", "ui"];

      if ([...dataDirs, ...publicDirs].every((folder) => !target.startsWith(`${folder}/`))) {
        return ["forgevtt", target, undefined];
      }
    }

    return superInferFn(target);
  }

  /**
   * Populates the Forge sources in a FilePicker instance.
   * @param {object} sources - The sources object to populate
   * @returns {object} The modified sources object
   */
  static populateForgeSources(sources) {
    if (sources["forge-bazaar"] === undefined && ForgeVTT.usingTheForge) {
      sources["forge-bazaar"] = {
        target: "",
        dirs: [],
        files: [],
        label: "The Bazaar",
        icon: "fas fa-cloud",
      };
    }

    const buckets = this.getForgeVTTBuckets();
    if (sources.forgevtt === undefined && buckets.length > 0) {
      const userBucket = buckets[0];
      const userBucketKey = this.getBucketKey(
        userBucket,
        buckets,
        ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "12")
      );

      sources.forgevtt = {
        buckets: buckets.map((b) => b.key),
        bucket: userBucketKey,
        target: "",
        dirs: [],
        files: [],
        label: this.forgeAssetsBucketName,
        icon: "fas fa-cloud",
      };
    }

    return sources;
  }

  /**
   * Determines whether the user can upload assets to a specific source and bucket.
   * @param {string} source - The source to check
   * @param {string|number} bucketKey - The bucket key or index
   * @returns {boolean} Returns true if the user can upload assets, otherwise false
   */
  static canUploadToForge(source, bucketKey) {
    if (source === "forge-bazaar") {
      return false;
    }

    if (source === "forgevtt") {
      const bucket = this.getForgeVttBucket(bucketKey);
      if (!bucket) {
        return false;
      }

      if (bucket.key === "my-assets") {
        return true;
      }

      if (!ForgeAPI.isValidAPIKey(bucket.jwt)) {
        return false;
      }

      const permissions = ForgeAPI._tokenToInfo(bucket.jwt).permissions || [];
      return permissions.includes("write-assets");
    }

    return !ForgeVTT.usingTheForge;
  }

  /* -------------------------------------------- */
  /*  Asset Browsing and File Operations          */
  /* -------------------------------------------- */

  /**
   * Browse files within a Forge source.
   * @param {string} source - The source to browse ("forgevtt" or "forge-bazaar")
   * @param {string} target - The target directory path
   * @param {object} options - Options for the browse operation
   * @param {Function} superBrowseFn - The parent class's browse function
   * @returns {Promise<object>} The browse results
   */
  static async browseForgeAssets(source, target, options, superBrowseFn) {
    let tryingBazaarFirst = options._forgeOriginalSource;

    // Fix source to be forgevtt if target is an assets library URL
    if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
      source = "forgevtt";
    }

    // Handle checking the Bazaar first for modules/systems
    if (
      ForgeVTT.usingTheForge &&
      !["forgevtt", "forge-bazaar"].includes(source) &&
      !options._forgePreserveSource &&
      /^\/?(modules|systems|worlds)\/.+/.test(target)
    ) {
      tryingBazaarFirst = source;
      source = "forge-bazaar";
    }

    // Fall back to original source if not using a Forge source
    if (!["forgevtt", "forge-bazaar"].includes(source)) {
      if (!ForgeVTT.usingTheForge) {
        options._forgePreserveSource = true;
      }
      const resp = await superBrowseFn(source, target, options).catch((err) => {
        if (options._forgePreserveSource) {
          throw err;
        }
      });

      if (options._forgePreserveSource || (resp && (resp.target === target || resp.files.length || resp.dirs.length))) {
        return resp;
      }

      source = "forgevtt";
    }

    if (options.wildcard) {
      options.wildcard = target;
    }
    options.target = target;

    if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
      const parts = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length).split("/");
      // Remove userId from Assets Library URL to get target path
      target = parts.slice(1).join("/");
      options.forge_userid = parts[0];
    }

    const isFile = ForgeVTT.FILE_EXTENSIONS.some((ext) => target.toLowerCase().endsWith(`.${ext}`));
    // Remove the file name and extension if the URL points to a file (wildcard will always point to file)
    if (options.wildcard || isFile) {
      target = target.split("/").slice(0, -1).join("/");
    }

    options.forge_game = ForgeVTT.gameSlug;

    // Handle Forge Bazaar browsing
    if (ForgeVTT.usingTheForge && (source === "forge-bazaar" || options.forge_userid === "bazaar")) {
      target = target.replace(/^\/+/, ""); // Remove leading dir separator

      if (target === "") {
        // Return systems/modules/worlds pseudo directories in case of the root folder
        return {
          target: "",
          dirs: ["modules", "systems", "worlds", "assets"],
          files: [],
          gridSize: null,
          private: false,
          privateDirs: [],
          extensions: options.extensions,
        };
      }
      const parts = target.split("/");
      if (!["modules", "systems", "worlds", "assets"].includes(parts[0])) {
        return {
          target,
          dirs: [],
          files: [],
          gridSize: null,
          private: false,
          privateDirs: [],
          extensions: options.extensions,
        };
      }

      options.forge_userid = "bazaar";
    }

    // Make the API call to browse Forge assets
    const response = await ForgeAPI.call(
      "assets/browse",
      { path: decodeURIComponent(target), options },
      this.bucketToCallOptions(options.bucket)
    );

    // If a target or its folder is not found in the Bazaar after checking it first, retry with original source
    if (
      tryingBazaarFirst &&
      (!response ||
        response.error ||
        // It is possible to specify a target with or without trailing "/"
        (response.folder !== target && response.folder + "/" !== target) ||
        (response.files.length === 0 && response.dirs.length === 0))
    ) {
      if (source === "forge-bazaar") {
        // We tried the bazaar, let's try the user's assets library now
        options._forgeOriginalSource = tryingBazaarFirst;
        delete options.forge_userid;
        target = options.wildcard || options.target || target;
        return this.browseForgeAssets("forgevtt", target, options, superBrowseFn);
      }
      // Restore original target
      target = options.wildcard || options.target || target;
      return superBrowseFn(tryingBazaarFirst, target, options);
    }

    if (!response || response.error) {
      // ui or ui.notifications may still be undefined if a language (fr-core) tries to browse during the setup hook
      // to try and setup the language before the UI gets drawn.
      ui?.notifications?.error(response ? response.error : "An unknown error occurred accessing The Forge API");

      return {
        target,
        dirs: [],
        files: [],
        gridSize: null,
        private: false,
        privateDirs: [],
        extensions: options.extensions,
      };
    }

    // TODO: Should be decodeURIComponent but FilePicker's _onPick needs to do encodeURIComponent too, but on each separate path.
    response.target = decodeURI(response.folder);
    delete response.folder;
    response.dirs = response.dirs.map((d) => d.path.slice(0, -1));
    response.files = response.files.map((f) => f.url);
    // v0.5.6+ specific
    response.private = true;
    response.privateDirs = [];
    response.gridSize = null;
    response.extensions = options.extensions;

    return response;
  }

  /**
   * Create a directory in the Forge assets library.
   * @param {string} source - The source to create the directory in
   * @param {string} target - The target directory path
   * @param {object} options - Options for the directory creation
   * @param {Function} superCreateDirFn - The parent class's createDirectory function
   * @returns {Promise<object>} The response from the API
   */
  static async createForgeDirectory(source, target, options, superCreateDirFn) {
    if (source === "forge-bazaar") {
      const error = "Cannot create a folder in the Bazaar";
      ui.notifications.error(error);
      throw new Error(error);
    }

    if (!ForgeVTT.usingTheForge && source !== "forgevtt") {
      return superCreateDirFn(source, target, options);
    }

    if (!target) {
      return;
    }

    const response = await ForgeAPI.call(
      "assets/new-folder",
      { path: target },
      this.bucketToCallOptions(options.bucket)
    );

    if (!response || response.error) {
      const error = response ? response.error : "Unknown error while creating directory.";
      ui.notifications.error(error);
      throw new Error(error);
    }

    return response;
  }

  /**
   * Upload a file to the Forge assets library.
   * @param {string} source - The source to upload to ("forgevtt")
   * @param {string} target - The target directory path
   * @param {File} file - The file to upload
   * @param {object} body - Additional options for the upload
   * @param {object} options - Upload options including notification settings
   * @param {Function} superUploadFn - The parent class's upload function
   * @returns {Promise<object>} The upload response
   */
  static async uploadToForge(source, target, file, body = {}, options = { notify: true }, superUploadFn) {
    if (source === "forge-bazaar") {
      ui.notifications.error("Cannot upload to that folder");
      return false;
    }

    if (!ForgeVTT.usingTheForge && source !== "forgevtt") {
      return superUploadFn(source, target, file, body, options);
    }

    // Some uploads e.g. dragging an image onto journal have no target but have a UUID.
    // body.uuid is the UUID of the parent document that the entity is being uploaded to, not the file itself.
    // Upload to the active world folder with uuid and timestamp as the target if no target is provided.
    if (target == null) {
      target = "";
      if (body.uuid) {
        // Get the ISO string and replace characters that are not suitable for folder names
        var uniqueId = new Date().toISOString();
        // Replace characters that might cause issues in file systems, and remove Z at the end
        uniqueId = uniqueId.replace(/:/g, "-").replace("T", "_").slice(0, -1);
        target = `worlds/${game.world.id || game.world.name}/assets/${body.uuid}/${uniqueId}`;
      }
    }

    if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
      const parts = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length).split("/");
      // Remove userId from Assets Library URL to get target path
      target = parts.slice(1).join("/");
    }

    const userId = await ForgeAPI.getUserId();
    if (userId && target.startsWith(`${userId}/`)) {
      // Remove userId if target starts with it as the folder name
      target = target.split("/").slice(1).join("/");
    }

    // Build the asset
    const path = `${target}/${file.name}`;
    const size = file.size;
    const etag = await this.etagFromFile(file);

    // Fail if the etag can't be generated
    if (!etag) {
      ui.notifications.error("Failed to read required metadata from file");
      return false;
    }

    // Now try to create the asset
    const assetBody = { assets: [{ path, size, etag }] };
    const createResponse = await ForgeAPI.call("assets/create", assetBody, this.bucketToCallOptions(body.bucket));

    // If asset create call fails, prevent upload
    if (!createResponse || createResponse.error) {
      console.error(createResponse ? createResponse.error : "An unknown error occurred accessing The Forge API");
      ui.notifications.error(
        createResponse ? createResponse.error : "An unknown error occurred accessing The Forge API"
      );
      return false;
    }

    const createResults = createResponse?.results;

    if (createResults) {
      const createResult = createResults.length ? createResults[0] : null;

      if (!createResult || createResult?.error) {
        console.error(createResult?.error ?? "Failed to create Forge asset");
        ui.notifications.error(createResult?.error ?? "Failed to create Forge asset");
        return false;
      }

      // If file already exists, prevent upload and return it
      if (createResult?.url) {
        const result = {
          message: "File Uploaded to your Assets Library successfully",
          status: "success",
          path: createResult?.url,
        };
        console.info(result.message);
        if (options.notify) {
          ui.notifications.info(result.message);
        }
        return result;
      }
    }

    // if the url is null then we need to upload
    const formData = new FormData();
    formData.append("path", path);
    formData.append("file", file);

    const uploadResponse = await ForgeAPI.call(
      ForgeVTT.UPLOAD_API_ENDPOINT,
      formData,
      this.bucketToCallOptions(body.bucket)
    );

    if (!uploadResponse || uploadResponse?.error) {
      console.error(uploadResponse ? uploadResponse.error : "An unknown error occurred accessing The Forge API");
      ui.notifications.error(
        uploadResponse ? uploadResponse.error : "An unknown error occurred accessing The Forge API"
      );
      return false;
    }
    const result = {
      message: "File Uploaded to your Assets Library successfully",
      status: "success",
      path: uploadResponse.url,
    };
    console.info(result.message);
    if (options.notify) {
      ui.notifications.info(result.message);
    }
    return result;
  }

  /**
   * Upload many files to the Forge user's assets library, at once.
   * @param {string} source - The source to upload to (must be "forgevtt")
   * @param {Array<object>} files - Array of objects with {target, file} properties
   * @param {object} options - Options including bucket and notification settings
   * @param options.notify
   * @param options.bucket
   * @returns {Promise<Array<string>|null>} Array of URLs or null if an error occurred
   */
  static async uploadManyToForge(source, files, { notify = true, bucket } = {}) {
    if (!ForgeVTT.usingTheForge && source !== "forgevtt") {
      throw new Error("Can only use uploadMany on forgevtt source");
    }

    const CREATE_BATCH_SIZE = 100;
    const createResults = [];

    // Try to first create the files in batches of 100
    for (let i = 0; i < files.length; i += CREATE_BATCH_SIZE) {
      const batch = files.slice(i, i + CREATE_BATCH_SIZE);

      const assetBody = await Promise.all(
        batch.map(async ({ target, file }) => {
          // Build the asset
          const path = `${target}/${file.name}`;
          const size = file.size;
          const etag = await this.etagFromFile(file);

          // If the etag can't be generated, server side will fail the upload
          return { path, size, etag };
        })
      );

      // Now try to create the asset
      const create = { assets: assetBody };
      const createResponse = await ForgeAPI.call("assets/create", create, this.bucketToCallOptions(bucket));

      // If asset create call fails, prevent upload
      if (!createResponse || createResponse.error) {
        console.error(createResponse ? createResponse.error : "An unknown error occurred accessing The Forge API");
        ui.notifications.error(
          createResponse ? createResponse.error : "An unknown error occurred accessing The Forge API"
        );
        return null;
      }

      createResults.push(...createResponse.results);
    }

    // Find which files failed to be created and upload them instead
    const UPLOAD_BATCH_SIZE = 50 * 1024 * 1024; // In body size
    const uploadResults = [];
    let formData = new FormData();
    let size = 0;

    for (let i = 0; i < files.length; i++) {
      const createResult = createResults[i];
      // If we have an error, then upload will fail, and if we have a url, creation succeeded
      // Only upload files where the result has a url of null
      if (createResult.error || createResult.url !== null) {
        continue;
      }

      const { target, file } = files[i];
      formData.append("paths[]", `${target}/${file.name}`);
      formData.append("files[]", file, file.name);
      size += file.size;

      if (size > UPLOAD_BATCH_SIZE) {
        const uploadResponse = await ForgeAPI.call(
          ForgeVTT.UPLOAD_API_ENDPOINT,
          formData,
          this.bucketToCallOptions(bucket)
        );

        if (!uploadResponse || uploadResponse?.error) {
          console.error(uploadResponse ? uploadResponse.error : "An unknown error occurred accessing The Forge API");
          ui.notifications.error(
            uploadResponse ? uploadResponse.error : "An unknown error occurred accessing The Forge API"
          );
          return null;
        }

        uploadResults.push(...uploadResponse.results);
        size = 0;
        formData = new FormData();
      }
    }

    if (size > 0) {
      const uploadResponse = await ForgeAPI.call(
        ForgeVTT.UPLOAD_API_ENDPOINT,
        formData,
        this.bucketToCallOptions(bucket)
      );

      if (!uploadResponse || uploadResponse?.error) {
        console.error(uploadResponse ? uploadResponse.error : "An unknown error occurred accessing The Forge API");
        ui.notifications.error(
          uploadResponse ? uploadResponse.error : "An unknown error occurred accessing The Forge API"
        );
        return null;
      }

      uploadResults.push(...uploadResponse.results);
    }

    // Build the response based on creation+upload results
    const result = createResults.map((result) => {
      if (result.error) {
        return null;
      }
      if (result.url) {
        return result.url;
      }
      // No error and no url, so it was uploaded
      const uploadResult = uploadResults.shift();
      return uploadResult.url || null;
    });

    const uploaded = result.filter((r) => !!r).length;
    if (notify) {
      ui.notifications.info(`Successfully uploaded ${uploaded}/${result.length} files to your Assets Library`);
    }

    return result;
  }

  /* -------------------------------------------- */
  /*  Image Manipulation Utilities                 */
  /* -------------------------------------------- */

  /**
   * Set a URL query parameter on an input field.
   * @param {HTMLInputElement|JQuery} input - The input field
   * @param {string} query - The parameter name
   * @param {string|null} value - The parameter value or null to remove
   */
  static setURLQuery(input, query, value) {
    // Ensure we're working with a DOM element
    const inputEl = input instanceof jQuery ? input[0] : input;
    const target = inputEl.value;

    if (!target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
      return;
    }

    try {
      const url = new URL(target);
      if (value) {
        url.searchParams.set(query, value);
      } else {
        url.searchParams.delete(query);
      }
      inputEl.value = url.href;
    } catch (err) {
      console.error("Failed to parse URL for query modification", err);
    }
  }

  /* -------------------------------------------- */
  /*  File Utility Methods                        */
  /* -------------------------------------------- */

  /**
   * Load the SparkMD5 library for file hashing.
   * @returns {Promise<void>} A promise that resolves when the library is loaded
   */
  static async loadMD5Library() {
    if (typeof SparkMD5 !== "undefined") {
      return;
    }

    if (ForgeVTT.usingTheForge) {
      return this.loadScript("https://forge-vtt.com/lib/spark-md5.js");
    }
    return this.loadScript("/modules/forge-vtt/lib/spark-md5/md5.min.js");
  }

  /**
   * Load a script from a URL.
   * @param {string} url - The URL of the script to load
   * @returns {Promise<void>} A promise that resolves when the script has loaded
   */
  static async loadScript(url) {
    return new Promise((resolve, reject) => {
      const head = document.getElementsByTagName("head")[0];
      const script = document.createElement("script");
      script.onload = resolve;
      script.onerror = reject;
      script.src = url;
      head.appendChild(script);
    });
  }

  /**
   * Generate an etag from a file for deduplication purposes.
   * @param {File} file - The file to hash
   * @param {Function} [progress] - Optional progress callback
   * @returns {Promise<string>} A promise that resolves to the etag hash
   */
  static async etagFromFile(file, progress = null) {
    await this.loadMD5Library();

    return new Promise((resolve, reject) => {
      const blobSlice = File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice,
        chunkSize = 5 * 1024 * 1024, // Read in chunks of 5MB
        chunks = Math.ceil(file.size / chunkSize),
        spark = new SparkMD5.ArrayBuffer(),
        fileReader = new FileReader();

      let currentChunk = 0,
        sparkMulti = null;

      if (progress) {
        progress(0);
      }

      fileReader.onload = function (e) {
        spark.append(e.target.result); // Append array buffer
        currentChunk++;

        if (progress) {
          progress(currentChunk / chunks);
        }

        if (currentChunk < chunks) {
          if (!sparkMulti) {
            sparkMulti = new SparkMD5();
          }
          sparkMulti.appendBinary(spark.end(true));
          spark.reset();
          loadNext();
        } else {
          if (sparkMulti) {
            sparkMulti.appendBinary(spark.end(true));
            resolve(`${sparkMulti.end()}-${chunks}`);
          } else {
            resolve(spark.end());
          }
        }
      };

      fileReader.onerror = function (err) {
        reject(err);
      };

      /**
       *
       */
      function loadNext() {
        var start = currentChunk * chunkSize,
          end = start + chunkSize >= file.size ? file.size : start + chunkSize;

        fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
      }

      loadNext();
    });
  }
}
