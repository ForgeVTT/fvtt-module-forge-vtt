import { ForgeVTT } from "../ForgeVTT.mjs";
import { ForgeAPI } from "../ForgeAPI.mjs";
import { ForgeCompatibility } from "../ForgeCompatibility.mjs";
import { ForgeVTTFilePickerCore } from "../utils/ForgeVTTFilePickerCore.mjs";

/**
 * FilePicker implementation for Foundry VTT v12 and earlier
 * @augments {FilePicker}
 */
export class ForgeVTT_FilePicker extends FilePicker {
  /**
   * @param {...any} args - Constructor arguments
   */
  constructor(...args) {
    super(...args);

    /**
     * Whether this is an older FilePicker implementation (v0.5.5 and back)
     * @type {boolean}
     * @private
     */
    this._classicFilePicker = !ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "0.5.5");

    /**
     * Flag indicating whether we need to populate Forge buckets after initialization
     * @type {boolean}
     * @private
     */
    this._deferredPopulateForgeBuckets = !ForgeAPI.lastStatus;

    // Initialize Forge sources and infer directory
    this._populateForgeSources();
    this._inferCurrentDirectoryAndSetSource(this.request);
  }

  /* -------------------------------------------- */
  /*  Static Properties                           */
  /* -------------------------------------------- */

  /**
   * Keep our class name proper and the Hooks with the proper names
   * @type {string}
   */
  static get name() {
    return "FilePicker";
  }

  /* -------------------------------------------- */
  /*  Instance Properties                         */
  /* -------------------------------------------- */

  /**
   * Return a flag for whether the current user is able to upload file content
   * @override
   * @type {boolean}
   */
  get canUpload() {
    if (["forgevtt", "forge-bazaar"].includes(this.activeSource)) {
      return ForgeVTTFilePickerCore.canUploadToForge(this.activeSource, this.source.bucket);
    }
    if (ForgeVTT.usingTheForge) {
      return false;
    }
    return super.canUpload;
  }

  /* -------------------------------------------- */
  /*  Private Methods                             */
  /* -------------------------------------------- */

  /**
   * Populates the Forge sources for this FilePicker instance.
   * @private
   */
  _populateForgeSources() {
    this.sources = ForgeVTTFilePickerCore.populateForgeSources(this.sources || {});
  }

  /**
   * Helper method which calls _inferCurrentDirectory and sets the relevant properties based on the result.
   * @param {string} target - Asset URL (absolute or relative) to infer the current directory from.
   * @private
   */
  _inferCurrentDirectoryAndSetSource(target) {
    const superInferFn = (t) => super._inferCurrentDirectory(t);
    const [source, assetPath, bucketKey] = ForgeVTTFilePickerCore.inferForgeDirectory(target, superInferFn);

    // Set activeSource and target
    this.activeSource = source;
    this.sources[source].target = assetPath;

    if (bucketKey !== undefined) {
      this.sources[source].bucket = bucketKey;
    }
  }

  /**
   * Override _inferCurrentDirectory to utilize the core functionality.
   * @param {string} target - The target path to infer from
   * @returns {Array} Source, path, and bucket information
   * @private
   */
  _inferCurrentDirectory(target) {
    this._populateForgeSources();

    const superInferFn = (t) => super._inferCurrentDirectory(t);
    return ForgeVTTFilePickerCore.inferForgeDirectory(target, superInferFn);
  }

  /**
   * Get the bucket key for a specified bucket
   * @param {object} bucket - The bucket object
   * @returns {string|number} - The bucket key
   * @private
   */
  _getBucketKey(bucket) {
    const buckets = ForgeVTT_FilePicker._getForgeVTTBuckets();
    return ForgeVTTFilePickerCore.getBucketKey(
      bucket,
      buckets,
      ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, "12")
    );
  }

  /**
   * Retrieves the root directory of a bucket.
   * @param {object} bucket - The bucket object
   * @returns {string|undefined} The root directory of the bucket, or undefined
   * @private
   */
  _getBucketRootDir(bucket) {
    return ForgeVTTFilePickerCore.getBucketRootDir(bucket);
  }

  /**
   * Returns the relative path of a file within a bucket.
   * @param {object} bucket - The bucket object
   * @param {string} path - The path of the file
   * @returns {string} The relative path of the file within the bucket
   * @private
   */
  _getBucketRelativePath(bucket, path) {
    return ForgeVTTFilePickerCore.getBucketRelativePath(bucket, path);
  }

  /* -------------------------------------------- */
  /*  Data Preparation Methods                    */
  /* -------------------------------------------- */

  /**
   * Retrieves data from the super class and performs additional processing if the active source is "forgevtt".
   * @param {object} options - Optional parameters for retrieving data.
   * @returns {Promise<object>} - A promise that resolves to the retrieved data.
   * @override
   */
  async getData(options = {}) {
    const data = await super.getData(options);

    // Consider forgevtt source as S3 to have bucket selection if there are more than 1
    if (this.activeSource === "forgevtt" && this.source.buckets?.length > 1) {
      data.isS3 = true;
      data.bucket = this.source.bucket;
      data.buckets = this.source.buckets.map((key) => {
        const bucket = ForgeVTT_FilePicker._getForgeVttBucket(key);
        return bucket ? { value: key, label: bucket.label } : { value: key, label: key };
      });
    }

    return data;
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /**
   * Intercept and stop Foundry's _onChangeBucket "change" event to use our own handler instead
   * @param {Event} event - The change event object.
   * @returns {Promise<void>} - A promise that resolves when the browsing is complete.
   * @override
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
   * Handle user file selection
   * @override
   */
  _onPick(event) {
    const isFile = !event.currentTarget.classList.contains("dir");
    super._onPick(event);
    if (isFile) {
      this._onInputChange(this.element.find(".forgevtt-options"), this.element.find("input[name=file]"));
    }
  }

  /**
   * Handle file input change to update image manipulation options
   * @param options
   * @param input
   * @param _input
   * @private
   */
  _onInputChange(options, _input) {
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
    } catch (err) {
      console.error("Error processing file input change", err);
    }
  }

  /**
   * Helper for _onInputChange to update URL query parameters
   * @param input
   * @param query
   * @param value
   * @private
   */
  _setURLQuery(input, query, value) {
    ForgeVTTFilePickerCore.setURLQuery(input[0], query, value);
  }

  /**
   * Used for pre-0.5.6 foundry versions to create a new folder
   * @param ev
   * @param _ev
   * @private
   */
  _onNewFolder(_ev) {
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

            const response = await ForgeAPI.call(
              "assets/new-folder",
              { path },
              ForgeVTTFilePickerCore.bucketToCallOptions(this.source.bucket)
            );

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
      close: (_html) => {},
    }).render(true);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**
   * Renders the element and sets up event listeners for the ForgeVTT FilePicker.
   * @param {...any} args - Additional arguments passed to the parent _render method.
   * @returns {Promise<void>} - A promise that resolves when the rendering is complete.
   * @override
   */
  async _render(...args) {
    await super._render(...args);

    const html = this.element;
    const input = html.find("input[name=file]");

    // Create and append image manipulation options
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

    // Set up event handlers for the options
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

    // Handle different FilePicker versions
    if (this._classicFilePicker) {
      // Handle older Foundry versions
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
          </div>
        `);

        upload.hide();
        upload.after(uploadDiv);
        uploadDiv.append(upload);
        uploadDiv.find('button[name="forgevtt-upload"]').on("click", (_ev) => upload.click());
        uploadDiv.find('button[name="forgevtt-new-folder"]').on("click", (_ev) => this._onNewFolder());
      }
    } else {
      if (["forgevtt", "forge-bazaar"].includes(this.activeSource)) {
        html.find(`button[data-action="toggle-privacy"]`).remove();
        html.find(".form-group.bucket label").text("Select source");
      }

      // Handle image thumbnails
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
    }

    // Set up the bucket select
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

  /* -------------------------------------------- */
  /*  API Methods                                 */
  /* -------------------------------------------- */

  /**
   * @override
   */
  async browse(target, options = {}) {
    options._forgePreserveSource = true;

    if (this.activeSource === "forgevtt") {
      // If the Forge buckets weren't populated yet, then we didn't have a valid API status when this._inferCurrentDirectory was called.
      // Populate the buckets now and re-infer the current directory.
      if (this._deferredPopulateForgeBuckets) {
        await ForgeVTTFilePickerCore.getForgeVTTBucketsAsync();
        this._deferredPopulateForgeBuckets = false;
        this._populateForgeSources();
        this._inferCurrentDirectoryAndSetSource(target || this.request);
      }

      if (!this.sources.forgevtt.bucket && this.sources.forgevtt.buckets?.length > 0) {
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

      ForgeVTT_FilePicker.LAST_BROWSED_DIRECTORY = ForgeVTT.ASSETS_LIBRARY_URL_PREFIX + path + "/";
      game.settings.set("forge-vtt", "lastBrowsedDirectory", ForgeVTT_FilePicker.LAST_BROWSED_DIRECTORY);
    }

    return result;
  }

  /* -------------------------------------------- */
  /*  Static Methods                              */
  /* -------------------------------------------- */

  /**
   * Retrieves the Forge VTT buckets asynchronously.
   * @returns {Promise<Array>} A promise that resolves to an array of Forge VTT buckets.
   * @static
   */
  static async _getForgeVTTBucketsAsync() {
    return ForgeVTTFilePickerCore.getForgeVTTBucketsAsync();
  }

  /**
   * Retrieves and caches the Forge VTT buckets.
   * @param {object} status - The status object.
   * @returns {Array} An array of Forge VTT buckets.
   * @static
   */
  static _getForgeVTTBuckets(status = ForgeAPI.lastStatus || {}) {
    return ForgeVTTFilePickerCore.getForgeVTTBuckets(status);
  }

  /**
   * Retrieves the Forge VTT bucket based on the provided key or index.
   * @param {string|number} bucketKey - The key or index of the bucket to retrieve.
   * @returns {object} The Forge VTT bucket object.
   * @static
   */
  static _getForgeVttBucket(bucketKey) {
    return ForgeVTTFilePickerCore.getForgeVttBucket(bucketKey);
  }

  /**
   * Converts a bucket key or index to call options.
   * @param {string|number} bucketKey - The key or index of the bucket.
   * @returns {object} - The call options object.
   * @static
   */
  static _bucketToCallOptions(bucketKey) {
    return ForgeVTTFilePickerCore.bucketToCallOptions(bucketKey);
  }

  /**
   * Browse files for a certain directory location.
   * @override
   * @static
   */
  static async browse(source, target, options = {}) {
    if (source === "forge-vtt") {
      source = "forgevtt";
    }

    // wildcard for token images hardcodes source as 'data'
    if (target?.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
      source = "forgevtt";
    }

    // If we need to route through Forge assets library
    if (source === "forgevtt" || source === "forge-bazaar") {
      return ForgeVTTFilePickerCore.browseForgeAssets(
        source,
        target,
        options,
        (s, t, o) => super.browse(s, t, o) // Pass the method reference properly
      );
    }

    return super.browse(source, target, options);
  }

  /**
   * Configure path metadata settings.
   * @override
   * @static
   */
  static async configurePath(source, target, options = {}) {
    if (["forgevtt", "forge-bazaar"].includes(source)) {
      ui.notifications.error(
        "This feature is not supported in the Assets Library.<br/>Your Assets are all private and can be instead shared through the API Manager on your Account page on the Forge."
      );
      return { private: true };
    }

    return super.configurePath(source, target, options);
  }

  /**
   * Create a subdirectory within a given source.
   * @override
   * @static
   */
  static async createDirectory(source, target, options = {}) {
    return ForgeVTTFilePickerCore.createForgeDirectory(
      source,
      target,
      options,
      (s, t, o) => super.createDirectory(s, t, o) // Pass the method reference properly
    );
  }

  /**
   * Upload a file to the server or the Forge assets library.
   * @override
   * @static
   */
  static async upload(source, target, file, body = {}, options = { notify: true }) {
    // Handle different parameter order in older Foundry versions
    if (typeof body === "boolean" || (typeof body === "object" && body !== null && body.hasOwnProperty("notify"))) {
      return ForgeVTTFilePickerCore.uploadToForge(
        source,
        target,
        file,
        {}, // Empty body
        { notify: body }, // Older versions passed notify directly as param
        (s, t, f, b, _o) => super.upload(s, t, f, b) // Original takes 4 params
      );
    }

    return ForgeVTTFilePickerCore.uploadToForge(
      source,
      target,
      file,
      body,
      options,
      (s, t, f, b, o) => super.upload(s, t, f, b, o) // Newer v12 takes 5 params
    );
  }

  /**
   * Upload many files to the Forge user's assets library, at once.
   * @param {string} source           Must be "forgevtt"
   * @param {Array<object>} files     Array of objects of the form: {target, file}
   * @param options
   * @returns {Array<string>}         Array of urls or null values if unable to upload (or returns null in case of error)
   * @static
   */
  static async _uploadMany(source, files, options = {}) {
    return ForgeVTTFilePickerCore.uploadManyToForge(source, files, options);
  }

  /**
   * Create a FilePicker instance from a button element.
   * @override
   * @static
   */
  static fromButton(button) {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("You must pass an HTML button");
    }

    const fp = super.fromButton(button);
    if (!fp) {
      return fp;
    }

    return new ForgeVTT_FilePicker({
      field: fp.field,
      type: fp.type,
      current: fp.request,
      button: fp.button,
    });
  }

  /**
   * Calculate an etag from a file for deduplication purposes.
   * @param {File} file       The file to hash
   * @param {Function} progress  Optional progress callback function
   * @returns {Promise<string>}  A promise which resolves to the MD5 hash
   * @static
   */
  static async etagFromFile(file, progress = null) {
    return ForgeVTTFilePickerCore.etagFromFile(file, progress);
  }

  /**
   * Load a JavaScript library from a URL.
   * @param {string} url - The URL of the script to load
   * @returns {Promise<void>} A promise that resolves when the script is loaded
   * @static
   */
  static async loadScript(url) {
    return ForgeVTTFilePickerCore.loadScript(url);
  }

  /**
   * Load the MD5 library for file hashing.
   * @returns {Promise<void>} A promise that resolves when the library is loaded
   * @static
   */
  static async loadMD5Library() {
    return ForgeVTTFilePickerCore.loadMD5Library();
  }
}
