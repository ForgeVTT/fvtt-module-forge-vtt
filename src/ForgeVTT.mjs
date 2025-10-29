import { ForgeAPI } from "./ForgeAPI.mjs";
import { ForgeVTTPWA } from "./applications/ForgeVTTPWA.mjs";
import { ForgeCompatibility } from "./ForgeCompatibility.mjs";
import { ForgeVTT_FilePicker } from "./applications/ForgeVTTFilePicker.mjs";
import { HTMLApplication } from "./HTMLApplication.mjs";

export class ForgeVTT {
  static setupForge() {
    // Verify if we're running on the forge or not, and set things up accordingly
    this.usingTheForge = window.location.hostname.endsWith(".forge-vtt.com");
    this.HOSTNAME = "forge-vtt.com";
    this.DOMAIN = "forge-vtt.com";
    this.UPLOAD_API_ENDPOINT = `https://upload.${ForgeVTT.DOMAIN}`;
    this.FORGE_URL = `https://${this.HOSTNAME}`;
    this.ASSETS_LIBRARY_URL_PREFIX = "https://assets.forge-vtt.com/";

    ForgeCompatibility.prepareFilePicker();

    if (this.usingTheForge) {
      // Welcome!
      console.log(
        "%c     ",
        "font-size:200px; background:url(https://forge-vtt.com/images/the-forge-logo-200x200.png) no-repeat;"
      );
      console.log("%cWelcome to the Forge!", "font-size: 40px");

      const parts = window.location.host.split(".");
      this.gameSlug = parts[0];
      this.HOSTNAME = parts.slice(1).join(".");
      this.FORGE_URL = `https://${this.HOSTNAME}`;
      this.GAME_URL = `https://${this.gameSlug}.${this.HOSTNAME}`;
      this.LIVEKIT_SERVER_URL = `livekit.${this.HOSTNAME}`;
      const local = this.HOSTNAME.match(/^(dev|qa|local)(\.forge-vtt\.com)/);
      if (local) {
        this.ASSETS_LIBRARY_URL_PREFIX = `https://assets.${this.HOSTNAME}/`;
        if (this.HOSTNAME.startsWith("qa.forge-vtt.com")) {
          this.ASSETS_LIBRARY_URL_PREFIX = `https://assets.dev.forge-vtt.com/`;
        }
        this.DOMAIN = this.HOSTNAME;
        this.UPLOAD_API_ENDPOINT = "assets/upload";
        this._usingDevServer = true;
      }
      if (this.HOSTNAME === "staging.forge-vtt.com") {
        this.DOMAIN = "staging.forge-vtt.com";
        this.UPLOAD_API_ENDPOINT = "assets/upload";
      }

      // Only add the progress bar if we're loading a game
      if (window.location.pathname === "/game") {
        ForgeVTT.injectProgressBar();
      }
    }
  }

  /**
   * Logs messages to the console with a "The Forge" prefix.
   * @param {...any} args - The messages or objects to log.
   */
  static log(...args) {
    console.log("%cThe Forge", "font-weight: bold", "|", ...args);
  }
  /**
   * Logs error messages to the console with a "The Forge" prefix.
   * @param {...any} args - The error messages or objects to log.
   */
  static logError(...args) {
    console.error("%cThe Forge", "font-weight: bold", "|", ...args);
  }

  /**
   * We need our own isObjectEmpty because it was deprecated in v10 and now requires the use of foundry.utils.isEmpty
   * but we can't see which version of Foundry we're running on if game.data is itself empty...
   * Re-implementing it is easier than trying to check whether foundry.utils.isEmpty is accessible or not
   * @param obj
   */
  static isObjectEmpty(obj) {
    return !obj || typeof obj !== "object" || Object.keys(obj).length === 0;
  }

  /**
   * Determines if the current Foundry VTT version is newer than the specified target version.
   *
   * @param {string} target The version to check against
   * @returns {boolean} True if the current Foundry VTT version is newer than the target version, otherwise false.
   */
  static isFoundryNewerThan(target) {
    return ForgeCompatibility.isNewerVersion(ForgeVTT.foundryVersion, target);
  }

  static init() {
    /* Test for Foundry bug where world doesn't load. Can be worse in 0.8.x and worse even if user has duplicate packs */
    if (window.location.pathname === "/game" && this.isObjectEmpty(game.data)) {
      console.warn("Detected empty world data. Reloading the page as a workaround for a Foundry bug");
      setTimeout(() => window.location.reload(), 1000);
    }

    // Get API call running
    if (this.usingTheForge) {
      ForgeAPI.status().catch(() => null);
    }

    ForgeVTT._registerSettings();
    ForgeVTT._applyCORSFixes();
    ForgeVTT._patchDataImageHandling();

    if (this.usingTheForge) {
      ForgeVTT._initForgeFeatures();
    } else {
      ForgeVTT._initStandaloneFeatures();
    }

    ForgeVTT._applySystemOverrides();
  }

  static _registerSettings() {
    // Register Settings
    game.settings.register("forge-vtt", "apiKey", {
      name: "API Secret Key",
      hint: "API Key to access the Forge assets library. Leave empty to use your own account while playing on The Forge. API Key is available in the My Account page.",
      scope: "client",
      config: true,
      default: "",
      type: String,
    });
    game.settings.register("forge-vtt", "lastBrowsedDirectory", {
      name: "Last Browsed Directory",
      hint: "Last Browsed Directory",
      scope: "client",
      default: "",
      type: String,
    });
  }

  static _applyCORSFixes() {
    // Fix critical 0.6.6 bug
    if (ForgeVTT.foundryVersion === "0.6.6") {
      ForgeCompatibility.TextureLoader.prototype._attemptCORSReload = async function (src, resolve, reject) {
        try {
          if (src && src.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            return reject(`Failed to load texture ${src}`);
          }
          if (/https?:\/\//.test(src)) {
            const url = new URL(src);
            const isCrossOrigin = url.origin !== window.location.origin;
            if (isCrossOrigin && !/\?cors-retry=/.test(url.search)) {
              url.search += `?cors-retry=${Date.now()}`;
              return this.loadImageTexture(url.href)
                .then((tex) => {
                  this.setCache(src, tex);
                  resolve(tex);
                })
                .catch(reject);
            }
          }
        } catch {
          // noop
        }
        return reject(`Failed to load texture ${src}`);
      };
    } else {
      // Avoid the CORS retry for Forge assets library
      const original = ForgeCompatibility.TextureLoader.prototype._attemptCORSReload;
      if (original) {
        ForgeCompatibility.TextureLoader.prototype._attemptCORSReload = async function (src, resolve, reject) {
          try {
            if (src && src.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
              return reject(`Failed to load texture ${src}`);
            }
          } catch {
            // noop
          }
          return original.call(this, src, resolve, reject).catch(reject);
        };
      }
      // Foundry v11 uses a different method to do CORS retries. Override it if it exists
      const originalBustCache = ForgeCompatibility.TextureLoader.getCacheBustURL;
      if (originalBustCache) {
        ForgeCompatibility.TextureLoader.getCacheBustURL = function (src) {
          try {
            if (src && src.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
              return false;
            }
          } catch {
            // noop
          }
          return originalBustCache.call(this, src);
        };
      }
    }
  }

  static _patchDataImageHandling() {
    // Foundry 0.8.x
    if (ForgeVTT.isFoundryNewerThan("0.8.0")) {
      // we need to do this for BaseActor and BaseMacro as well because they override the two methods but don't call `super`
      for (const klass of [foundry.abstract.Document, foundry.documents.BaseActor, foundry.documents.BaseMacro]) {
        const preCreate = klass.prototype._preCreate;
        klass.prototype._preCreate = async function (data, _options, _user) {
          await ForgeVTT.findAndDestroyDataImages(this.documentName, data).catch(() => null);
          return preCreate.call(this, ...arguments);
        };
        const preUpdate = klass.prototype._preUpdate;
        klass.prototype._preUpdate = async function (changed, _options, _user) {
          await ForgeVTT.findAndDestroyDataImages(this.documentName, changed).catch(() => null);
          return preUpdate.call(this, ...arguments);
        };
      }
    } else if (ForgeVTT.isFoundryNewerThan("0.7.0")) {
      const create = Entity.create;
      Entity.create = async function (data, _options) {
        await ForgeVTT.findAndDestroyDataImages(this.entity, data).catch(() => null);
        return create.call(this, ...arguments);
      };
      const update = Entity.update;
      Entity.update = async function (data, _options) {
        await ForgeVTT.findAndDestroyDataImages(this.entity, data).catch(() => null);
        return update.call(this, ...arguments);
      };
    }
  }

  static _initForgeFeatures() {
    // Replacing MESSAGES allows Forge to set Forge specific strings before translations are loaded
    ForgeVTT.replaceFoundryMessages();
    // Translations are loaded after the init hook is called but may be used before the ready hook is called
    // To ensure Forge strings are available we must also replace translations on renderNotifications
    Hooks.once("renderNotifications", () => ForgeVTT.replaceFoundryTranslations());
    if (window.location.pathname.startsWith("/join")) {
      ForgeVTT._patchJoinScreen();
    } else if (window.location.pathname.startsWith("/setup")) {
      ForgeVTT._patchSetupScreen();
      ForgeVTT._patchMigrationFlow();
    }

    ForgeVTT._patchSettingsScreen();
    ForgeVTT._patchMainMenu();
    ForgeVTT._patchPlayerList();
    ForgeVTT._patchInvitationLinks();
    ForgeVTT._patchActorImageFallback();
    ForgeVTT._patchActivityTracking();
  }

  static _patchJoinScreen() {
    // Add return to setup for 0.7.x
    this._addReturnToSetup();
    // Add Return to Setup to 0.8.x (hook doesn't exist in 0.7.x)
    Hooks.on("renderJoinGameForm", (_obj, html) => this._addReturnToSetup(html));
  }

  // On v9, a request to install a package returns immediately and Foundry waits for the package installation
  // to be done asynchronously via a websocket progress signal.
  // Since we can do instant installations from the Bazaar and we can't intercept/inject signals into the websocket
  // connection from the server side, we instead hijack the `Setup.post` on the client side so if a package is installed
  // successfully and synchronsouly (a Bazaar install, not a protected content), we can fake a progress report
  // of step "Package" which vends the API result.

  static #preparePostOverride(origPost) {
    return async function (data, ...args) {
      const pendingResponse = origPost.call(this, data, ...args);
      if (data.action !== "installPackage") {
        return pendingResponse;
      }
      const response = await pendingResponse;
      let result;
      if (ForgeVTT.isFoundryNewerThan("11")) {
        // In v11, Setup.post() returns an object, not a Response
        result = response;
      } else {
        result = await response.json();
        // After reading the data, we need to replace the json method to return
        // the json data, since it can only be called once
        response.json = async () => result;
      }
      ForgeVTT.log(`Proxy installPackage (${result.id})`, result);
      if (result.installed) {
        if (ForgeVTT.isFoundryNewerThan("13")) {
          ui.setupPackages.onProgress(result);
          await this.reload();
        } else {
          this._onProgress(result);
        }
      }
      return response;
    };
  }

  static _patchSetupScreen() {
    if (ForgeVTT.isFoundryNewerThan("13")) {
      // In v13+ we need to patch `game` to override its post method.
      game.post = ForgeVTT.#preparePostOverride(game.post);

      game._addProgressListener(async (progressData) => {
        if (
          progressData.action === "installPackage" &&
          progressData.step === CONST.SETUP_PACKAGE_PROGRESS.STEPS.COMPLETE
        ) {
          ForgeVTT.log(`Action installPackage (${progressData.id}) complete`, progressData);
          await game.reload();
        }
      });
    } else if (ForgeVTT.isFoundryNewerThan("9")) {
      // For v9-v12, we can patch the Setup class to override its post method.
      Setup.post = ForgeVTT.#preparePostOverride(Setup.post);
    }

    // Remove Configuration tab from /setup page
    // Pre-v11
    Hooks.on("renderSetupConfigurationForm", (_setup, html) => {
      ForgeVTT.ensureIsJQuery(html).find(`a[data-tab="configuration"],a[data-tab="update"]`).remove();
    });
    // v11
    Hooks.on("renderSetupMenu", (_setup, html) => {
      // Remove update
      ForgeVTT.ensureIsJQuery(html).find('button[data-action="update"]').remove();
      ForgeVTT.ensureIsJQuery(html).find('button[data-action="configure"] .pip.warning').hide();
    });

    // v11 requires that we keep the setup-configuration button active but allow only telemetry to be set
    Hooks.on("renderSetupApplicationConfiguration", (setup, html) => {
      // Remove all form groups except the one that has the telemetry input
      ForgeVTT.ensureIsJQuery(html)
        .find(".form-group")
        .not(":has(input[name=telemetry]), :has(select[name=cssTheme])")
        .remove();
      // Adjust style properties so the window appears in the middle of the screen rather than very top
      setup.element[0].style.top = setup.element[0].style.left = "";
      setup.setPosition({ height: "auto" });
    });

    // Starting in v13, this is the new hook for rendering the settings window
    Hooks.on("renderServerSettingsConfig", (setup, html) => {
      // Remove all form groups except the one that has the telemetry input
      ForgeVTT.ensureIsJQuery(html)
        .find(".form-group")
        .not(":has(input[name=telemetry]), :has(select[name=cssTheme])")
        .remove();
      // Remove fieldsets without fields
      ForgeVTT.ensureIsJQuery(html).find("fieldset:not(:has(.form-group))").remove();

      // Adjust style properties so the window appears in the middle of the screen rather than very top
      setup.element[0].style.top = setup.element[0].style.left = "";
      setup.setPosition({ height: "auto" });
    });
  }

  static _patchMigrationFlow() {
    if (!ForgeVTT.isFoundryNewerThan("11")) {
      return;
    }
    // v11 requires that we export worlds before migration if on Forge so that we can set deleteNEDB
    // This removes unused NEDB databases from pre-v11 worlds which would otherwise swell user data use
    Hooks.on("renderSetupPackages", (_setup, html) => {
      // Use jQuery's find method to select all the world elements
      const worldElements = ForgeVTT.ensureIsJQuery(html).find("li.package.world");
      // Loop through each world element
      worldElements.each(function () {
        // Within each world element, find the worldLaunch button and the world slug
        const packageId = $(this).attr("data-package-id");
        const worldLaunchButton = $(this).find('a[data-action="worldLaunch"]');
        // Attach the event listener to the "worldLaunch" button
        worldLaunchButton.on("click", () => {
          // Get the parent <li> element
          const dialogHookFunction = (_dialogSetup, dialogHtml) => {
            // Ascertain that the dialog is the "Begin Migration" dialog
            const jqHtml = ForgeVTT.ensureIsJQuery(dialogHtml);
            if (jqHtml.find(".window-title").text() !== game.i18n.localize("SETUP.WorldMigrationRequiredTitle")) {
              return;
            }

            // Find the "Begin Migration" button and hide it initially
            const beginMigrationButton = ForgeVTT.isFoundryNewerThan("13")
              ? jqHtml.find("button[data-action='yes']")
              : jqHtml.find(".dialog-button.yes"); // v12 and older
            beginMigrationButton.hide();
            // Create and prepend an "Export Backup to Migrate" button
            const exportBackupButton = $(
              `<button type="button" class="dialog-button yes"><i class="fa-solid fa-download"></i>${game.i18n.localize(
                "THEFORGE.MigrationExportBackup"
              )}</button>`
            );
            exportBackupButton.on("click", async () => {
              exportBackupButton.off("click");
              // Do not use window.location since this interrupts ws connection
              window.open(`${ForgeVTT.FORGE_URL}/setup/export/${packageId}`, "_blank");
              exportBackupButton.text(game.i18n.localize("THEFORGE.MigrationExporting"));
              const cb = () => {
                exportBackupButton.hide();
                beginMigrationButton.show();
              };
              new Dialog({
                title: game.i18n.localize("THEFORGE.MigrationExportDialogTitle"),
                content: `<p>${game.i18n.localize("THEFORGE.MigrationExportDialogContent")}</p>`,
                buttons: {
                  yes: {
                    icon: "<i class='fas fa-check'></i>",
                    label: game.i18n.localize("THEFORGE.MigrationExportComplete"),
                    callback: cb,
                  },
                  no: {
                    icon: "<i class='fas fa-times'></i>",
                    label: game.i18n.localize("THEFORGE.MigrationExportCancel"),
                    callback: cb,
                  },
                },
                default: "no",
              }).render(true);
            });
            beginMigrationButton.parent().prepend(exportBackupButton);
          };
          Hooks.once("renderDialog", dialogHookFunction);
          Hooks.once("renderDialogV2", dialogHookFunction);
        });
      });
    });
  }

  static _patchSettingsScreen() {
    Hooks.on("renderSettings", (_obj, html) => {
      const jqHtml = ForgeVTT.ensureIsJQuery(html);
      const forgevttButton = $(
        `<button data-action="forgevtt"><i class="fas fa-hammer"></i> Back to The Forge</button>`
      );
      forgevttButton.on("click", () => this._navigateToForgeGame());
      const join = jqHtml.find("button:is([data-action='logout'], [data-app='logout'])");
      join.after(forgevttButton);
      // Change "Logout" button
      if (ForgeAPI.lastStatus && ForgeAPI.lastStatus.autojoin) {
        this._addJoinGameAs(join);
        // Redirect the "Configure player" for autojoin games
        $("#settings button[data-action=players]")
          .attr("data-action", "forgevtt-players")
          .off("click")
          .on("click", () => this._openConfigurePlayers());
      } else {
        join.html(`<i class="fas fa-door-closed"></i> Back to Join Screen`);
      }
      if (ForgeAPI.lastStatus) {
        const setupButton = jqHtml.find("button:is([data-action='setup'], [data-app='setup'])");
        if (ForgeAPI.lastStatus.table) {
          // Modify "Return to setup" behaviour for tables
          setupButton.off("click");
          setupButton.on("click", ForgeVTT._idleAndReturnToSetup);
        } else {
          // Remove "Return to setup" for non tables
          setupButton.hide();
        }
      }
    });
  }

  static _patchMainMenu() {
    Hooks.on("renderMainMenu", (_obj, html) => {
      if (!ForgeAPI.lastStatus) {
        return;
      }
      const jqHtml = ForgeVTT.ensureIsJQuery(html);
      if (!ForgeAPI.lastStatus.table) {
        if (ForgeVTT.isFoundryNewerThan("13")) {
          // Remove the original "Return to Setup" button. We can't just `.off("click")` as of v13, because Foundry's
          //   click handler is on the whole menu, not just the item
          jqHtml.find("li[data-menu-item='world']").remove();
          // Add "Back to The Forge" button to the main menu
          jqHtml
            .find("menu#main-menu-items")
            // We purposefully do not add data-action here so that Foundry's menu click handler ignores it.
            .append(
              `<li class="menu-item flexrow" data-menu-item="forge"><i class="fas fa-hammer"></i><h2>Back to The Forge</h2></li>`
            )
            // Find the element we just added so the click handler doesn't get applied to the whole menu
            .find("li[data-menu-item='forge']")
            .on("click", () => this._navigateToForgeGame());
        } else {
          jqHtml
            .find("li.menu-world")
            .removeClass("menu-world")
            .addClass("menu-forge")
            .html(`<i class="fas fa-hammer"></i><h4>Back to The Forge</h4>`)
            .off("click")
            .on("click", () => this._navigateToForgeGame());
        }
      } else {
        if (ForgeVTT.isFoundryNewerThan("13")) {
          const returnToSetup = jqHtml.find("li[data-menu-item='world']");
          if (returnToSetup.length) {
            // Modify behaviour of "Return to Setup" button for tables
            // Remove the original "Return to Setup" button. We can't just `.off("click")` as of v13, because Foundry's
            //   click handler is on the whole menu, not just the item
            jqHtml.find("li[data-menu-item='world']").remove();
            // Insert a new "Return to Setup" button and attach the click handler
            jqHtml
              .find("menu#main-menu-items")
              // We purposefully do not add data-action here so that Foundry's menu click handler ignores it.
              .append(
                `<li class="menu-item flexrow" data-menu-item="forge-setup"><i class="fa-solid fa-globe"></i><h2>Return to Setup</h2></li>`
              )
              // Find the element we just added so the click handler doesn't get applied to the whole menu
              .find("li[data-menu-item='forge-setup']")
              .on("click", ForgeVTT._idleAndReturnToSetup);
          }
          // Add "Back to The Forge" button to the main menu
          jqHtml
            .find("menu#main-menu-items")
            // We purposefully do not add data-action here so that Foundry's menu click handler ignores it.
            .append(
              `<li class="menu-item flexrow" data-menu-item="forge"><i class="fas fa-hammer"></i><h2>Back to The Forge</h2></li>`
            )
            // Find the element we just added so the click handler doesn't get applied to the whole menu
            .find("li[data-menu-item='forge']")
            .on("click", () => this._navigateToForgeGame());
        } else {
          // Modify behaviour of "Return to Setup" button for tables
          jqHtml
            .find("li.menu-world")
            .html(`<i class="fas fa-home"></i><h4>Return to Setup</h4>`)
            .off("click")
            .on("click", ForgeVTT._idleAndReturnToSetup);
          // Add "Back to The Forge" button to the main menu
          jqHtml
            .find("ol#menu-items")
            .append(`<li class="menu-forge"><i class="fas fa-hammer"></i><h4>Back to The Forge</h4></li>`)
            // Find the element we just added so the click handler doesn't get applied to the whole menu
            .find("li.menu-forge")
            .off("click")
            .on("click", () => this._navigateToForgeGame());
        }
      }

      if (ForgeAPI.lastStatus.autojoin) {
        if (ForgeVTT.isFoundryNewerThan("13")) {
          // Add "Join Game As" button to the main menu, just before the "User Management" item
          $(
            `<li class="menu-item flexrow" data-menu-item="forge-join-as"><i class="fas fa-random"></i><h2>Join Game As</h2></li>`
          ).insertBefore("li[data-menu-item='logout']");
          // Find the element we just added so the click handler doesn't get applied to the whole menu
          jqHtml.find("li[data-menu-item='forge-join-as']").on("click", () => this._joinGameAs());
          // Remove the original "Log Out" button. We can't just `.off("click")` as of v13, because Foundry's
          //   click handler is on the whole menu, not just the item
          jqHtml.find("li[data-menu-item='logout']").remove();
        } else {
          const join = jqHtml.find("li.menu-logout").removeClass("menu-logout").addClass("menu-join-as");
          // Don't use game.user.isGM because we could be logged in as a player
          if (!ForgeAPI.lastStatus.isGM) {
            return join.hide();
          }
          join
            .html(`<i class="fas fa-random"></i><h4>Join Game As</h4>`)
            .off("click")
            .on("click", () => this._joinGameAs());
        }
      } else {
        if (ForgeVTT.isFoundryNewerThan("13")) {
          jqHtml
            .find("li[data-menu-item='logout']")
            .html(`<i class="fas fa-door-closed"></i><h2>Back to Join Screen</h2>`);
        } else {
          jqHtml.find("li.menu-logout").html(`<i class="fas fa-door-closed"></i><h4>Back to Join Screen</h4>`);
        }
      }
    });
  }

  static _patchPlayerList() {
    // Hide Legacy users when user management is enabled
    Hooks.on("renderPlayerList", (_obj, html) => {
      if (!ForgeAPI.lastStatus || !ForgeAPI.lastStatus.autojoin) {
        return;
      }
      for (const player of ForgeVTT.ensureIsJQuery(html).find("li.player")) {
        const user = game.users.get(player.dataset.userId);
        if (user && !this._getUserFlag(user, "player")) {
          player.remove();
        }
      }
    });
  }

  static _patchInvitationLinks() {
    // TODO: Probably better to just replace the entire Application and use API to get the invite link if user is owner
    Hooks.on("renderInvitationLinks", (obj, html) => {
      const jqHtml = ForgeVTT.ensureIsJQuery(html);
      const notesContent = `Share the below invitation links with users who you wish to have join your game.
          <ul><li>The Invitation Link is for granting access to Forge users to this game (required for private games).</li>
          <li>The Game URL is the direct link to this game for public games or for players who already joined it.</li></ul>`;
      const invitationLink = `<i class="fas fa-key"></i> Invitation Link`;
      const gameUrl = `<i class="fas fa-share-alt"></i> Game URL`;

      // v13 and newer
      if (ForgeVTT.isFoundryNewerThan("13")) {
        jqHtml.find("section p.hint").html(notesContent);
        jqHtml.find("label[for=invitation-links-local]").html(invitationLink);
        jqHtml.find("label[for=invitation-links-internet]").html(gameUrl);
        jqHtml.find(".show-hide").remove();
        jqHtml.find("#invitation-links-internet").attr("type", "text");
      } else {
        jqHtml.find("form p.notes").html(notesContent);
        jqHtml.find("label[for=local]").html(invitationLink);
        jqHtml.find("label[for=remote]").html(gameUrl);
        if (ForgeVTT.isFoundryNewerThan("9.0")) {
          jqHtml.find(".show-hide").remove();
          jqHtml.find("#remote-link").attr("type", "text").css({ flex: "3" });
        }
        obj.setPosition({ height: "auto" });
      }
    });
  }

  static _patchActorImageFallback() {
    // Actor image is being updated. If token image falls back to bazaar default token, update it as well
    Hooks.on("preUpdateActor", (actor, changed) => {
      if (!changed?.img) {
        return;
      }
      const defaultTokenImages = [CONST.DEFAULT_TOKEN];
      defaultTokenImages.push(`${ForgeVTT.ASSETS_LIBRARY_URL_PREFIX}bazaar/core/${CONST.DEFAULT_TOKEN}`);
      const systemId = game.system.id || game.system.data?.name;
      if (systemId === "pf2e") {
        // Special default icons for pf2e
        [Actor.DEFAULT_ICON, `systems/pf2e/icons/default-icons/${actor.type}.svg`].forEach((img) => {
          defaultTokenImages.push(img);
          defaultTokenImages.push(`${ForgeVTT.ASSETS_LIBRARY_URL_PREFIX}${img}`);
          // The Bazaar uses an 'assets' folder on the top level of the package to store media assets
          defaultTokenImages.push(
            `${ForgeVTT.ASSETS_LIBRARY_URL_PREFIX}bazaar/${img.replace("systems/pf2e/", "systems/pf2e/assets/")}`
          );
        });
      }
      if (ForgeVTT.isFoundryNewerThan("10")) {
        if (!changed.prototypeToken?.texture?.src) {
          if (!actor.prototypeToken?.texture?.src || defaultTokenImages.includes(actor.prototypeToken?.texture?.src)) {
            setProperty(changed, "prototypeToken.texture.src", changed.img);
          }
        }
      } else if (!changed.token?.img) {
        if (!actor.data?.token?.img || defaultTokenImages.includes(actor.data?.token?.img)) {
          setProperty(changed, "token.img", changed.img);
        }
      }
    });
  }

  static _patchActivityTracking() {
    // Hook on any server activity to reset the user's activity detection
    Hooks.on("createToken", () => this._onServerActivityEvent());
    Hooks.on("updateToken", () => this._onServerActivityEvent());
    Hooks.on("createActor", () => this._onServerActivityEvent());
    Hooks.on("updateActor", () => this._onServerActivityEvent());
    Hooks.on("createJournalEntry", () => this._onServerActivityEvent());
    Hooks.on("updateJournalEntry", () => this._onServerActivityEvent());
    Hooks.on("createChatMessage", (message, options, userId) =>
      this._onCreateChatMessageActivityEvent(message, options, userId)
    );
    Hooks.on("canvasInit", () => this._onServerActivityEvent());
    // Start the activity checker to track player usage and prevent people from idling forever
    this._checkForActivity();
  }

  static _initStandaloneFeatures() {
    // Not running on the Forge
    Hooks.on("renderSettings", (_app, html) => {
      const forgevttButton = $(
        `<button class="forge-vtt" data-action="forgevtt" title="Go to ${this.FORGE_URL}"><img class="forge-vtt-icon" src="https://forge-vtt.com/images/the-forge-logo-200x200.png"> Go to The Forge</button>`
      );
      forgevttButton.on("click", () => (window.location = `${this.FORGE_URL}/`));
      const logoutButton = ForgeVTT.ensureIsJQuery(html).find("button[data-action=logout]");
      logoutButton.after(forgevttButton);
    });

    if (typeof ForgeAssetSyncApp !== "undefined") {
      /* If we're not running on the Forge, then add the assets sync button */
      game.settings.registerMenu("forge-vtt", "assetSyncApp", {
        name: "Asset Sync (Beta)",
        label: "Open Asset Sync",
        icon: "fas fa-sync",
        hint: "Open the Forge Asset Sync app to sync Forge Assets to this Foundry server",
        restricted: true,
        type: ForgeAssetSyncApp,
      });
    }
  }

  static _applySystemOverrides() {
    // System specific overrides for when additional Forge logic is necessary
    // This needs to run in game when the game.system.id is known (it is undefined in /setup and /join screens)
    //  and it needs to be run before the Foundry setup hook, because the system initializes before the setup hook
    if (!ForgeVTT.isFoundryNewerThan("10") || !game?.system?.id) {
      return;
    }
    // pf2e system changes token default-icons to the actor image, but does not handle Assets Library paths
    const originalPrepareBaseData = TokenDocument.prototype.prepareBaseData;
    /**
     * Attempt to replace the default icon for an actor. Helper function when running Pathfinder 2e.
     */
    function replaceDefaultIcon() {
      try {
        if (!this.actor || !this.texture.src.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
          // Let pf2e handle it
          return;
        }
        const defaultIcons = [];
        [Actor.DEFAULT_ICON, `systems/pf2e/icons/default-icons/${this.actor.type}.svg`].forEach((img) => {
          defaultIcons.push(img);
          // The Bazaar uses an 'assets' folder on the top level of the package to store media assets
          defaultIcons.push(`bazaar/${img.replace("systems/pf2e/", "systems/pf2e/assets/")}`);
        });
        for (const icon of defaultIcons) {
          if (this.texture.src.endsWith(icon)) {
            this.texture.src = this.actor._source.img;
            break;
          }
        }
      } catch {
        // noop
      }
    }
    if (game.system.id === "pf2e") {
      TokenDocument.prototype.prepareBaseData = function (...args) {
        replaceDefaultIcon.call(this);
        return originalPrepareBaseData.call(this, ...args);
      };
    }
  }

  static async setup() {
    const isNewerThanV10 = ForgeVTT.isFoundryNewerThan("10");
    this.injectForgeModules();

    // Remove the progress bar once setup has been called as the interface is being visibly built at that point
    $("#forge-loading-progress").animate(
      { opacity: 0 },
      {
        duration: 300,
        complete: () => {
          $("#forge-loading-progress").remove();
        },
      }
    );

    if (game.modules.get("forge-vtt-optional")?.active) {
      // Fix Infinite duration on some uncached audio files served by Cloudflare,
      // See https://gitlab.com/foundrynet/foundryvtt/-/issues/5869#note_754029249
      // Only override this on 0.8.x and v9 as this bug should presumably be fixed in v10
      if (ForgeVTT.isFoundryNewerThan("0.8.0") && !isNewerThanV10) {
        const original = AudioContainer.prototype._createAudioElement;
        AudioContainer.prototype._createAudioElement = async function (...args) {
          const element = await original.call(this, ...args);
          // After creating the element, if its duration was not calculated, force a time update by seeking to the end
          if (element.duration != Infinity) {
            return element;
          }
          // Workaround for Chrome bug which may not load the duration correctly
          return new Promise((resolve) => {
            // In case of a "live source" which would never have a duration, timeout after 5 seconds
            const timeoutId = setTimeout(() => resolve(element), 5000);
            // Some mp3 files will signal an `ontimeupdate`
            element.ontimeupdate = () => {
              element.ondurationchange = undefined;
              element.ontimeupdate = undefined;
              clearTimeout(timeoutId);
              element.currentTime = 0;
              resolve(element);
            };
            // Some ogg files will signal `ondurationchange` since that time can never be reached
            element.ondurationchange = () => {
              element.ondurationchange = undefined;
              element.ontimeupdate = undefined;
              clearTimeout(timeoutId);
              element.currentTime = 0;
              resolve(element);
            };
            element.currentTime = 1e101;
          });
        };
      }
      // Add the Progressive Web App manifest and install button
      if (this.usingTheForge) {
        window.addEventListener("beforeinstallprompt", (event) => {
          // Prevent the mini-infobar from appearing on mobile
          event.preventDefault();
          // Register the install menu the first time we get the event
          if (!ForgeVTTPWA.installEvent) {
            game.settings.registerMenu("forge-vtt-optional", "pwa", {
              name: "Install Player Application",
              label: "Install",
              icon: "fas fa-download",
              hint: "Installs a dedicated app to access your Forge game directly.",
              restricted: false,
              type: ForgeVTTPWA,
            });
          }
          ForgeVTTPWA.installEvent = event;
        });
        const link = document.createElement("LINK");
        link.rel = "manifest";
        link.href = `/pwa/manifest.json`;
        link.crossOrigin = "use-credentials";
        document.head.append(link);
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.register(`/pwa/worker.js`, { scope: "/" }).catch(ForgeVTT.logError);
        }
      }
    }
    // If user has avclient-livekit is enabled and is at least 0.4.1 (with custom server type support), then set it up to work with the Forge
    const liveKitModule = game.modules.get("avclient-livekit");
    if (this.usingTheForge && liveKitModule?.active) {
      const liveKitModuleVersion = isNewerThanV10 ? liveKitModule.version : liveKitModule.data.version;
      if (ForgeCompatibility.isNewerVersion(liveKitModuleVersion, "0.5")) {
        // hook on liveKitClientAvailable in 0.5.2+ as it gets called earlier and fixes issues seeing the Forge option if A/V isn't enabled yet
        const hookName = ForgeCompatibility.isNewerVersion(liveKitModuleVersion, "0.5.1")
          ? "liveKitClientAvailable"
          : "liveKitClientInitialized";
        // Foundry creates the client and connects it immediately without any hooks or anything to let us act on it
        // So we need to set this up on the client class itself in the setup hook before webrtc is configured
        Hooks.once(hookName, (client) => {
          const liveKitClient = ForgeCompatibility.isNewerVersion(liveKitModuleVersion, "0.5.1")
            ? client
            : client._liveKitClient;
          liveKitClient.addLiveKitServerType({
            key: "forge",
            label: "The Forge",
            urlRequired: false,
            usernameRequired: false,
            passwordRequired: false,
            url: this.LIVEKIT_SERVER_URL,
            tokenFunction: this._getLivekitAccessToken.bind(this),
            details: `<p>Connects to <a href="https://forums.forge-vtt.com/t/livekit-voice-and-video-chat/17792" target="_blank">The Forge's LiveKit</a> servers.</p><p>No setup necessary!</p><p><em>Requires a World Builder subscription</em></p>`,
          });
        });
      }
    }

    if (isNewerThanV10) {
      // Use Forge FilePicker to check the Assets Library when token image is wildcard
      const originalRequestTokenImages = Actor._requestTokenImages;
      Actor._requestTokenImages = async function (...args) {
        const actor = game.actors.get(args[0]); // actorId
        const target = actor?.prototypeToken?.texture?.src;
        if (target) {
          const wildcard = actor?.prototypeToken?.randomImg;
          // Use 'data' source since the FilePicker will decide the right source to use
          // based on whether the assets library prefix is there, or the path is in a module/system, etc...
          const response = await ForgeVTT_FilePicker.browse("data", target, { wildcard }).catch(() => null);
          if (response && response.files.length > 0) {
            return response.files;
          }
        }
        return originalRequestTokenImages.apply(this, args);
      };
    }

    this.configureDefaultFavoritePaths();
  }

  static async ready() {
    // If on The Forge, get the status/invitation url and start heartbeat to track player usage
    if (this.usingTheForge) {
      ForgeVTT.replaceFoundryTranslations();
      game.data.addresses.local = "<Not available>";
      const status = ForgeAPI.lastStatus || (await ForgeAPI.status().catch(ForgeVTT.logError)) || {};
      if (status.invitation) {
        game.data.addresses.local = `${this.FORGE_URL}/invite/${this.gameSlug}/${status.invitation}`;
      }
      game.data.addresses.remote = this.GAME_URL;
      if (ForgeVTT.isFoundryNewerThan("9.0")) {
        game.data.addresses.remoteIsAccessible = true;
      }
      if (status.announcements) {
        this._handleAnnouncements(status.announcements);
      }
      // Send heartbeats for in game players
      if (window.location.pathname.startsWith("/game")) {
        this._sendHeartBeat(true);
      }
      // Remove "Return to setup" for non tables
      if (!status.table) {
        $("#settings button[data-action=setup]").hide();
      }
      if (status.autojoin) {
        $("#settings button[data-action=players]")
          .attr("data-action", "forgevtt-players")
          .off("click")
          .on("click", () => {
            this._openConfigurePlayers();
          });
        this._addJoinGameAs();
      }
      if (ForgeVTT.isFoundryNewerThan("10")) {
        // On v10, make The Forge module appear enabled
        const moduleConfiguration = game.settings.get("core", "moduleConfiguration");
        if (!moduleConfiguration["forge-vtt"]) {
          moduleConfiguration["forge-vtt"] = true;
          game.settings.set("core", "moduleConfiguration", moduleConfiguration);
        }
      }

      // Add Forge assets prefix to dynamic token ring subject mappings in CONFIG
      if (CONFIG.Token?.ring?.subjectPaths) {
        ForgeVTT.log("Adding ring subject paths with Forge assets library URLs");
        const ownerUserId = ForgeAPI.lastStatus.ownerUserId;
        const relativeEntries = Object.entries(CONFIG.Token.ring.subjectPaths);
        const assetLibraryEntries = relativeEntries.map(([tokenPath, subjectPath]) => {
          if (!tokenPath.startsWith("http")) {
            return [
              `${ForgeVTT.ASSETS_LIBRARY_URL_PREFIX}${ownerUserId}/${tokenPath}`,
              `${ForgeVTT.ASSETS_LIBRARY_URL_PREFIX}${ownerUserId}/${subjectPath}`,
            ];
          }
          return [tokenPath, subjectPath];
        });
        CONFIG.Token.ring.subjectPaths = Object.fromEntries([...relativeEntries, ...assetLibraryEntries]);
      }
    }
  }

  static i18nInit() {
    // As of v13, the "ready" hook is no longer called on the Setup page so we need to replace translations here.
    if (ForgeVTT.isFoundryNewerThan("13")) {
      this.replaceFoundryTranslations();
    }
    if (game.i18n.has("THEFORGE.LoadingWorldData")) {
      $("#forge-loading-progress .loading-text").html(game.i18n.localize("THEFORGE.LoadingWorldData"));
    }
    if (game.i18n.has("THEFORGE.LoadingWorldDataTroubleshoot")) {
      $("#forge-loading-progress .loading-warning").html(game.i18n.localize("THEFORGE.LoadingWorldDataTroubleshoot"));
    }
  }

  // Create an animated progress bar to indicate that something is happening
  static injectProgressBar() {
    $(`<div id="forge-loading-progress" style="display: none;" class="forge-loading-progress" onclick="$(this).remove()">
            <div class="loading-content flexcol">
                <div class="flexrow">
                    <div class="loading-image">
                        <img src="${this.FORGE_URL}/images/the-forge-logo-48x48.png">
                    </div>
                    <div class="flexcol">
                        <div class="loading-text">
                            Downloading modules, please wait&hellip;
                        </div>
                        <div class="loading-warning">
                            Your world seems to take a while to load, refer to this <a href="https://forums.forge-vtt.com/docs?topic=17307" onclick="event.stopPropagation();" target="_blank" >guide</a> for troubleshooting possible issues
                        </div>
                    </div>
                </div>
                <div style="padding-top: 5px;">
                    <div class="loading-progress"><div class="bar"></div></div>
                </div>
            </div>
        </div>
        `).appendTo(document.body);
    ForgeVTT.animateProgress();
    window.setTimeout(() => {
      $("#forge-loading-progress").addClass("slow");
    }, 30000);

    window.addEventListener("DOMContentLoaded", async function () {
      $("#forge-loading-progress .loading-text").html("Downloading world data, please wait&hellip;");
    });
  }
  static animateProgress() {
    if (!$("#forge-loading-progress").hasClass("slow")) {
      const duration = Math.random() * 2900 + 100; // Randomly take between 0.1 and 3 seconds to complete
      $("#forge-loading-progress .loading-progress .bar")
        .css({ width: "0%" })
        .animate({ width: "100%" }, { duration: duration, easing: "linear", complete: ForgeVTT.animateProgress });
    }
  }

  static injectForgeModules() {
    // If we're running on the forge and there is no loaded module, then add a fake module
    // so the user can change the settings.
    const forgeModule = game.modules.get("forge-vtt");
    if (!forgeModule || !forgeModule.active) {
      const data = {
        author: "The Forge",
        authors: [],
        bugs: "",
        changelog: "",
        compatibleCoreVersion: ForgeVTT.foundryVersion,
        coreTranslation: false,
        description:
          "<p>This module allows players to browse their Forge Assets Library from their local games.</p><p>This module is automatically enabled for users on The Forge and is therefore not required when running your games on The Forge website.</p>",
        download: "",
        esmodules: [],
        flags: {},
        keywords: [],
        languages: [],
        license: "The Forge VTT Inc. - All Rights Reserved",
        manifest: "",
        minimumCoreVersion: undefined,
        id: "forge-vtt",
        minimumSystemVersion: undefined,
        name: "forge-vtt",
        packs: [],
        protected: false,
        readme: "",
        scripts: [],
        socket: false,
        styles: [],
        title: "The Forge",
        url: "https://forge-vtt.com",
        version: "1.14.10",
        availability: 0, // Shows as a red warning in the module list from v11 onwards, see below
        unavailable: false,
      };
      let moduleData = data;
      if (ForgeVTT.isFoundryNewerThan("10")) {
        if (ForgeVTT.isFoundryNewerThan("11")) {
          // Since v11, Foundry will create availability (from compatibility), but only if it doesn't exist
          delete data.availability;
        }
        game.modules.set(
          "forge-vtt",
          new ForgeCompatibility.Module({
            active: true,
            locked: true,
            unavailable: false,
            compatibility: {
              minimum: "10",
              verified: ForgeVTT.foundryVersion,
            },
            ...data,
          })
        );
        // v10 will display it in the manage modules section, so we should make it a requirement of the world.
        game.world.relationships.requires.add({ type: "module", id: "forge-vtt" });
      } else {
        if (ForgeVTT.isFoundryNewerThan("0.8.0")) {
          moduleData = new foundry.packages.ModuleData(data);
        }
        const module = {
          active: true,
          availability: 0,
          esmodules: [],
          id: "forge-vtt",
          languages: [],
          locked: true,
          packs: [],
          path: "/forge-vtt/Data/modules/forge-vtt",
          scripts: [],
          styles: [],
          type: "module",
          unavailable: false,
          data: moduleData,
        };
        game.modules.set("forge-vtt", module);
      }
    }
    if (!game.modules.get("forge-vtt-optional") && ForgeVTT.isFoundryNewerThan("0.8.0")) {
      const settingName = ForgeVTT.isFoundryNewerThan("13")
        ? ForgeCompatibility.ModuleManagement.SETTING
        : ForgeCompatibility.ModuleManagement.CONFIG_SETTING;
      const settings = game.settings.get("core", settingName) || {};

      const data = {
        id: "forge-vtt-optional",
        name: "forge-vtt-optional",
        title: "The Forge: More Awesomeness",
        description:
          "<p>This is an optional module provided by The Forge to fix various issues and bring its own improvements to Foundry VTT. You can read more about it <a href='https://forums.forge-vtt.com/t/what-is-the-forge-optional-module/16836' target='_blank'>here</a>.</p>",
        version: "1.1",
        minimumCoreVersion: "0.8.0",
        compatibleCoreVersion: "9",
        scripts: [],
        esmodules: [],
        styles: [],
        packs: [],
        languages: [],
        authors: [],
        keywords: [],
        socket: false,
        url: "https://forge-vtt.com",
        manifest: "",
        download: "",
        license: "",
        readme: "",
        bugs: "",
        changelog: "",
        author: "The Forge",
        availability: 0, // Shows as a red warning in the module list from v11 onwards, see below
        unavailable: false,
      };
      if (ForgeVTT.isFoundryNewerThan("10")) {
        if (ForgeVTT.isFoundryNewerThan("11")) {
          // Since v11, Foundry will create availability (from compatibility), but only if it doesn't exist
          delete data.availability;
        }
        game.modules.set(
          "forge-vtt-optional",
          new ForgeCompatibility.Module({
            active: settings["forge-vtt-optional"] || false,
            type: "module",
            unavailable: false,
            path: "/forge-vtt/data/modules/forge-vtt",
            compatibility: {
              minimum: "10",
              verified: ForgeVTT.foundryVersion,
            },
            ...data,
          })
        );
        game.data.modules.push(data);
      } else {
        const module = {
          active: settings["forge-vtt-optional"] || false,
          availability: 0,
          esmodules: [],
          id: "forge-vtt-optional",
          languages: [],
          locked: true,
          packs: [],
          path: "",
          scripts: [],
          styles: [],
          type: "module",
          unavailable: false,
          data: new foundry.packages.ModuleData(data),
        };
        game.modules.set("forge-vtt-optional", module);
        game.data.modules.push(module);
      }
    }
  }

  static async _getLivekitAccessToken(_apiKey, _secretKey, roomName, userName, metadata) {
    const status = ForgeAPI.lastStatus || (await ForgeAPI.status());
    if (!status.supportsLivekit) {
      ui.notifications.error("This server does not have support for Livekit");
      return "";
    }
    if (!status.canUseLivekit) {
      ui.notifications.error(
        "Livekit support is a feature exclusive to the World Builder tier. Please upgrade your subscription and try again."
      );
      return "";
    }
    const response = await ForgeAPI.call(null, {
      action: "get-livekit-credentials",
      room: roomName,
      username: userName,
      metadata,
    }).catch(() => null);
    if (response && response.token) {
      if (response.server && this.LIVEKIT_SERVER_URL !== response.server) {
        this.LIVEKIT_SERVER_URL = response.server;
        // Update the url configuration in livekit avclient custom server type
        if (game.webrtc.client._liveKitClient?.liveKitServerTypes?.forge?.url) {
          game.webrtc.client._liveKitClient.liveKitServerTypes.forge.url = this.LIVEKIT_SERVER_URL;
        }
      }
      return response.token;
    }
    ui.notifications.error(
      `Error retreiviving Livekit credentials: ${(response && response.error) || "Unknown Error"}.`
    );
    return "";
  }

  /**
   * MESSAGES[i].message represents the key that will be called from Foundry translation files
   * If the key is missing from translation files, the key itself will return as default translation value
   */
  static replaceFoundryMessages() {
    if (!MESSAGES) {
      return;
    }
    const forgeStrings = this._getForgeStrings();
    for (let i = 0; i < MESSAGES.length; i++) {
      const key = MESSAGES[i].message;
      if (forgeStrings[key] !== undefined) {
        MESSAGES[i].message = forgeStrings[key];
      }
    }
  }

  /**
   * Replace Foundry translations values with Forge specific strings
   * Run after Foundry initialized abd translations are loaded, but before values are referenced
   */
  static replaceFoundryTranslations() {
    if (!game?.i18n?.translations) {
      return;
    }
    if (this._translationsInitialized) {
      return;
    }
    ForgeCompatibility.mergeObject(game.i18n.translations, this._getForgeStrings());
    this._translationsInitialized = true;
  }

  /**
   * Use Forge API to force the game server to restart, then redirect to the Foundry setup page.
   */
  static async _idleAndReturnToSetup() {
    try {
      // Use invalid slug world to cause it to ignore world selection
      await ForgeAPI.call("game/idle", { game: ForgeVTT.gameSlug, force: true, world: "/" }, { cookieKey: true });
    } catch (err) {
      ForgeVTT.logError(err);
    } finally {
      window.location = `${ForgeVTT.GAME_URL}/setup`;
    }
  }

  // v8-, v11-, and v11+ need different selectors. Handle based on version for backwards compatibility
  static async _addReturnToSetup(html) {
    let joinForm;
    if (!html) {
      joinForm = $("#join-form");
    } else {
      if (ForgeVTT.isFoundryNewerThan("12")) {
        // Foundry v12 sets the #join-game-form id but doesn't have a specific join-form class
        joinForm = $(ForgeVTT.ensureIsJQuery(html).find("#join-game-form > footer")[0]);
      } else if (ForgeVTT.isFoundryNewerThan("11")) {
        // Foundry v11 sets a specific join-form class we can search for
        joinForm = $(ForgeVTT.ensureIsJQuery(html).find(".join-form > footer")[0]);
      } else {
        // Foundry 0.8.x doesn't name the divs anymore, so we have to guess it
        joinForm = $(ForgeVTT.ensureIsJQuery(html).find("section .left > div")[0]);
      }
    }
    // If we can't find it, then html is null and we are under v0.8.x, let the onRenderJoinGame hook call with html
    if (joinForm.length === 0) {
      return;
    }

    const status = ForgeAPI.lastStatus || (await ForgeAPI.status().catch(ForgeVTT.logError)) || {};
    // Add return to setup
    if (status.isOwner && status.table) {
      const button = $(
        `<button type="button" name="back-to-setup"><i class="fas fa-home"></i> Return to Setup</button>`
      );
      if (ForgeVTT.isFoundryNewerThan("11")) {
        // v11+ sets specific styling for join form buttons
        button.css({ "min-width": "100%" }); // Let buttons take up all horizontal space
        button.addClass("bright"); // v11 themes, 'bright'
      }
      joinForm.append(button);
      button.on("click", ForgeVTT._idleAndReturnToSetup);
    }
    // Add return to the forge
    const forgevttButton = $(
      `<button type="button" name="back-to-forge-vtt"><i class="fas fa-hammer"></i> Back to The Forge</button>`
    );
    forgevttButton.on("click", () => (window.location = `${this.FORGE_URL}/games`));
    if (ForgeVTT.isFoundryNewerThan("11")) {
      forgevttButton.addClass("bright");
    } // v11 themes, 'bright'
    joinForm.append(forgevttButton);
    // Remove "Return to Setup" section from login screen when the game is not of type Table.
    if (!status.table || status.isOwner) {
      let shutdown;
      if (!html) {
        shutdown = $("form#shutdown");
      } else {
        if (ForgeVTT.isFoundryNewerThan("12")) {
          // Foundry v12 sets a join-game-setup id we can search for
          shutdown = $(ForgeVTT.ensureIsJQuery(html).find("#join-game-setup")[0]);
        } else if (ForgeVTT.isFoundryNewerThan("11")) {
          // Foundry v11 sets a specific return-setup class we can search for
          shutdown = $(ForgeVTT.ensureIsJQuery(html).find("div .return-setup")[0]);
        } else {
          // Foundry 0.8.x doesn't name the divs anymore, so we have to guess it
          shutdown = $(ForgeVTT.ensureIsJQuery(html).find("section .left > div")[2]);
        }
      }
      shutdown.parent().css({ "justify-content": "start" });
      shutdown.hide();
    }
  }

  static _openConfigurePlayers() {
    if (ForgeAPI.lastStatus.isOwner) {
      window.open(`${this.FORGE_URL}/setup#${this.gameSlug}&players`, "_about");
    } else {
      window.open(`${this.FORGE_URL}/game/${this.gameSlug}#players`, "_about");
    }
  }

  static _navigateToForgeGame() {
    window.location = `${this.FORGE_URL}/game/${this.gameSlug}`;
  }

  static _addJoinGameAs(join) {
    if (!join) {
      join = $("#settings button[data-action=logout]");
    }
    // Don't use game.user.isGM because we could be logged in as a player
    if (!ForgeAPI.lastStatus.isGM) {
      return join.hide();
    }

    join.attr("data-action", "join-as").html(`<i class="fas fa-random"></i> Join Game As`);
    join.off("click").on("click", () => this._joinGameAs());
  }

  static _joinGameAs() {
    const options = this._getJoinAsOption();

    // Close the main menu if it was open
    ui.menu.close();

    this._getJoinAsApplication(options).render(true);
  }

  static _getJoinAsOption() {
    const options = [];
    // Could be logged in as someone else
    const gameusers = ForgeVTT.isFoundryNewerThan("9.0") ? game.users : game.users.entities;
    if (ForgeAPI.lastStatus.isGM && !this._getUserFlag(game.user, "temporary")) {
      const myUser =
        gameusers.find((user) => this._getUserFlag(user, "player") === ForgeAPI.lastStatus.user) || game.user;
      options.push({ name: `${myUser.name} (As Temporary Player)`, role: 1, id: "temp" });
    }
    for (const user of gameusers) {
      if (user.isSelf) {
        continue;
      }
      const id = this._getUserFlag(user, "player");
      const temp = this._getUserFlag(user, "temporary");
      if (id && !temp) {
        options.push({ name: user.name, role: user.role, id });
      }
    }

    return options;
  }

  static _roleToImgUrl(role) {
    switch (role) {
      case 4:
        return "/images/dice/red-d20.png";
      case 3:
        return "/images/dice/cyan-d12.png";
      case 2:
        return "/images/dice/purple-d10.png";
      case 1:
        return "/images/dice/green-d8.png";
      default:
        return null;
    }
  }

  static _roleToImg(role) {
    const img = this._roleToImgUrl(role);
    if (!img) return "";
    return `<img src="${ForgeVTT.FORGE_URL}${img}" width="24" style="border: 0px; vertical-align:middle;"/>`;
  }

  static _getJoinAsApplication(options) {
    let buttons = options.map(
      ({ id, name, role }) => `<button data-join-as="${id}">${name} ${this._roleToImg(role)}</button>`
    );
    if (ForgeVTT.isFoundryNewerThan("12")) {
      return new HTMLApplication({
        window: { title: "Join Game As" },
        classes: ["forge-app-join-as"],
        content: /*html*/ `
          <p>Select a player to re-join the game as: </p>
          <div class="buttons">
            ${buttons.join("")}
          </div>
        `,
        render: (html) =>
          html.querySelectorAll("[data-join-as]").forEach((button) => {
            button.addEventListener("click", () => (window.location.href = `/join?as=${button.dataset.joinAs}`));
          }),
      });
    }
    buttons = buttons.map((button) => `<div>${button}</div>`).join("");
    return new Dialog(
      {
        title: "Join Game As",
        content: `<p>Select a player to re-join the game as: </p>${buttons}`,
        buttons: {},
        render: (html) => {
          for (const button of ForgeVTT.ensureIsJQuery(html).find("button[data-join-as]")) {
            const as = button.dataset.joinAs;
            $(button).on("click", () => (window.location.href = `/join?as=${as}`));
          }
        },
      },
      { height: "auto" }
    );
  }

  static async _checkForActivity() {
    this.activity = {
      lastX: 0,
      lastY: 0,
      mouseX: 0,
      mouseY: 0,
      keyUp: false,
      lastActive: Date.now(),
      focused: true,
      reports: [],
      events: [],
      active: true,
    };
    $(window)
      .on("blur", () => {
        this.activity.focused = false;
      })
      .on("focus", () => {
        this.activity.focused = true;
      })
      .on("mousemove", (ev) => {
        this.activity.mouseX = ev.clientX;
        this.activity.mouseY = ev.clientY;
      })
      .on("keyup", () => {
        this.activity.keyUp = true;
      });

    setInterval(() => this._addActivityReport(), ForgeVTT.ACTIVITY_CHECK_INTERVAL);
    setInterval(() => this._updateActivity(), ForgeVTT.ACTIVITY_UPDATE_INTERVAL);
  }
  static _addActivityReport() {
    const report = {
      mouseMoved: this.activity.lastX !== this.activity.mouseX || this.activity.lastY !== this.activity.mouseY,
      keyboardUsed: this.activity.keyUp,
      focused: this.activity.focused,
    };
    this.activity.lastX = this.activity.mouseX;
    this.activity.lastY = this.activity.mouseY;
    this.activity.keyUp = false;
    this.activity.reports.push(report);
  }
  static _updateActivity() {
    const minEvents = this.activity.reports.length / 2;
    const numEvents = this.activity.reports.reduce((acc, report) => {
      // Ignore window unfocused for now since if the player moved the mouse/keyb, it's enough
      // and they might have focus on a separate window (Beyond 20)
      if (report.mouseMoved || report.keyboardUsed) {
        acc++;
      }
      return acc;
    }, 0);
    this.activity.active = numEvents >= minEvents;
    // keep the last 100 activity events
    this.activity.events = this.activity.events.concat([this.activity.active]).slice(-100);

    this.activity.reports = [];
    if (this.activity.active) {
      this.activity.lastActive = Date.now();
    } else {
      this._verifyInactivePlayer();
    }
  }
  static _onServerActivityEvent() {
    // canvasInit gets called before ready hook
    if (!this.activity) {
      return;
    }
    this.activity.lastActive = Date.now();
  }
  static _onCreateChatMessageActivityEvent(message, _options, userId) {
    // Ignore chat messages created by the current user, activity will still be updated by input devices
    // Prevents automated chat messages from simulating activity
    if (userId === game?.userId) {
      return;
    }
    // OTHER type chat messages from other users should also be ignored
    if (message?.type === ForgeCompatibility.chatMessageStyles.OTHER) {
      return;
    }
    this._onServerActivityEvent();
  }

  static async _verifyInactivePlayer() {
    const inactiveFor = Date.now() - this.activity.lastActive;
    let inactiveThreshold = ForgeVTT.GAME_INACTIVE_THRESHOLD;
    if (["/game", "/stream"].includes(window.location.pathname) && game?.users) {
      if (game.users.filter((u) => u.active).length <= 1) {
        inactiveThreshold = ForgeVTT.GAME_SOLO_INACTIVE_THRESHOLD;
      }
    } else {
      inactiveThreshold = ForgeVTT.OTHER_INACTIVE_THRESHOLD;
    }
    if (inactiveFor > inactiveThreshold) {
      await ForgeAPI.call(null, { action: "inactive", path: window.location.pathname, inactivity: inactiveFor }).catch(
        ForgeVTT.logError
      );
      window.location = `https://${this.HOSTNAME}/game/${this.gameSlug}`;
    } else if (inactiveFor > inactiveThreshold - ForgeVTT.IDLE_WARN_ADVANCE) {
      this._warnInactivePlayer(inactiveFor);
    }
  }
  static _tsToH(ts) {
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;
    const time = ts > HOUR ? `${Math.round(ts / HOUR)} hour` : `${Math.round(ts / MINUTE)} minute`;
    const plural = ts > HOUR ? Math.round(ts / HOUR) > 1 : Math.round(ts / MINUTE) > 1;
    return `${time}${plural ? "s" : ""}`;
  }
  static _warnInactivePlayer(inactivity) {
    if (this.activity.warning) {
      return;
    }
    const redirectTS = new Date(Date.now() + ForgeVTT.IDLE_WARN_ADVANCE);
    const time = new Intl.DateTimeFormat("default", {
      hour12: true,
      hourCycle: "h12",
      hour: "numeric",
      minute: "numeric",
    }).format(redirectTS);

    this.activity.warning = new Dialog({
      title: "The Forge",
      content: `<div>You have been inactive for ${this._tsToH(inactivity)}.</div>
            <div>In case this is wrong, please confirm that you are still active or you will be redirected to the Forge main website in ${this._tsToH(ForgeVTT.IDLE_WARN_ADVANCE)} (${time}).</div>`,
      buttons: {
        active: {
          label: "I'm here!",
          callback: () => {
            this.activity.events.push(true);
            this.activity.lastActive = Date.now();
            this.activity.warning = null;
          },
        },
        inactive: {
          label: "You're right, take me home",
          callback: () => {
            window.location = `https://${this.HOSTNAME}/game/${this.gameSlug}`;
          },
        },
      },
    }).render(true);
  }
  // Consider the user active if they had one activity event in the last HEARTBEAT_ACTIVE_IN_LAST_EVENTS events
  static _getActivity() {
    return this.activity.events.slice(-1 * ForgeVTT.HEARTBEAT_ACTIVE_IN_LAST_EVENTS).some((active) => active);
  }
  static async _sendHeartBeat(initial) {
    const active = initial || this._getActivity();
    const response =
      (await ForgeAPI.call(null, { action: "heartbeat", active, initial }).catch(ForgeVTT.logError)) || {};
    if (response.announcements) {
      this._handleAnnouncements(response.announcements);
    }

    // Redirect back in case of an expired demo license
    if (response.demo !== undefined) {
      if (response.demo < 0) {
        setTimeout(() => (window.location = `https://${this.HOSTNAME}/game/${this.gameSlug}`), 2500);
      } else {
        if (this._demoTimeout) {
          clearTimeout(this._demoTimeout);
        }
        this._demoTimeout = setTimeout(this._sendHeartBeat.bind(this), response.demo);
      }
    }

    // Send a heartbeat every 10 minutes;
    setTimeout(this._sendHeartBeat.bind(this), ForgeVTT.HEARTBEAT_TIMER);
  }

  static _handleAnnouncements(announcements) {
    this.displayedAnnouncements = this.displayedAnnouncements || [];
    const newAnnouncements = Object.keys(announcements).filter((id) => !this.displayedAnnouncements.includes(id));
    for (const id of newAnnouncements) {
      ui.notifications.info(announcements[id], { permanent: true });
      this.displayedAnnouncements.push(id);
    }
  }

  // Need to use this because user.getFlag can error out if we get the forge API to respond before the init hook is called
  // causing the error of "invalid scope"
  static _getUserFlag(user, key) {
    return ForgeCompatibility.getProperty(user.flags || user.data.flags, `forge-vtt.${key}`);
  }

  /**
   * Finds data URL for images from various entities data and replaces them a valid
   * assets library URL.
   * This is a counter to the issue with Dungeon Alchemist that exports scenes with the
   * base64 encoded image in the json, that users import into Foundry. Causing databases
   * to quickly bloat beyond what Foundry can handle.
   * @param entityType
   * @param data
   */
  static async findAndDestroyDataImages(entityType, data) {
    if (!data) {
      return data;
    }
    switch (entityType) {
      case "Actor":
        if (data.img) {
          data.img = await this._uploadDataImage(entityType, data.img);
        }
        if (data.prototypeToken) {
          data.prototypeToken = await this.findAndDestroyDataImages("Token", data.prototypeToken);
        } else if (data.token) {
          data.token = await this.findAndDestroyDataImages("Token", data.token);
        }
        if (data.items) {
          data.items = await Promise.all(data.items.map((item) => this.findAndDestroyDataImages("Item", item)));
        }
        if (data.system?.details?.biography?.value) {
          data.system.details.biography.value = await this._migrateDataImageInHTML(
            entityType,
            data.system.details.biography.value
          );
        } else if (!data.system && data.data?.details?.biography?.value) {
          data.data.details.biography.value = await this._migrateDataImageInHTML(
            entityType,
            data.data.details.biography.value
          );
        }
        break;
      case "Token":
        if (data.texture?.src) {
          data.texture.src = await this._uploadDataImage(entityType, data.texture.src);
        } else if (!data.texture && data.img) {
          data.img = await this._uploadDataImage(entityType, data.img);
        }
        break;
      case "JournalEntry":
        if (data.pages) {
          data.pages = await Promise.all(
            data.pages.map((page) => this.findAndDestroyDataImages("JournalEntryPage", page))
          );
        } else {
          if (data.img) {
            data.img = await this._uploadDataImage(entityType, data.img);
          }
          if (data.content) {
            data.content = await this._migrateDataImageInHTML(entityType, data.content);
          }
        }
        break;
      case "JournalEntryPage":
        if (data.src) {
          data.src = await this._uploadDataImage(entityType, data.src);
        }
        if (data.text?.content) {
          data.text.content = await this._migrateDataImageInHTML(entityType, data.text.content);
        }
        if (data.text?.markdown) {
          data.text.markdown = await this._migrateDataImageInMarkdown(entityType, data.text.markdown);
        }
        break;
      case "Item":
        if (data.img) {
          data.img = await this._uploadDataImage(entityType, data.img);
        }
        if (data.system?.description?.value) {
          data.system.description.value = await this._migrateDataImageInHTML(entityType, data.system.description.value);
        } else if (!data.system && data.data?.description?.value) {
          data.data.description.value = await this._migrateDataImageInHTML(entityType, data.data.description.value);
        }
        break;
      case "Macro":
      case "Tile":
      case "RollTable":
        if (data.img) {
          data.img = await this._uploadDataImage(entityType, data.img);
        }
        break;
      case "Scene":
        if (data.background?.src) {
          data.background.src = await this._uploadDataImage(entityType, data.background.src);
        } else if (data.img) {
          data.img = await this._uploadDataImage(entityType, data.img);
        }
        if (data.foreground) {
          data.foreground = await this._uploadDataImage(entityType, data.foreground);
        }
        if (data.thumb) {
          data.thumb = await this._uploadDataImage(entityType, data.thumb);
        }
        if (data.description) {
          data.description = await this._migrateDataImageInHTML(entityType, data.description);
        }
        if (data.drawings) {
          data.drawings = await Promise.all(
            data.drawings.map((drawing) => this.findAndDestroyDataImages("Drawing", drawing))
          );
        }
        if (data.notes) {
          data.notes = await Promise.all(data.notes.map((note) => this.findAndDestroyDataImages("Note", note)));
        }
        if (data.templates) {
          data.templates = await Promise.all(
            data.templates.map((template) => this.findAndDestroyDataImages("MeasuredTemplate", template))
          );
        }
        if (data.tiles) {
          data.tiles = await Promise.all(data.tiles.map((tile) => this.findAndDestroyDataImages("Tile", tile)));
        }
        if (data.tokens) {
          data.tokens = await Promise.all(data.tokens.map((token) => this.findAndDestroyDataImages("Token", token)));
        }
        break;
      case "Drawing":
      case "MeasuredTemplate":
        if (data.texture) {
          data.texture = await this._uploadDataImage(entityType, data.texture);
        }
        break;
      case "Note":
        if (data.icon) {
          data.icon = await this._uploadDataImage(entityType, data.icon);
        }
        break;
      case "User":
        if (data.avatar) {
          data.avatar = await this._uploadDataImage(entityType, data.avatar);
        }
        break;
      default:
        break;
    }
    return data;
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
  static async _migrateDataImageInHTML(entityType, content) {
    if (!content) {
      return content;
    }
    return this.strReplaceAsync(content, /src=("[^"]+"|'[^']+')/gi, async (match, source) => {
      const src = await this._uploadDataImage(entityType, source.slice(1, -1));
      return match.substr(0, 5) + src + match.substr(-1);
    });
  }
  static async _migrateDataImageInMarkdown(entityType, content) {
    if (!content) {
      return content;
    }
    content = await this._migrateDataImageInHTML(entityType, content);
    // This regex looks like it does indeed need to escape the characters it escapes.
    // eslint-disable-next-line no-useless-escape
    return this.strReplaceAsync(content, /\[([^\]]*)\]\(([^\)]+)\)/gi, async (_match, text, source) => {
      const src = await this._uploadDataImage(entityType, source).replace(/\(/g, "%28").replace(/\)/, "%29"); // escape parenthesis
      return `[${text}](${src})`;
    });
  }
  /**
   * Takes a data URL and uploads it to the assets library and returns the new URL
   * If the image is undefined, or isn't a data:image URL or upload fails, the original string will be returned
   * @param {string} entityType
   * @param {string} img - The image to operate on
   */
  static async _uploadDataImage(entityType, img) {
    if (!img || !img.startsWith("data:image/")) {
      return img;
    }
    const mimetype = img.slice(11).split(",", 1)[0];
    // avoid a malformed string causing an overly long mimetype
    if (!mimetype || mimetype.length > 15) {
      return img;
    }
    try {
      const [ext, _format] = mimetype.split(";");
      // We can use fetch to transform a data: url into a blob!
      const blob = await fetch(img).then((r) => r.blob());
      const etag = await ForgeVTT_FilePicker.etagFromFile(blob);
      blob.name = `${etag}.${ext}`;

      const response = await FilePicker.upload("forgevtt", `base64data/${entityType}`, blob, {}, { notify: false });
      if (!response) {
        return img;
      }
      return response.path;
    } catch (err) {
      ForgeVTT.logError(err);
      return img;
    }
  }

  static get foundryVersion() {
    return game.version || game.data.version;
  }

  static get FILE_EXTENSIONS() {
    const extensions = ["pdf", "json"]; // Some extensions that modules use that aren't part of the core media extensions
    // Add media file extensions
    if (ForgeVTT.isFoundryNewerThan("10")) {
      extensions.push(...Object.keys(CONST.UPLOADABLE_FILE_EXTENSIONS));
    } else if (ForgeVTT.isFoundryNewerThan("9.0")) {
      extensions.push(
        ...Object.keys(CONST.AUDIO_FILE_EXTENSIONS),
        ...Object.keys(CONST.IMAGE_FILE_EXTENSIONS),
        ...Object.keys(CONST.VIDEO_FILE_EXTENSIONS)
      );
    } else {
      extensions.push(...CONST.AUDIO_FILE_EXTENSIONS, ...CONST.IMAGE_FILE_EXTENSIONS, ...CONST.VIDEO_FILE_EXTENSIONS);
    }
    return extensions;
  }

  /**
   * Get Forge specific messages to replace Foundry defaults by translation key
   * @returns {Record<string, string>} - The translateable strings
   */
  static _getForgeStrings() {
    const strings = {
      // eslint-disable-next-line no-useless-escape
      "ERROR.InvalidAdminKey": `The provided administrator access key is invalid. If you have forgotten your configured password you will need to change it via the Forge configuration page <a href=\"${ForgeVTT.FORGE_URL}/setup#${ForgeVTT.gameSlug}\">here</a>.`,
      "THEFORGE.LoadingWorldData": "Downloading world data, please wait&hellip;",
      "THEFORGE.LoadingWorldDataTroubleshoot":
        'Your world seems to take a while to load, refer to this <a href="https://forums.forge-vtt.com/docs?topic=17307" onclick="event.stopPropagation();" target="_blank" >guide</a> for troubleshooting possible issues',
      "THEFORGE.MigrationExportDialogTitle": "Did Your Export Complete Successfully?",
      "THEFORGE.MigrationExportDialogContent": `<p>Please click the "<strong>Export Complete</strong>" button once The Forge has completely exported your world and the backup download is finished.</p><p>Kindly allow enough time for the export to finish before initiating world migration to make sure that your data is safe.</p><p>If you already have a backup, you can also click "<strong>Cancel</strong>" to proceed with the migration without waiting.</p>`,
      "THEFORGE.MigrationExportComplete": "Export Complete",
      "THEFORGE.MigrationExportBackup": "Export Backup",
      "THEFORGE.MigrationExporting": "Exporting…",
      "THEFORGE.MigrationExportCancel": "Cancel",
      "THEFORGE.APIRateMonitorSpikeWarning":
        "Forge API rate monitor warning: {endpoint} on the Forge API has been called {count} times in the last minute. Excessive calls may affect performance.",
      "THEFORGE.APIRateMonitorSustainedUsageWarning":
        "Forge API rate monitor warning: {endpoint} on the Forge API has been called continuously for {count} consecutive minutes. Excessive calls may affect performance.",
      "THEFORGE.APIRateMonitorTroubleshooting": `If you are experiencing poor performance, please check the browser dev tools (F12 or Cmd+Opt+I on Mac). For more information, please see the <a href="https://forums.forge-vtt.com/t/forge-api-rate-monitor/97810#troubleshooting-3" target="_blank">troubleshooting guide</a> or <a href="${ForgeVTT.FORGE_URL}/contact" target="_blank">contact Forge support</a>.`,
      "THEFORGE.APIRateMonitorLogTrace": `Forge rate monitor: {endpoint} called {calls} times per minute for {consecutive} consecutive minutes. Excessive calls may affect performance.`,
    };

    if (ForgeVTT.usingTheForge) {
      strings["FILES.CannotUpload"] =
        'Uploads to this folder are prohibited because content here may be overwritten during updates. Upload to "Forge Assets" instead to use your Assets Library quota.';
    }

    return strings;
  }

  // From v12, hooks can receive html arguments that are not jQuery objects
  // This util method ensures that we can use jQuery methods
  static ensureIsJQuery(html) {
    // Check if 'html' is a jQuery object
    if (html instanceof jQuery) {
      return html; // It's already a jQuery object, return as is
    }
    return $(html); // Return a new jQuery object wrapped around the element
  }

  static configureDefaultFavoritePaths() {
    if (!ForgeVTT.isFoundryNewerThan("13")) {
      return;
    }

    const favoritePaths = game.settings.get("core", "favoritePaths") || [];
    const defaultFavorites = game.settings.settings.get("core.favoritePaths").default;

    if (JSON.stringify(favoritePaths) === JSON.stringify(defaultFavorites)) {
      game.settings.set("core", "favoritePaths", {
        "forgevtt-/": { source: "forgevtt", path: "/", label: "root" },
      });
    }
  }
}

ForgeVTT.HEARTBEAT_TIMER = 10 * 60 * 1000; // Send a heartbeat every 10 minutes to update player activity usage and get server updates
ForgeVTT.ACTIVITY_CHECK_INTERVAL = 15 * 1000; // Check for activity 15 seconds
ForgeVTT.ACTIVITY_UPDATE_INTERVAL = 60 * 1000; // Update active status every minute
ForgeVTT.GAME_INACTIVE_THRESHOLD = 2 * 60 * 60 * 1000; // A game inactive for 2 hours should be booted
ForgeVTT.GAME_SOLO_INACTIVE_THRESHOLD = 1 * 60 * 60 * 1000; // A game inactive for 1 hour with no other players should be booted
ForgeVTT.OTHER_INACTIVE_THRESHOLD = 50 * 60 * 1000; // A setup/join page inactive for 50 minutes should be booted
ForgeVTT.HEARTBEAT_ACTIVE_IN_LAST_EVENTS = 10; // Send an active heartbeat if activity detected in the last ACTIVITY_UPDATE_INTERVAL events
ForgeVTT.IDLE_WARN_ADVANCE = 20 * 60 * 1000; // Warn the user about being inactive 20 minutes before idling the game
