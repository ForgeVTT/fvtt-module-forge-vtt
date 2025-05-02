/**
 * @file ForgeVTT FilePicker implementation for Foundry VTT v13+
 */

import { ForgeVTT } from "../ForgeVTT.mjs";
import { ForgeAPI } from "../ForgeAPI.mjs";
import { ForgeVTTFilePickerCore } from "../utils/ForgeVTTFilePickerCore.mjs";

export let ForgeVTT_FilePicker_V2;

if (foundry?.applications?.apps?.FilePicker) {
  /**
   * ForgeVTT FilePicker implementation for Foundry VTT v13+
   * @augments {foundry.applications.apps.FilePicker}
   */
  ForgeVTT_FilePicker_V2 = class extends foundry.applications.apps.FilePicker {
    /**
     * @param {unknown} [options] Configuration options
     */
    constructor(options = {}) {
      super(options);

      /**
       * Flag indicating whether we need to populate Forge buckets after initialization
       * @type {boolean}
       * @private
       */
      this._deferredPopulateForgeBuckets = !ForgeAPI.lastStatus;

      // Initialize Forge sources
      this.#populateForgeSources();

      // Set our source and directories based on the request
      this.#inferCurrentDirectoryAndSetSource(this.request);
    }

    /* -------------------------------------------- */
    /*  Static Properties                           */
    /* -------------------------------------------- */

    /**
     * Default Options Configuration
     * @override
     */
    static DEFAULT_OPTIONS = {
      actions: {
        // Add our custom actions to the default ones
        changeBucket: this.onChangeBucket,
        toggleOptimizer: this.onToggleOptimizer,
        toggleFlip: this.onToggleFlip,
        toggleFlop: this.onToggleFlop,
        changeBlur: this.onChangeBlur,
        makeNewFolder: this.onMakeNewFolder,
        pickFile: this.onPickFile,
      },
    };

    /**
     * Define parts templates - override to add our Forge options section
     * @override
     */
    static get PARTS() {
      return {
        tabs: super.PARTS.tabs,
        subheader: super.PARTS.subheader,
        body: super.PARTS.body,
        options: {
          template: "/modules/forge-vtt/templates/file-picker-options.hbs",
        },
        subfooter: super.PARTS.subfooter,
        footer: super.PARTS.footer,
      };
    }

    /**
     * Override TABS to include our custom sources
     * @override
     */
    static TABS = {
      ...this.TABS,
      sources: {
        tabs: [
          { id: "data", label: "FILES.TABS.data", icon: "fa-solid fa-database", group: "sources" },
          { id: "public", label: "FILES.TABS.public", icon: "fa-solid fa-server", group: "sources" },
          { id: "s3", label: "FILES.TABS.s3", icon: "fa-solid fa-cloud-arrow-up", group: "sources" },
          { id: "forgevtt", icon: "fa-solid fa-cloud", label: "The Forge Assets", group: "sources" },
          { id: "forge-bazaar", icon: "fa-solid fa-cloud", label: "The Bazaar", group: "sources" },
        ],
        initial: "data",
      },
    };

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
    #populateForgeSources() {
      this.sources = ForgeVTTFilePickerCore.populateForgeSources(this.sources || {});
    }

    /**
     * Helper method which determines the source, path, and bucket from a target URL.
     * @param {string} target - Asset URL (absolute or relative) to infer the current directory from
     * @private
     */
    #inferCurrentDirectoryAndSetSource(target) {
      const buckets = ForgeVTTFilePickerCore.getForgeVTTBuckets();

      if (buckets.length === 0 || !this.sources.forgevtt) {
        // No Forge integration needed, just leave the parent class's settings
        return;
      }

      // Check if this is a Forge asset URL
      if (target && target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
        const assetPath = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length);

        // Handle Forge Bazaar paths
        if (ForgeVTT.usingTheForge && assetPath.startsWith("bazaar/")) {
          const parts = assetPath.split("/").slice(1, -1); // Remove bazaar prefix and filename from the path
          const bazaarPath = [parts[0], parts[1], ...parts.slice(3)].join("/"); // Remove assets folder name from the path

          this.activeSource = "forge-bazaar";
          this.sources["forge-bazaar"].target = bazaarPath;
          return;
        }

        // Non-bazaar - so it's a forgevtt asset
        const parts = assetPath.split("/");
        const userId = parts[0];
        // Remove userid and filename from url to get target path
        const forgePath = `${decodeURIComponent(parts.slice(1, -1).join("/"))}/`;

        // Check if this is the user's own asset
        const userBucket = buckets.find((b) => b.userId === userId);
        if (userBucket) {
          const userBucketKey = ForgeVTTFilePickerCore.getBucketKey(userBucket, buckets, true);

          this.activeSource = "forgevtt";
          this.sources.forgevtt.target = forgePath;
          this.sources.forgevtt.bucket = userBucketKey;
          return;
        }

        // Find the bucket which permits access to this asset
        const sharedBucket = buckets.find(
          (bucket) =>
            userId === bucket.userId &&
            (!ForgeVTTFilePickerCore.getBucketRootDir(bucket) ||
              forgePath.startsWith(ForgeVTTFilePickerCore.getBucketRootDir(bucket)))
        );

        if (sharedBucket) {
          const sharedBucketKey = ForgeVTTFilePickerCore.getBucketKey(sharedBucket, buckets, true);
          const sharedBucketRelativePath = ForgeVTTFilePickerCore.getBucketRelativePath(sharedBucket, forgePath);

          this.activeSource = "forgevtt";
          this.sources.forgevtt.target = sharedBucketRelativePath;
          this.sources.forgevtt.bucket = sharedBucketKey;
          return;
        }

        // Fallback - default to our own assets library
        const defaultBucket = buckets[0];
        const defaultBucketKey = ForgeVTTFilePickerCore.getBucketKey(defaultBucket, buckets, true);

        this.activeSource = "forgevtt";
        this.sources.forgevtt.target = "";
        this.sources.forgevtt.bucket = defaultBucketKey;
        return;
      }

      // Special handling for The Forge users
      if (ForgeVTT.usingTheForge && target) {
        // If not an assets URL but the path is not a known core data folder and isn't a module or system folder
        // then we can assume that it won't be a folder that exists in data and we can infer the source as being
        // from the assets library, even if it's a relative path
        const dataDirs = ["systems", "modules"];
        const publicDirs = ["cards", "icons", "sounds", "ui"];

        if ([...dataDirs, ...publicDirs].every((folder) => !target.startsWith(`${folder}/`))) {
          this.activeSource = "forgevtt";
          this.sources.forgevtt.target = target;
          return;
        }
      }

      // If we had no special handling, we'll leave the parent's settings intact
    }

    /* -------------------------------------------- */
    /*  Static Event Handlers                       */
    /* -------------------------------------------- */

    /*
     * A note for the uninitiated:
     *
     * In ApplicationV2, we can provide "actions" to the default options of
     * an application that represent events. They're always static methods,
     * and `this` is always bound to the instance of the application.
     */

    /**
     * Handle changing the bucket in the FilePicker.
     * @param {Event} _event - The change event
     * @param {HTMLSelectElement} select - The select element
     * @private
     */
    static async onChangeBucket(_event, select) {
      const fp = this;
      if (select.name !== "bucket") {
        return;
      }

      select.disabled = true;
      fp.activeSource = "forgevtt";
      fp.source.bucket = select.value;
      fp.sources.forgevtt.bucket = select.value;

      await fp.browse("/");
      select.disabled = false;
    }

    /**
     * Handle toggling the optimizer option.
     * @param {Event} _event - The change event
     * @param {HTMLInputElement} input - The checkbox input
     * @private
     */
    static onToggleOptimizer(_event, input) {
      const fp = this;
      const fileInput = fp.element.querySelector('input[name="file"]');
      ForgeVTTFilePickerCore.setURLQuery(fileInput, "optimizer", input.checked ? "disabled" : null);
    }

    /**
     * Handle toggling the flip option.
     * @param {Event} _event - The change event
     * @param {HTMLInputElement} input - The checkbox input
     * @private
     */
    static onToggleFlip(_event, input) {
      const fp = this;
      const fileInput = fp.element.querySelector('input[name="file"]');
      ForgeVTTFilePickerCore.setURLQuery(fileInput, "flip", input.checked ? "true" : null);
    }

    /**
     * Handle toggling the flop option.
     * @param {Event} _event - The change event
     * @param {HTMLInputElement} input - The checkbox input
     * @private
     */
    static onToggleFlop(_event, input) {
      const fp = this;
      const fileInput = fp.element.querySelector('input[name="file"]');
      ForgeVTTFilePickerCore.setURLQuery(fileInput, "flop", input.checked ? "true" : null);
    }

    /**
     * Handle changing the blur amount.
     * @param {Event} _event - The change event
     * @param {HTMLSelectElement} select - The select element
     * @private
     */
    static onChangeBlur(_event, select) {
      const fp = this;
      const fileInput = fp.element.querySelector('input[name="file"]');
      ForgeVTTFilePickerCore.setURLQuery(fileInput, "blur", select.value);
    }

    /**
     * Handle the creation of a new folder.
     * @param {Event} _event - The click event
     * @returns {DialogV2} A confirmation dialog
     * @private
     */
    static async onMakeNewFolder(_event) {
      const fp = this;
      if (fp.activeSource !== "forgevtt") {
        return;
      }

      const labelText =
        game.i18n.localize("FILES.DirectoryName.Label") || "Enter the name of the folder you want to create";
      const placeholder = game.i18n.localize("FILES.DirectoryName.Placeholder") || "directory-name";

      const content = `<div class="form-group">
    <label for="create-directory-name">${labelText}</label>
    <div class="form-fields">
    <input id="create-directory-name" type="text" name="dirname" placeholder="${placeholder}" required autofocus>
    </div></div>`;

      return foundry.applications.api.DialogV2.confirm({
        id: "create-directory",
        window: { title: "Create New Assets Folder", icon: "fa-solid fa-folder-plus" },
        content,
        yes: {
          label: "Create Folder",
          icon: "fa-solid fa-folder-plus",
          callback: async (event) => {
            const dirname = event.currentTarget.querySelector("input").value.trim();
            if (!dirname) {
              return;
            }

            const path = `${fp.target}/${dirname}`;
            try {
              await ForgeAPI.call(
                "assets/new-folder",
                { path },
                ForgeVTTFilePickerCore.bucketToCallOptions(fp.source.bucket)
              );

              ui.notifications.info("Folder created successfully");
              return fp.browse(path);
            } catch (err) {
              ui.notifications.error(err.message);
            }
          },
        },
        no: { label: "Cancel" },
      });
    }

    /**
     * Handle file selection within the file picker
     * @this {FilePicker}
     * @param {Event} _event - The DOM event fired when selecting a file
     * @param {HTMLLIElement} pickedRow - The selected file's HTML element
     */
    static async onPickFile(_event, pickedRow) {
      const form = this.element;
      for (const row of pickedRow.closest("ul").children) {
        row.classList.toggle("picked", row === pickedRow);
      }
      if (form.elements.file) {
        form.elements.file.value = pickedRow.dataset.path;
        this._onFileInputChange(form.elements.file.value);
      }
    }

    /* -------------------------------------------- */
    /*  Forge FilePicker Methods                    */
    /* -------------------------------------------- */

    /**
     * Handle changes to the file selection input.
     * @param {HTMLInputElement} _input - The file input element
     * @private
     * @todo This is intentionally disabled until we re-implement the optimizer.
     */
    _onFileInputChange(_input) {
      // FIXME: disabling the optimizer options until the feature is re-implemented
      const target = null; // input.value;
      const optionsSection = this.element.querySelector(".forgevtt-options");

      if (!optionsSection) {
        return;
      }

      if (!target || !target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
        optionsSection.style.display = "none";
        this.setPosition({ height: "auto" });
        return;
      }

      try {
        const url = new URL(target);
        const isImage =
          [".jpg", ".png", ".svg"].includes(url.pathname.toLowerCase().slice(-4)) ||
          [".jpeg", ".webp"].includes(url.pathname.toLowerCase().slice(-5));

        if (!isImage) {
          optionsSection.style.display = "none";
          this.setPosition({ height: "auto" });
          return;
        }

        const noOptimizer = url.searchParams.get("optimizer") === "disabled";
        const flip = url.searchParams.get("flip") === "true";
        const flop = url.searchParams.get("flop") === "true";
        const blur = parseInt(url.searchParams.get("blur")) || 0;

        optionsSection.querySelector('input[name="no-optimizer"]').checked = noOptimizer;
        optionsSection.querySelector('input[name="flip"]').checked = flip;
        optionsSection.querySelector('input[name="flop"]').checked = flop;
        optionsSection.querySelector('select[name="blur"]').value = blur;

        optionsSection.style.display = "";
        this.setPosition({ height: "auto" });
      } catch (err) {
        console.error("Error processing file input change", err);
      }
    }

    /**
     * Search among shown directories and files.
     * @param {KeyboardEvent} _event The triggering event
     * @param {string} _query The search input value
     * @param {RegExp} rgx - The pattern to search for
     * @param {HTMLElement} html - The HTML elements we're searching through
     * @protected
     */
    _onSearchFilter(_event, _query, rgx, html) {
      if (html) {
        for (const list of html.querySelectorAll("ul")) {
          let matched = false;
          for (const row of list.children) {
            const match = foundry.applications.ux.SearchFilter.testQuery(rgx, row.dataset.name);
            if (match) {
              matched = true;
            }
            row.style.display = !match ? "none" : "";
          }
          list.style.display = matched ? "" : "none";
        }
      }
      this.setPosition({ height: "auto" });
    }

    /* -------------------------------------------- */
    /*  Lifecycle Methods                           */
    /* -------------------------------------------- */

    /**
     * @override
     */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.tabs = this.constructor.TABS.sources.tabs;
      if (ForgeVTT.usingTheForge) {
        context.tabs = context.tabs.filter((t) => t.id !== "s3");
      }

      // Consider forgevtt source as S3 to have bucket selection if there are more than 1
      if (this.activeSource === "forgevtt" && this.sources.forgevtt.buckets?.length > 1) {
        context.isS3 = true;
        context.bucket = this.source.bucket;
        context.buckets = this.sources.forgevtt.buckets.map((key) => {
          const bucket = ForgeVTTFilePickerCore.getForgeVttBucket(key);
          return bucket ? { value: key, label: bucket.label } : { value: key, label: key };
        });
      }

      return context;
    }

    /**
     * @override
     */
    async _onRender(context, options) {
      await super._onRender(context, options);

      // Update the bucket options with proper labels
      const select = this.element.querySelector('select[name="bucket"]');
      if (select) {
        const bucketOptions = select.querySelectorAll("option");
        for (const option of bucketOptions) {
          const bucket = ForgeVTTFilePickerCore.getForgeVttBucket(option.value);
          if (bucket) {
            option.textContent = bucket.label;
          }
        }
      }

      // Set up the file input change handler
      const fileInput = this.element.querySelector('input[name="file"]');
      if (fileInput) {
        fileInput.addEventListener("input", () => this._onFileInputChange(fileInput));
        this._onFileInputChange(fileInput);
      }

      // If using forge, manage folder creation button visibility
      if (["forgevtt", "forge-bazaar"].includes(this.activeSource)) {
        const privacyBtn = this.element.querySelector('button[data-action="toggle-privacy"]');
        if (privacyBtn) {
          privacyBtn.style.display = "none";
        }

        if (this.element.querySelector(".form-group.bucket label")) {
          this.element.querySelector(".form-group.bucket label").textContent = "Select source";
        }
      }

      // For image thumbnails that are forge assets, add height parameter for optimization
      const images = this.element.querySelectorAll("img");
      for (const img of images) {
        if (img.dataset.src && img.dataset.src.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
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
          this.#populateForgeSources();
          this.#inferCurrentDirectoryAndSetSource(target || this.request);
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

        ForgeVTTFilePickerCore.LAST_BROWSED_DIRECTORY = ForgeVTT.ASSETS_LIBRARY_URL_PREFIX + path + "/";
        game.settings.set("forge-vtt", "lastBrowsedDirectory", ForgeVTTFilePickerCore.LAST_BROWSED_DIRECTORY);
      }

      return result;
    }

    /* -------------------------------------------- */
    /*  Static API Methods                          */
    /* -------------------------------------------- */

    /**
     * Browse files for a certain directory location.
     * @override
     */
    static async browse(source, target, options = {}) {
      // If the target is a ForgeVTT asset URL, update the source
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
     */
    static async upload(source, target, file, body = {}, options = { notify: true }) {
      return ForgeVTTFilePickerCore.uploadToForge(
        source,
        target,
        file,
        body,
        options,
        (s, t, f, b, o) => super.upload(s, t, f, b, o) // Pass the method reference properly
      );
    }

    /**
     * Upload many files to the Forge user's assets library, at once.
     * @param {string} source           Must be "forgevtt"
     * @param {Array<object>} files     Array of objects of the form: {target, file}
     * @param {unknown} options - Options to send along
     * @returns {Array<string>}         Array of urls or null values if unable to upload (or returns null in case of error)
     */
    static async _uploadMany(source, files, options = {}) {
      return ForgeVTTFilePickerCore.uploadManyToForge(source, files, options);
    }

    /**
     * Create a FilePicker instance from a button element.
     * @override
     */
    static fromButton(button) {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("You must pass an HTML button");
      }

      const type = button.getAttribute("data-type");
      const form = button.form;
      const field = form[button.dataset.target] || null;
      const current = field?.value || "";

      return new ForgeVTT_FilePicker_V2({ field, type, current, button });
    }

    /**
     * Calculate an etag from a file for deduplication purposes.
     * @param {File} file       The file to hash
     * @param {Function} progress  Optional progress callback function
     * @returns {Promise<string>}  A promise which resolves to the MD5 hash
     */
    static async etagFromFile(file, progress = null) {
      return ForgeVTTFilePickerCore.etagFromFile(file, progress);
    }
  };
}
