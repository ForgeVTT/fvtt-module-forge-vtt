import { ForgeVTT } from "../ForgeVTT.mjs";
import { ForgeAPI } from "../ForgeAPI.mjs";
import { ForgeCompatibility } from "../ForgeCompatibility.mjs";

export class ForgeVTT_FilePicker extends FilePicker {
  constructor(...args) {
    super(...args);
    this._newFilePicker = ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "0.5.5");
    this._deferredPopulateForgeBuckets = !ForgeAPI.lastStatus;
    this._inferCurrentDirectoryAndSetSource(this.request);
  }

  // Keep our class name proper and the Hooks with the proper names
  static get name() {
    return "FilePicker";
  }

  /**
   * @returns {string} The bucket label for the user's own asset library
   */
  static get forgeAssetsBucketName() {
    // TODO: i18n
    return "The Forge Assets";
  }

  /**
   * @returns {string} The bucket label for the user's own asset library
   */
  static get myLibraryBucketName() {
    // TODO: i18n
    return "My Assets Library";
  }

  /**
   * @returns {string} The bucket prefix for a folder shared via API from another user's asset library
   */
  static get sharedPrefixBucketName() {
    // TODO: i18n
    return "Shared Folder: ";
  }

  /**
   * @returns {string} The bucket label for another user's asset library shared via API key
   */
  static get customAPIKeyBucketName() {
    // TODO: i18n
    return "Custom API Key";
  }

  /**
   * Retrieves data from the super class and performs additional processing if the active source is "forgevtt".
   * @param {object} options - Optional parameters for retrieving data.
   * @returns {Promise<object>} - A promise that resolves to the retrieved data.
   */
  async getData(options = {}) {
    const data = await super.getData(options);
    // Consider forgevtt source as S3 to have bucket selection if there are more than 1
    if (this.activeSource === "forgevtt" && data.source.buckets.length > 1) {
      data.isS3 = true;
      data.bucket = data.source.bucket;
      data.buckets = data.source.buckets;
    }
    return data;
  }

  /**
   * Helper method which calls _inferCurrentDirectory and sets the relevant properties based on the result.
   * @param {string} target Asset URL (absolute or relative) to infer the current directory from.
   */
  _inferCurrentDirectoryAndSetSource(target) {
    const [source, assetPath, bucketKey] = this._inferCurrentDirectory(target);
    // Set activeSource and target again here, for good measure.
    this.activeSource = source;
    this.sources[source].target = assetPath;
    if (bucketKey) {
      // These are the assignment which super() doesn't do.
      this.sources[source].bucket = bucketKey;
    }
  }

  /**
   * Extend the FilePicker to support ForgeVTT assets library.
   * @override
   * @param {string} _target - The asset url (relative or absolute) to infer the current directory from
   * @returns {Array<string>} `[source, target, bucket]` Where:
   *   - `source` is the source key (Foundry Data, Forge Assets, etc...)
   *   - `target` is the asset path within that source
   *   - `bucket` is the bucket key within the forgevtt source
   */
  _inferCurrentDirectory(_target) {
    this._populateForgeSources();

    const target = _target || this.constructor.LAST_BROWSED_DIRECTORY;
    const buckets = this.constructor._getForgeVTTBuckets();

    if (buckets.length === 0) {
      // No buckets, so no assets library access. Fall back to default behavior.
      return super._inferCurrentDirectory(_target);
    }

    const [userBucket, ...sharedBuckets] = buckets;
    const userBucketKey = this._getBucketKey(userBucket);

    if (!target) {
      return ["forgevtt", "", userBucketKey];
    }

    if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
      const assetPath = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length);

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

      if (userId === userBucket.userId) {
        return ["forgevtt", forgePath, userBucketKey];
      }

      // Find the bucket which permits access to this asset
      const sharedBucket = sharedBuckets.find((bucket) => {
        const bucketRootDir = this._getBucketRootDir(bucket);
        return userId === bucket.userId && (!bucketRootDir || forgePath.startsWith(bucketRootDir));
      });
      if (sharedBucket) {
        const sharedBucketKey = this._getBucketKey(sharedBucket);
        const sharedBucketRelativePath = this._getBucketRelativePath(sharedBucket, forgePath);
        return ["forgevtt", sharedBucketRelativePath, sharedBucketKey];
      }

      // Fallback - we weren't able to find the correct bucket. Default to our own assets library (or the custom
      // key, for local installs).Technically this a side effect, but we need to set the bucket label here since
      // the caller doesn't.
      return ["forgevtt", "", userBucketKey];
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

    return super._inferCurrentDirectory(_target);
  }

  /**
   * Populates the Forge sources based on the current configuration.
   * If the Forge Bazaar source is not defined and The Forge is being used, it adds the Forge Bazaar source.
   * If the forgevtt source is not defined and there are Forge VTT buckets available, it adds the forgevtt source.
   */
  _populateForgeSources() {
    if (this.sources["forge-bazaar"] === undefined && ForgeVTT.usingTheForge) {
      this.sources["forge-bazaar"] = {
        target: "",
        dirs: [],
        files: [],
        label: "The Bazaar",
        icon: "fas fa-cloud",
      };
    }
    const buckets = this.constructor._getForgeVTTBuckets();
    if (this.sources.forgevtt === undefined && buckets.length > 0) {
      const userBucket = buckets[0];
      const userBucketKey = this._getBucketKey(userBucket);
      this.sources.forgevtt = {
        buckets: buckets.map((b) => b.key),
        bucket: userBucketKey,
        target: "",
        dirs: [],
        files: [],
        label: this.constructor.forgeAssetsBucketName,
        icon: "fas fa-cloud",
      };
    }
  }

  /**
   * Determines whether the user can upload assets.
   * @returns {boolean} Returns true if the user can upload assets, otherwise false.
   */
  get canUpload() {
    if (this.activeSource === "forgevtt") {
      const bucket = this.constructor._getForgeVttBucket(this.source.bucket);
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
    if (this.activeSource === "forge-bazaar") {
      return false;
    }
    return !ForgeVTT.usingTheForge && super.canUpload;
  }

  /**
   * Intercept and stop Foundry's _onChangeBucket "change" event to use our own handler instead
   * @param {Event} event - The change event object.
   * @returns {Promise<void>} - A promise that resolves when the browsing is complete.
   */
  async _onChangeBucket(event) {
    event.preventDefault();
    if (event.currentTarget.name === "bucket") {
      const select = event.currentTarget;
      select.disabled = true;
      this.activeSource = "forgevtt";
      this.source.bucket = select.value;
      this.sources.forgevtt.bucket = select.value;
      await this.browse("/");
      select.disabled = false;
    }
  }

  /**
   * Retrieves the Forge VTT buckets asynchronously.
   * @returns {Promise<Array>} A promise that resolves to an array of Forge VTT buckets.
   */
  static async _getForgeVTTBucketsAsync() {
    const status =
      ForgeAPI.lastStatus ||
      (await ForgeAPI.status().catch((error) => {
        console.error(error);
        return {};
      }));
    return this._getForgeVTTBuckets(status);
  }

  /**
   * Retrieves and caches the Forge VTT buckets.
   * @param {object} status - The status object.
   * @returns {Array} An array of Forge VTT buckets.
   */
  static _getForgeVTTBuckets(status = ForgeAPI.lastStatus || {}) {
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
   * @param {string|number} bucketKey - The key or index of the bucket to retrieve.
   * @returns {object} The Forge VTT bucket object.
   */
  static _getForgeVttBucket(bucketKey) {
    const buckets = this._getForgeVTTBuckets();
    // From Foundry v12, buckets are keyed by index not by hash
    const isHashKey = isNaN(bucketKey) || !ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "12");
    const bucketIndex = isHashKey ? buckets.findIndex((b) => b.key === bucketKey) : bucketKey;
    return buckets[bucketIndex];
  }

  /**
   * Get the bucket key (relative to Foundry version) for the specified bucket.
   * @param {object} bucket - The bucket object.
   * @returns {string|number} - The bucket key.
   */
  _getBucketKey(bucket) {
    const buckets = this.constructor._getForgeVTTBuckets();
    return ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "12")
      ? buckets.findIndex((b) => b.key === bucket.key)
      : bucket.key;
  }

  /**
   * Retrieves the root directory of a bucket.
   * @param {object} bucket - The bucket object.
   * @returns {string | undefined} The root directory of the bucket, or undefined.
   */
  _getBucketRootDir(bucket) {
    const info = bucket.jwt && ForgeAPI._tokenToInfo(bucket.jwt);
    // Get the key's root dir and trim the leading slash.
    return info?.keyOptions?.assets?.rootDir?.replace(/^\/+/, "");
  }

  /**
   * Returns the relative path of a file within a bucket.
   * @param {object} bucket - The bucket object.
   * @param {string} path - The path of the file.
   * @returns {string} The relative path of the file within the bucket.
   */
  _getBucketRelativePath(bucket, path) {
    const rootDir = this._getBucketRootDir(bucket);
    if (rootDir && path.startsWith(rootDir)) {
      return path.slice(rootDir.length);
    }
    // Old custom API keys do not have a root dir, so if the user id matches the target is in here somewhere.
    return path;
  }

  /**
   * Converts a bucket key or index to call options.
   * @param {string|number} bucketKey - The key or index of the bucket.
   * @returns {object} - The call options object.
   */
  static _bucketToCallOptions(bucketKey) {
    if (!bucketKey) {
      return {};
    }
    const bucket = this._getForgeVttBucket(bucketKey);
    if (bucket) {
      if (bucket.key === "my-assets") {
        return { cookieKey: true };
      }
      if (bucket.jwt) {
        return { apiKey: bucket.jwt };
      }
    }
    // If the bucket is not found, bail. Otherwise the assets and bucket the user is shown in the FilePicker will not match.
    // TODO: i18n
    ui.notifications.error(`Unknown asset source. Please select a different source in the dropdown.`);
    return {};
  }

  /**
   * Renders the element and sets up event listeners for the ForgeVTT FilePicker.
   * @param {...any} args - Additional arguments passed to the parent _render method.
   * @returns {Promise<void>} - A promise that resolves when the rendering is complete.
   */
  async _render(...args) {
    await super._render(...args);
    const html = this.element;
    const input = html.find("input[name=file]");
    const options = $(`
        <div class="form-group stacked forgevtt-options" style="font-size: 12px;">
            <div class="form-group forgevtt-flips">
                <input type="checkbox" name="flop" id="${this.id}-forgevtt-flop">
                <label for="${this.id}-forgevtt-flop">Flip Horizontally</label>
                <input type="checkbox" name="flip" id="${this.id}-forgevtt-flip">
                <label for="${this.id}-forgevtt-flip">Flip Vertically</label>
                <input type="checkbox" name="no-optimizer" id="${this.id}-forgevtt-no-optimizer">
                <label for="${this.id}-forgevtt-no-optimizer">Disable optimizations <a href="https://forums.forge-vtt.com/t/the-image-optimizer/681">?</a></label>
            </div>
            <div class="form-group forgevtt-blur-options">
                <label for="blur">Blur Image</label>
                <select name="blur">
                    <option value="0">None</option>
                    <option value="25">25%</option>
                    <option value="50">50%</option>
                    <option value="75">75%</option>
                    <option value="100">100%</option>
                </select>
            </div>
        </div>
        `);
    options.find('input[name="no-optimizer"]').on("change", (ev) => {
      this._setURLQuery(input, "optimizer", ev.currentTarget.checked ? "disabled" : null);
    });
    options.find('input[name="flip"]').on("change", (ev) => {
      this._setURLQuery(input, "flip", ev.currentTarget.checked ? "true" : null);
    });
    options.find('input[name="flop"]').on("change", (ev) => {
      this._setURLQuery(input, "flop", ev.currentTarget.checked ? "true" : null);
    });
    options.find('select[name="blur"]').on("change", (ev) => {
      this._setURLQuery(input, "blur", ev.currentTarget.value);
    });
    options.hide();
    input.parent().after(options);
    input.on("input", this._onInputChange.bind(this, options, input));
    this._onInputChange(options, input);
    // 0.5.6 FilePicker has lazy loading of thumbnails and supports folder creation
    if (this._newFilePicker) {
      if (["forgevtt", "forge-bazaar"].includes(this.activeSource)) {
        html.find(`button[data-action="toggle-privacy"]`).remove();
        html.find(".form-group.bucket label").text("Select source");
      }
      const images = html.find("img");
      for (const img of images.toArray()) {
        if (!img.src && img.dataset.src && img.dataset.src.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
          try {
            // Ask server to thumbnail the image to make display of large scene background
            // folders easier
            const url = new URL(img.dataset.src);
            url.searchParams.set("height", "200");
            img.dataset.src = url.href;
          } catch (error) {
            console.error(error);
          }
        }
      }
    } else {
      if (this.constructor._newFolderDialog) {
        this.constructor._newFolderDialog.close();
        this.constructor._newFolderDialog = null;
      }
      if (this.activeSource === "forgevtt") {
        const upload = html.find("input[name=upload]");
        const uploadDiv = $(`
                <div class="form-group">
                    <button type="button" name="forgevtt-upload" style="line-height: 1rem;">
                        <i class="fas fa-upload"></i>Choose File
                    </button>
                    <button type="button" name="forgevtt-new-folder" style="line-height: 1rem;">
                        <i class="fas fa-folder-plus"></i>New Folder
                    </button>
                </div>`);
        upload.hide();
        upload.after(uploadDiv);
        uploadDiv.append(upload);
        uploadDiv.find('button[name="forgevtt-upload"]').on("click", (_ev) => upload.click());
        uploadDiv.find('button[name="forgevtt-new-folder"]').on("click", (_ev) => this._onNewFolder());
      }
    }

    const select = html.find('select[name="bucket"]');
    select.off("change").val(this.source.bucket).on("change", this._onChangeBucket.bind(this));

    // The values we have in the source are the bucket keys, but we want to display the bucket names
    const bucketOptions = select.find("option").toArray();
    for (const bucketOption of bucketOptions) {
      const bucket = this.constructor._getForgeVttBucket(bucketOption.value);
      if (bucket) {
        bucketOption.label = bucket.label;
      }
    }
  }

  _onInputChange(options) {
    // New var _options to avoid param reassignment, and ensure we're working with a jQuery object
    const _options = ForgeVTT.ensureIsJQuery(options);
    // FIXME: disabling the optimizer options until the feature is re-implemented
    const target = null; // input.val();
    if (!target || !target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
      _options.hide();
      this.setPosition({ height: "auto" });
      return;
    }
    try {
      const url = new URL(target);
      const isImage =
        [".jpg", ".png", ".svg"].includes(url.pathname.toLowerCase().slice(-4)) ||
        [".jpeg", ".webp"].includes(url.pathname.toLowerCase().slice(-5));
      if (!isImage) {
        _options.hide();
        this.setPosition({ height: "auto" });
        return;
      }
      const noOptimizer = url.searchParams.get("optimizer") === "disabled";
      const flip = url.searchParams.get("flip") === "true";
      const flop = url.searchParams.get("flop") === "true";
      const blur = parseInt(url.searchParams.get("blur")) || 0;
      _options.find('input[name="no-optimizer"]').prop("checked", noOptimizer);
      _options.find('input[name="flip"]').prop("checked", flip);
      _options.find('input[name="flop"]').prop("checked", flop);
      _options.find('select[name="blur"]').val(blur);
      _options.show();
      this.setPosition({ height: "auto" });
    } catch {
      // noop
    }
  }

  _setURLQuery(input, query, value) {
    const target = input.val();
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
      input.val(url.href);
    } catch {
      // noop
    }
  }

  // Used for pre-0.5.6 foundry versions
  _onNewFolder() {
    if (this.activeSource !== "forgevtt") {
      return;
    }
    if (ForgeVTT_FilePicker._newFolderDialog) {
      ForgeVTT_FilePicker._newFolderDialog.close();
    }
    const target = this.source.target;
    ForgeVTT_FilePicker._newFolderDialog = new Dialog({
      title: "Create New Assets Folder",
      content: `
                <div class="form-group stacked">
                    <label>Enter the name of the folder you want to create : </label>
                    <input type="text" name="folder-name"/>
                </div>
            `,
      buttons: {
        ok: {
          label: "Create Folder",
          icon: '<i class="fas fa-folder-plus"></i>',
          callback: async (html) => {
            const name = ForgeVTT.ensureIsJQuery(html).find('input[name="folder-name"]').val().trim();
            const path = `${target}/${name}`;
            if (!name) {
              return;
            }
            const response = await ForgeAPI.call("assets/new-folder", { path });
            if (!response || response.error) {
              ui.notifications.error(response ? response.error : "An unknown error occurred accessing The Forge API");
            } else if (response.success) {
              ui.notifications.info("Folder created successfully");
              this.browse(path);
            }
          },
        },
        cancel: { label: "Cancel" },
      },
      default: "ok",
      close: () => {},
    }).render(true);
  }
  _onPick(event) {
    const isFile = !event.currentTarget.classList.contains("dir");
    super._onPick(event);
    if (isFile) {
      this._onInputChange(this.element.find(".forgevtt-options"), this.element.find("input[name=file]"));
    }
  }

  static async browse(source, target, options = {}) {
    if (source === "forge-vtt") {
      source = "forgevtt";
    }
    // wildcard for token images hardcodes source as 'data'
    if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
      source = "forgevtt";
    }
    // If user/code is browsing a package folder not in Assets Library, then check the Bazaar first
    // If the package is not accessible to the user, or the target is not found, then retry original source
    let tryingBazaarFirst = options._forgeOriginalSource;
    if (
      ForgeVTT.usingTheForge &&
      !["forgevtt", "forge-bazaar"].includes(source) &&
      !options._forgePreserveSource &&
      /^\/?(modules|systems|worlds)\/.+/.test(target)
    ) {
      tryingBazaarFirst = source;
      source = "forge-bazaar";
    }
    if (!["forgevtt", "forge-bazaar"].includes(source)) {
      if (!ForgeVTT.usingTheForge) {
        options._forgePreserveSource = true;
      }
      const resp = await super.browse(source, target, options).catch((err) => {
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

    // Add support for listing content from the Bazaar
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

    const response = await ForgeAPI.call(
      "assets/browse",
      { path: decodeURIComponent(target), options },
      this._bucketToCallOptions(options.bucket)
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
        return this.browse("forgevtt", target, options);
      }
      // Restore original target
      target = options.wildcard || options.target || target;
      return super.browse(tryingBazaarFirst, target, options);
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
    // 0.5.6 specific
    response.private = true;
    response.privateDirs = [];
    response.gridSize = null;
    response.extensions = options.extensions;
    return response;
  }
  // 0.5.6 specific functions.
  static async configurePath(source, target, options = {}) {
    if (["forgevtt", "forge-bazaar"].includes(source)) {
      ui.notifications.error(
        "This feature is not supported in the Assets Library.<br/>Your Assets are all private and can be instead shared through the API Manager on your Account page on the Forge."
      );
      return { private: true };
    }
    return super.configurePath(source, target, options);
  }
  static async createDirectory(source, target, options = {}) {
    let error;
    if (source === "forge-bazaar") {
      error = "Cannot create a folder in the Bazaar";
      ui.notifications.error(error);
      throw new Error(error);
    }
    if (!ForgeVTT.usingTheForge && source !== "forgevtt") {
      return super.createDirectory(source, target, options);
    }
    if (!target) {
      return;
    }
    const response = await ForgeAPI.call(
      "assets/new-folder",
      { path: target },
      this._bucketToCallOptions(options.bucket)
    );
    if (!response || response.error) {
      const error = response ? response.error : "Unknown error while creating directory.";
      ui.notifications.error(error);
      throw new Error(error);
    }
  }

  async browse(target, options = {}) {
    options._forgePreserveSource = true;
    if (this.activeSource === "forgevtt") {
      // If the Forge buckets weren't populated yet, then we didn't have a valid API status when this._inferCurrentDirectory was called.
      // Populate the buckets now and re-infer the current directory.
      if (this._deferredPopulateForgeBuckets) {
        this._forgeBucketIndex = await this.constructor._getForgeVTTBucketsAsync();
        this._deferredPopulateForgeBuckets = false;
        this.sources.forgevtt.buckets = this._forgeBucketIndex.map((b) => b.key);
        this._inferCurrentDirectoryAndSetSource(target || this.request);
      }
      if (!this.sources.forgevtt.bucket && this.sources.forgevtt.buckets.length > 0) {
        this.sources.forgevtt.bucket = this.sources.forgevtt.buckets[0];
      }
      options.bucket = this.source.bucket;
    }
    const result = await super.browse(target, options);
    if (result && ["forgevtt", "forge-bazaar"].includes(this.activeSource)) {
      let path = null;
      if (this.activeSource === "forge-bazaar") {
        const parts = result.target.split("/");
        const partsWithAssets = [parts[0], parts[1], "assets", ...parts.slice(2)];
        path = `bazaar/${partsWithAssets.join("/")}`;
      } else {
        path = ((await ForgeAPI.getUserId()) || "user") + "/" + result.target;
      }
      this.constructor.LAST_BROWSED_DIRECTORY = ForgeVTT.ASSETS_LIBRARY_URL_PREFIX + path + "/";
      game.settings.set("forge-vtt", "lastBrowsedDirectory", this.constructor.LAST_BROWSED_DIRECTORY);
    }
    return result;
  }

  /**
   * Upload a file to the server, or alternately create and/or upload a file to the Forge
   * @param {string} source       the data source being used
   * @param {string} target       the target folder
   * @param {File} file           the File data being uploaded
   * @param {object} body         file upload options sent in the request body
   * @param {object} options      additional options
   * @param options.notify
   */
  static async upload(source, target, file, body = {}, { notify = true } = {}) {
    if (source === "forge-bazaar") {
      ui.notifications.error("Cannot upload to that folder");
      return false;
    }
    if (!ForgeVTT.usingTheForge && source !== "forgevtt") {
      return super.upload(source, target, file, body, { notify });
    } //in v8, body will be the options.

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
    const createResponse = await ForgeAPI.call("assets/create", assetBody, this._bucketToCallOptions(body.bucket));

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
        if (notify) {
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
      this._bucketToCallOptions(body.bucket)
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
    if (notify) {
      ui.notifications.info(result.message);
    }
    return result;
  }

  /**
   * Upload many files to the Forge user's assets library, at once.
   * @param {string} source           Must be "forgevtt"
   * @param {Array<object>} files     Array of objects of the form: {target, file}
   * @param root0
   * @param root0.notify
   * @param root0.bucket
   * @returns {Array<string>}         Array of urls or null values if unable to upload (or returns null in case of error)
   */
  static async _uploadMany(source, files, { notify = true, bucket } = {}) {
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
      const createResponse = await ForgeAPI.call("assets/create", create, this._bucketToCallOptions(bucket));
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
          this._bucketToCallOptions(bucket)
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
        this._bucketToCallOptions(bucket)
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

  // Need to override fromButton because it references itself, so it creates the original
  // FilePicker instead of this derived class
  static fromButton(...args) {
    const fp = super.fromButton(...args);
    if (!fp) {
      return fp;
    }
    // Can't use fp.options because fp.options.field becomes an object due to mergeObject, not a jquery
    return new ForgeVTT_FilePicker({
      field: fp.field,
      type: fp.type,
      current: fp.request,
      button: fp.button,
    });
  }

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
  static async loadMD5Library() {
    if (typeof SparkMD5 !== "undefined") {
      return;
    }
    if (ForgeVTT.usingTheForge) {
      return this.loadScript("https://forge-vtt.com/lib/spark-md5.js");
    }
    return this.loadScript("/modules/forge-vtt/lib/spark-md5/md5.min.js");
  }

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

globalThis.FilePicker = ForgeVTT_FilePicker;

globalThis.FilePicker.LAST_BROWSED_DIRECTORY = ForgeVTT.usingTheForge ? ForgeVTT.ASSETS_LIBRARY_URL_PREFIX : "";
