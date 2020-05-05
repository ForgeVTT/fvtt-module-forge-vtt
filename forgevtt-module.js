const THE_FORGE_ASCII_ART = `
                                                                #               
                                                              (%                
                              %%%%%                          %%/                
                             %%%%%%%%,                     %%%%         *       
                             .%%%%%%%%%%                  %%%%.     %%%         
                              #%%%%%%%%%%%              %%%%%% %%%%%%,          
                             (%%%%%%%%%%%%%        %* ,%%%%%%%%%%%%%            
                        %%%%%%%%%%%%%%%%%%%%      %%%%%%%%%%%%%%%%              
                  #%%%%%%%%%%%    %%%%%%%%%%,    %%%%%%%%%%%%%%%%%%%%%%%        
             %%%%%%%%%%%.          %%%%%%%%%%   %%%%%%%  %%%%%%%%%              
       %%%%%%%%%%%#                  %%%%      (%*       %%#                    
   (%%%%%%%%%                                                                   
    ,%%#                       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%            
                 *%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%            
                   %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%,        
                     %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%/    
                       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%/    
                           #%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%        
                               %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%            
                               %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%            
                                        %%%%%%%%%%%%%%%%%%                      
                                       %%%%%%%%%%%%%%%%%%%%/                    
                                     %%%%%%%%%%%%%%%%%%%%%%%%                   
                                   %%%%%%%%%%%%%%%%%%%%%%%%%%%%                 
                                ,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%              
                           #%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%        
                                                                                 
                                     Welcome to The Forge.
`;

class ForgeVTT {
    static init() {
        // Register Settings
        game.settings.register("forge-vtt", "apiKey", {
            name: "API Secret Key",
            hint: "API Key to access the Forge assets library. Leave empty to use your own account while playing on The Forge. API Key is available in the My Account page.",
            scope: "client",
            config: true,
            default: "",
            type: String,
        });

        // Verify if we're running on the forge or not, and set things up accordingly
        this.usingTheForge = window.location.host.endsWith(".forge-vtt.com");
        this.HOSTNAME = "forge-vtt.com";
        this.FORGE_URL = `https://${this.HOSTNAME}`;
        this.ASSETS_LIBRARY_URL_PREFIX = 'https://assets.forge-vtt.com/'
        if (this.usingTheForge) {
            const parts = window.location.host.split(".");
            this.gameSlug = parts[0];
            this.HOSTNAME = parts.slice(1).join(".")
            this.FORGE_URL = `https://${this.HOSTNAME}`;
            if (this.HOSTNAME === "dev.forge-vtt.com")
                this.ASSETS_LIBRARY_URL_PREFIX = 'https://assets.dev.forge-vtt.com/'

            // Remove Configuration tab from /setup page
            Hooks.on('renderSetupConfigurationForm', (setup, html) => {
                console.log("render", html)
                html.find(`a[data-tab="configuration"],a[data-tab="update"]`).remove()
            });
            Hooks.on('renderSettings', (obj, html) => {
                const forgevtt_button = $(`
          <button data-action="forgevtt">
            <i class="fas fa-home"></i> Back to The Forge
          </button>`).click(() => window.location = `${this.FORGE_URL}/game/${this.gameSlug}`);
                html.find("button[data-action=logout]").html(`<i class="fas fa-door-closed"></i> Back to Join Screen`).after(forgevtt_button);
            });
            // TODO: Probably better to just replace the entire Application and use API to get the invite link if user is owner
            Hooks.on('renderInvitationLinks', (obj, html) => {
                html.find("form p.notes").html(`Share the below invitation links with users who you wish to have join your game.<br/>
                * The Invitation Link is for granting access to Forge users to this game (required for private games).<br/>
                * The Game URL is the direct link to this game for public games or for players who already joined it.`);
                html.find("label[for=local]").html(`<i class="fas fa-key"></i> Invitation Link`)
                html.find("label[for=remote]").html(`<i class="fas fa-share-alt"></i> Game URL`)
                obj.setPosition({ height: "auto" });
            });

            // Start the activity checker to track player usage and prevent people from idling forever
            this._checkForActivity();
        }

        // Hook the file picker to add My Assets Library to it
        FilePicker = ForgeVTT_FilePicker;
        FilePicker.LAST_BROWSED_DIRECTORY = this.usingTheForge ? this.ASSETS_LIBRARY_URL_PREFIX : "";

        // Welcome!
        console.log(THE_FORGE_ASCII_ART);
    }
    static async ready() {
        // If we're running on the forge and there is no loaded module, then add a fake module
        // so the user can change the settings.
        if (!game.modules.get('forge-vtt')) {
            game.modules.set('forge-vtt', {
                active: true,
                id: "forge-vtt",
                data: {
                    name: "forge-vtt",
                    title: "The Forge",
                    description: "The Forge"
                }
            });
        }

        // If on The Forge, get the status/invitation url and start heartbeat to track player usage
        if (this.usingTheForge) {
            game.data.addresses.local = "<Not available>";
            const status = await ForgeAPI.status().catch(console.error);
            if (status.invitation)
                game.data.addresses.local = `${this.FORGE_URL}/invite/${this.gameSlug}/${status.invitation}`;
            if (status.annoucements)
                this._handleAnnouncements(status.annoucements);
            // Send heartbeats for in game players
            if (window.location.pathname.startsWith("/game"))
                this._sendHeartBeat(true);
        }
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
            active: true
        };
        $(window).blur(() => {
            this.activity.focused = false
        }).focus(() => {
            this.activity.focused = true
        }).on('mousemove', (ev) => {
            this.activity.mouseX = ev.clientX;
            this.activity.mouseT = ev.clientY;
        }).on('keyup', (ev) => {
            this.activity.keyUp = true;
        });

        setInterval(() => this._addActivityReport(), ForgeVTT.ACTIVITY_CHECK_INTERVAL);
        setInterval(() => this._updateActivity(), ForgeVTT.ACTIVITY_UPDATE_INTERVAL);
    }
    static _addActivityReport() {
        const report = {
            mouseMoved: this.activity.lastX !== this.activity.mouseX || this.activity.lastY !== this.activity.mouseY,
            keyboardUsed: this.activity.keyUp,
            focused: this.activity.focused
        };
        //console.log("New activity report : ", report);
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
            if (report.mouseMoved || report.keyboardUsed)
                acc++;
            return acc;
        }, 0);
        this.activity.active = numEvents >= minEvents;
        // keep the last 100 activity events
        this.activity.events = this.activity.events.concat([this.activity.active]).slice(-100);

        this.activity.reports = [];
        if (this.activity.active) {
            this.activity.lastActive = Date.now();
        } else {
            this._verifyInactivePlayer()
        }
    }

    static async _verifyInactivePlayer() {
        const inactiveFor = Date.now() - this.activity.lastActive;
        if (window.location.pathname.startsWith("/game")) {
            if (inactiveFor > ForgeVTT.GAME_INACTIVE_THRESHOLD) {
                await ForgeAPI.call(null, { action: "inactive", path: window.location.pathname, inactivity: inactiveFor }).catch(console.error);
                window.location = `https://${this.HOSTNAME}/game/${this.gameSlug}`;
            } else if (inactiveFor > ForgeVTT.GAME_INACTIVE_THRESHOLD - ForgeVTT.IDLE_WARN_ADVANCE) {
                this._warnInactivePlayer(inactiveFor);
            }
        } else {
            if (inactiveFor > ForgeVTT.OTHER_INACTIVE_THRESHOLD) {
                await ForgeAPI.call(null, { action: "inactive", path: window.location.pathname, inactivity: inactiveFor }).catch(console.error);
                window.location = `https://${this.HOSTNAME}/game/${this.gameSlug}`;
            } else if (inactiveFor > ForgeVTT.OTHER_INACTIVE_THRESHOLD - ForgeVTT.IDLE_WARN_ADVANCE) {
                this._warnInactivePlayer(inactiveFor);
            }
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
        if (this.activity.warning) return;
        const redirectTS = new Date(Date.now() + ForgeVTT.IDLE_WARN_ADVANCE);
        const time = new Intl.DateTimeFormat('default', {
            hour12: true,
            hour: 'numeric',
            minute: 'numeric'
        }).format(redirectTS);

        this.activity.warning = new Dialog({
            content: `<div>You have been inactive for ${this._tsToH(inactivity)}.</div>
            <div>Confirm you are still here or you will be redirected in ${ this._tsToH(ForgeVTT.IDLE_WARN_ADVANCE)} (${time}).</div>`,
            buttons: {
                active: {
                    label: "I'm here!",
                    callback: () => {
                        this.activity.events.push(true);
                        this.activity.lastActive = Date.now();
                        this.activity.warning = null;
                    }
                },
                inactive: {
                    label: "You're right, take me home",
                    callback: () => {
                        window.location = `https://${this.HOSTNAME}/game/${this.gameSlug}`;
                    }
                }
            }
        }).render(true)
    }
    // Consider the user active if they had one activity event in the last HEARTBEAT_ACTIVE_IN_LAST_EVENTS events
    static _getActivity() {
        return this.activity.events.slice(-1 * ForgeVTT.HEARTBEAT_ACTIVE_IN_LAST_EVENTS).some(active => active);
    }
    static async _sendHeartBeat(force) {
        const active = force || this._getActivity();
        const response = await ForgeAPI.call(null, { action: "heartbeat", active }).catch(console.error) || {};
        if (response.announcements)
            this._handleAnnouncements(response.announcements);
        // Send a heartbeat every 10 minutes;
        setTimeout(this._sendHeartBeat.bind(this), ForgeVTT.HEARTBEAT_TIMER);
    }

    static _handleAnnouncements(announcements) {
        this.displayedAnnouncements = this.displayedAnnouncements || [];
        const newAnnouncements = Object.keys(announcements).filter(id => !this.displayedAnnouncements.includes(id));
        for (let id of newAnnouncements) {
            ui.notifications.info(announcements[id], { permanent: true });
            this.displayedAnnouncements.push(id);
        }
    }
}

ForgeVTT.HEARTBEAT_TIMER = 10 * 60 * 1000; // Send a heartbeat every 10 minutes to update player activity usage and get server updates
ForgeVTT.ACTIVITY_CHECK_INTERVAL = 15 * 1000; // Check for activity 15 seconds
ForgeVTT.ACTIVITY_UPDATE_INTERVAL = 60 * 1000; // Update active status every minute
ForgeVTT.GAME_INACTIVE_THRESHOLD = 6 * 60 * 60 * 1000; // A game inactive for 6 hours should be booted
ForgeVTT.OTHER_INACTIVE_THRESHOLD = 50 * 60 * 1000; // A setup/join page inactive for 50 minutes should be booted
ForgeVTT.HEARTBEAT_ACTIVE_IN_LAST_EVENTS = 10; // Send an active heartbeat if activity detected in the last ACTIVITY_UPDATE_INTERVAL events 
ForgeVTT.IDLE_WARN_ADVANCE = 20 * 60 * 1000;  // Warn the user about being inactive 20 minutes before idling the game

/*
// For testing
ForgeVTT.HEARTBEAT_TIMER = 1 * 60 * 1000;
ForgeVTT.ACTIVITY_CHECK_INTERVAL = 10 * 1000;
ForgeVTT.ACTIVITY_UPDATE_INTERVAL = 60 * 1000;
ForgeVTT.GAME_INACTIVE_THRESHOLD = 3 * 60 * 1000;
ForgeVTT.OTHER_INACTIVE_THRESHOLD = 1 * 60 * 1000;
ForgeVTT.HEARTBEAT_ACTIVE_IN_LAST_EVENTS = 10;
ForgeVTT.IDLE_WARN_ADVANCE = 60 * 1000; 
*/

class ForgeAPI {

    /**
     * Send an API request
     * @param {String} endpoint               API endpoint
     * @param {FormData} formData             Form Data to send. POST if set, GET otherwise
     * @param {Object} options                Options
     * @param {String} options.method         Override API request method to use
     * @param {Function} options.progress     Progress report. function(step, percent)
     *                                        Step 0: Request started
     *                                        Step 1: Uploading request
     *                                        Step 2: Downloading response
     *                                        Step 3: Request completed
     */
    static async call(endpoint, formData = null, { method, progress } = {}) {
        return new Promise(async (resolve, reject) => {
            const url = endpoint ? `${ForgeVTT.FORGE_URL}/api/${endpoint}` : "/api/forgevtt";
            const xhr = new XMLHttpRequest();
            xhr.withCredentials = true;
            xhr.open(method || (formData ? 'POST' : 'GET'), url);

            // /api/forgevtt is non authenticated (requires XSRF though) and is used to refresh cookies
            if (endpoint) {
                const apiKey = await this.getAPIKey();
                if (apiKey)
                    xhr.setRequestHeader('Access-Key', apiKey);
            }
            const cookies = this._parseCookies();
            if (cookies['XSRF-TOKEN'])
                xhr.setRequestHeader('X-XSRF-TOKEN', cookies['XSRF-TOKEN'])

            xhr.responseType = 'json';
            if (progress) {
                xhr.onloadstart = () => progress(0, 0);
                xhr.upload.onprogress = (event) => progress(1, event.loaded / event.total);
                xhr.onprogress = (event) => progress(2, event.loaded / event.total);
            }
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) return;
                if (progress)
                    progress(3, 1);
                resolve(xhr.response);
            };
            xhr.onerror = (err) => {
                resolve({ code: 500, error: err.message });
            };
            if (!(formData instanceof FormData)) {
                xhr.setRequestHeader('Content-type', 'application/json; charset=utf-8');
                formData = JSON.stringify(formData);
            }
            xhr.send(formData);
        });
    }

    static async getAPIKey() {
        const apiKey = game.settings.get("forge-vtt", "apiKey");
        if (apiKey) return apiKey;
        let cookies = this._parseCookies();
        if (this._isKeyExpired(cookies['ForgeVTT-AccessKey'])) {
            // renew site cookies
            await this.status();
            cookies = this._parseCookies();
        }
        return cookies['ForgeVTT-AccessKey'];
    }
    static async getUserId() {
        const apiKey = await this.getAPIKey();
        if (!apiKey) return null;
        const info = this._tokenToInfo(apiKey);
        return info.id;
    }
    static _tokenToInfo(token) {
        if (!token) return {};
        try {
            return JSON.parse(atob(token.split(".")[1]));
        } catch (err) {
            return {};
        }
    }
    static _isKeyExpired(token) {
        if (!token) return true;
        const info = this._tokenToInfo(token);
        // token exp field is in epoch seconds, Date.now() is in milliseconds
        return info.exp && info.exp < (Date.now() / 1000);
    }
    static _parseCookies() {
        return Object.fromEntries(document.cookie.split(/; */).map(c => {
            const [key, ...v] = c.split('=');
            return [key, decodeURIComponent(v.join('='))];
        }));
    }
    static status() {
        return this.call();
    }
}


class ForgeVTT_FilePicker extends FilePicker {
    constructor(...args) {
        super(...args);
        this._newFilePicker = isNewerVersion(game.data.version, "0.5.5");
    }
    // Keep our class name proper and the Hooks with the proper names
    static get name() {
        return "FilePicker";
    }

    _inferCurrentDirectory(target) {
        if (this.sources["forgevtt"] === undefined) {
            this.sources["forgevtt"] = {
                target: "",
                dirs: [],
                files: [],
                label: ForgeVTT.usingTheForge ? "My Assets Library" : "The Forge Assets",
                icon: "fas fa-cloud"
            }
        }
        target = target || this.constructor.LAST_BROWSED_DIRECTORY;
        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            target = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length)
            target = target.split("/").slice(1, -1).join("/") // Remove userid from url to get target path
            return ["forgevtt", target]
        }
        return super._inferCurrentDirectory(target)
    }

    get canUpload() {
        const canUpload = !ForgeVTT.usingTheForge && super.canUpload;
        return canUpload || this.activeSource === "forgevtt";
    }

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
        `)
        options.find('input[name="no-optimizer"]').change(ev => {
            this._setURLQuery(input, "optimizer", ev.currentTarget.checked ? "disabled" : null);
        });
        options.find('input[name="flip"]').change(ev => {
            this._setURLQuery(input, "flip", ev.currentTarget.checked ? "true" : null);
        });
        options.find('input[name="flop"]').change(ev => {
            this._setURLQuery(input, "flop", ev.currentTarget.checked ? "true" : null);
        });
        options.find('select[name="blur"]').change(ev => {
            this._setURLQuery(input, "blur", ev.currentTarget.value);
        });
        options.hide();
        input.parent().after(options);
        input.on('input', this._onInputChange.bind(this, options, input));
        this._onInputChange(options, input);
        // 0.5.6 FilePicker has lazy loading of thumbnails and supports folder creation
        if (this._newFilePicker) {
            if (this.activeSource === "forgevtt")
                html.find(`button[data-action="toggle-privacy"]`).remove();
            const images = html.find("img");
            for (let img of images.toArray()) {
                if (!img.src && img.dataset.src && img.dataset.src.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
                    try {
                        // Ask server to thumbnail the image to make display of large scene background
                        // folders easier
                        const url = new URL(img.dataset.src);
                        url.searchParams.set("height", "200");
                        img.dataset.src = url.href;
                    } catch (err) {}
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
                </div>`)
                upload.hide();
                upload.after(uploadDiv)
                uploadDiv.append(upload);
                uploadDiv.find('button[name="forgevtt-upload"]').click(ev => upload.click());
                uploadDiv.find('button[name="forgevtt-new-folder"]').click(ev => this._onNewFolder());
            }
        }
    }

    _onInputChange(options, input) {
        const target = input.val();
        if (!target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            options.hide();
            this.setPosition({ height: "auto" })
            return;
        }
        try {
            const url = new URL(target);
            const isImage = [".jpg", ".png", ".svg"].includes(url.pathname.toLowerCase().slice(-4)) || [".jpeg", ".webp"].includes(url.pathname.toLowerCase().slice(-5))
            if (!isImage) {
                options.hide();
                this.setPosition({ height: "auto" });
                return;
            }
            const noOptimizer = url.searchParams.get('optimizer') === "disabled";
            const flip = url.searchParams.get('flip') === "true";
            const flop = url.searchParams.get('flop') === "true";
            const blur = parseInt(url.searchParams.get('blur')) || 0;
            options.find('input[name="no-optimizer"]').prop('checked', noOptimizer);
            options.find('input[name="flip"]').prop('checked', flip);
            options.find('input[name="flop"]').prop('checked', flop);
            options.find('select[name="blur"]').val(blur);
            options.show();
            this.setPosition({ height: "auto" });
        } catch (err) { }
    }

    _setURLQuery(input, query, value) {
        const target = input.val();
        if (!target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX))
            return;
        try {
            const url = new URL(target);
            if (value) url.searchParams.set(query, value);
            else url.searchParams.delete(query);
            input.val(url.href);
        } catch (err) { }
    }

    // Used for pre-0.5.6 foundry versions
    _onNewFolder(ev) {
        if (this.activeSource !== "forgevtt") return;
        if (ForgeVTT_FilePicker._newFolderDialog)
            ForgeVTT_FilePicker._newFolderDialog.close();
        const target = this.source.target;
        ForgeVTT_FilePicker._newFolderDialog = new Dialog({
            "title": "Create New Assets Folder",
            "content": `
                <div class="form-group stacked">
                    <label>Enter the name of the folder you want to create : </label>
                    <input type="text" name="folder-name"/>
                </div>
            `,
            "buttons": {
                "ok": {
                    "label": "Create Folder",
                    "icon": '<i class="fas fa-folder-plus"></i>',
                    "callback": async (html) => {
                        const name = html.find('input[name="folder-name"]').val().trim();
                        const path = `${target}/${name}`;
                        if (!name) return;
                        const response = await ForgeAPI.call('assets/newFolder', { path });
                        if (!response || response.error) {
                            ui.notifications.error(response.error);
                        } else if (response.success) {
                            ui.notifications.info("Folder created successfully")
                            this.browse(path);
                        }
                    }
                },
                "cancel": { "label": "Cancel" }
            },
            "default": "ok",
            "close": (html) => { }
        }).render(true)
    }
    _onPick(event) {
        const isFile = !event.currentTarget.classList.contains("dir");
        super._onPick(event);
        if (isFile)
            this._onInputChange(this.element.find(".forgevtt-options"), this.element.find("input[name=file]"));
    }

    static async browse(source, target, options = {}) {
        // wildcard for token images hardcodes source as 'data'
        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) source = "forgevtt";
        if (source !== "forgevtt") return super.browse(source, target, options);

        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            if (options.wildcard)
                options.wildcard = target;
            target = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length)
            target = target.split("/").slice(1, -1).join("/") // Remove userid from url to get target path
        }

        const response = await ForgeAPI.call('assets/browse', { path: target, options });
        if (!response || response.error) {
            ui.notifications.error(response.error);
            return { target, dirs: [], files: [], gridSize: null, private: false, privateDirs: [], extensions: options.extensions }
        }
        // TODO: Should be decodeURIComponent but FilePicker's _onPick needs to do encodeURIComponent too, but on each separate path.
        response.target = decodeURI(response.folder);
        delete response.folder;
        response.dirs = response.dirs.map(d => decodeURI(d.path.slice(0, -1)));
        response.files = response.files.map(f => decodeURI(f.url));
        // 0.5.6 specific
        response.private = true;
        response.privateDirs = [];
        response.gridSize = null;
        response.extensions = options.extensions;
        return response;
    }
    // 0.5.6 specific functions.
    static async configurePath(source, target, options={}) {
        if (source === "forgevtt") {
            ui.notifications.error("This feature is not supported in the Assets Library.<br/>Your Assets are all private and can be instead shared through the API Manager on your Account page on the Forge.");
            return {private: true};
        }
        return super.configurePath(source, target, options);
    }
    static async createDirectory(source, target, options={}) {
        if (source !== "forgevtt") return super.createDirectory(source, target, options);
        if (!target) return;
        const response = await ForgeAPI.call('assets/newFolder', { path: target });
        if (!response || response.error)
            throw new Error(response ? response.error : "Unknown error while creating directory.");
    }

    async browse(target, options) {
        const result = await super.browse(target, options);
        if (this.activeSource === "forgevtt")
            this.constructor.LAST_BROWSED_DIRECTORY = ForgeVTT.ASSETS_LIBRARY_URL_PREFIX + (await ForgeAPI.getUserId() || "user") + "/" + result.target + "/";
        return result;
    }

    static async upload(source, target, file, options) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', `${target}/${file.name}`);

        const response = await ForgeAPI.call('assets/upload', formData);
        if (response.error) {
            ui.notifications.error(response.error);
            return false;
        } else {
            ui.notifications.info("File Uploaded Successfully");
            return { path: response.url }
        }
    }

    // Need to override fromButton because it references itself, so it creates the original
    // FilePicker instead of this derived class
    static fromButton(...args) {
        const fp = super.fromButton(...args);
        if (!fp) return fp;
        // Can't use fp.options because fp.options.field becomes an object due to mergeObject, not a jquery
        return new ForgeVTT_FilePicker({
            field: fp.field,
            type: fp.type,
            current: fp.request,
            button: fp.button
        });
    }
}

Hooks.on('init', () => ForgeVTT.init());
Hooks.on('ready', () => ForgeVTT.ready());