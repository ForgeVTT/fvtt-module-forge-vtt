class ForgeVTT {
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
    static async api(endpoint, formData = null, { method, progress } = {}) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.withCredentials = true;
            //req.setRequestHeader("Authorization", "jwt " + );
            xhr.open(method || (formData ? 'POST' : 'GET'), `${ForgeVTT.FORGE_URL}/api/${endpoint}`);
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
    static replaceGetter(klass, property, getter) {
        let getterProperty = Object.getOwnPropertyDescriptor(klass, property);
        if (getterProperty == undefined)
            return false;
        Object.defineProperty(klass, 'ForgeVTT_original_' + property, getterProperty);
        Object.defineProperty(klass, property, { get: getter, configurable: true });
    }

    static replaceFunction(klass, name, func) {
        klass['ForgeVTT_original_' + name] = klass[name]
        klass[name] = func
    }

    static init() {
        this.usingTheForge = window.location.host.endsWith(this.HOSTNAME) || window.location.host.endsWith(this.DEV_HOSTNAME);
        if (this.usingTheForge) {
            if (window.location.host.endsWith(this.DEV_HOSTNAME)) {
                this.gameSlug = window.location.host.replace(this.DEV_HOSTNAME, '');
                ForgeVTT.FORGE_URL = "https://dev.forge-vtt.com"
                ForgeVTT.ASSETS_LIBRARY_URL_PREFIX = 'https://assets.dev.forge-vtt.com/'
            } else {
                this.gameSlug = window.location.host.replace(this.HOSTNAME, '');
            }
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
                html.find("label[for=local]").html(`<i class="fas fa-key"></i> Invitation Link`)
                html.find("input[name=local]").val("**************")
                html.find("label[for=remote]").html(`<i class="fas fa-share-alt"></i> Game URL`)
            });
        }
        // Hook the file picker to add My Assets Library to it
        this.hookFilePicker();
        console.log("Welcome to The Forge.")
    }
    static ready() {
    }
    static hookFilePicker() {
        this.replaceFunction(FilePicker.prototype, '_inferCurrentDirectory', ForgeVTT_FilePicker.prototype._inferCurrentDirectory)
        this.replaceGetter(FilePicker.prototype, 'canUpload', ForgeVTT_FilePicker.prototype.getCanUpload)
        this.replaceFunction(FilePicker.prototype, '_onUpload', ForgeVTT_FilePicker.prototype._onUpload)
        this.replaceFunction(FilePicker.prototype, '_onPick', ForgeVTT_FilePicker.prototype._onPick)
        this.replaceFunction(FilePicker, 'browse', ForgeVTT_FilePicker.browse)
        FilePicker.prototype._onInputChange = ForgeVTT_FilePicker.prototype._onInputChange;
        FilePicker.prototype._setURLQuery = ForgeVTT_FilePicker.prototype._setURLQuery;
        FilePicker.prototype._onNewFolder = ForgeVTT_FilePicker.prototype._onNewFolder;
        Hooks.on('renderFilePicker', ForgeVTT_FilePicker._onRender.bind(ForgeVTT_FilePicker))
    }
}

ForgeVTT.HOSTNAME = ".forgevtt.com"
ForgeVTT.DEV_HOSTNAME = ".dev.forge-vtt.com"
ForgeVTT.FORGE_URL = "https://forgevtt.com"
ForgeVTT.ASSETS_LIBRARY_URL_PREFIX = 'https://assets.forge-vtt.com/'

class ForgeVTT_FilePicker extends FilePicker {
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
        target = target || "";
        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            target = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length)
            target = target.split("/").slice(1, -1).join("/") // Remove userid from url to get target path
            return ["forgevtt", target]
        }
        return this.ForgeVTT_original__inferCurrentDirectory(target)
    }

    getCanUpload() {
        const canUpload = !ForgeVTT.usingTheForge && this.ForgeVTT_original_canUpload;
        return canUpload || this.activeSource === "forgevtt";
    }

    static _onRender(obj, html, data) {
        if (ForgeVTT_FilePicker._newFolderDialog) {
            ForgeVTT_FilePicker._newFolderDialog.close();
            ForgeVTT_FilePicker._newFolderDialog = null;
        }
        const input = html.find("input[name=file]");
        const options = $(`
        <div class="form-group stacked forgevtt-options" style="font-size: 12px;">
            <div class="form-group forgevtt-flips">
                <input type="checkbox" name="flop" id="${this.id}-forgevtt-flop">
                <label for="${this.id}-forgevtt-flop">Flip Horizontally</label>
                <input type="checkbox" name="flip" id="${this.id}-forgevtt-flip">
                <label for="${this.id}-forgevtt-flip">Flip Vertically</label>
                <input type="checkbox" name="no-optimizer" id="${this.id}-forgevtt-no-optimizer">
                <label for="${this.id}-forgevtt-no-optimizer">Disable optimizations <a href="https://forums.forge-vtt.com/t/the-assets-library/574"><i class="fas fa-question"></i></a></label>
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
            obj._setURLQuery(input, "optimizer", ev.currentTarget.checked ? "disabled" : null);
        });
        options.find('input[name="flip"]').change(ev => {
            obj._setURLQuery(input, "flip", ev.currentTarget.checked ? "true" : null);
        });
        options.find('input[name="flop"]').change(ev => {
            obj._setURLQuery(input, "flop", ev.currentTarget.checked ? "true" : null);
        });
        options.find('select[name="blur"]').change(ev => {
            obj._setURLQuery(input, "blur", ev.currentTarget.value);
        });
        options.hide();
        input.parent().after(options);
        input.on('input', obj._onInputChange.bind(obj, options, input));
        obj._onInputChange(options, input);
        if (obj.activeSource === "forgevtt") {
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
            uploadDiv.find('button[name="forgevtt-new-folder"]').click(ev => obj._onNewFolder());
        }
    }

    _onInputChange(options, input) {
        const target = input.val();
        if (!target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            options.hide();
            this.setPosition({ height: "auto" })
            return;
        }
        options.show();
        this.setPosition({ height: "auto" });
        try {
            const url = new URL(target);
            const noOptimizer = url.searchParams.get('optimizer') === "disabled";
            const flip = url.searchParams.get('flip') === "true";
            const flop = url.searchParams.get('flop') === "true";
            const blur = parseInt(url.searchParams.get('blur')) || 0;
            options.find('input[name="no-optimizer"]').prop('checked', noOptimizer);
            options.find('input[name="flip"]').prop('checked', flip);
            options.find('input[name="flop"]').prop('checked', flop);
            options.find('select[name="blur"]').val(blur);
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
                        const response = await ForgeVTT.api('assets/newFolder', { path });
                        if (!response || response.error) {
                            ui.notifications.error(response.error);
                        } else if (response.success) {
                            ui.notifications.info("Folder created successfully")
                        }
                        this.browse(path);
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
        this.ForgeVTT_original__onPick(event);
        if (isFile)
            this._onInputChange(this.element.find(".forgevtt-options"), this.element.find("input[name=file]"));
    }

    static async browse(source, target, options = {}) {
        // wildcard for token images hardcodes source as 'data'
        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) source = "forgevtt";
        if (source !== "forgevtt") return this.ForgeVTT_original_browse(source, target, options);

        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            target = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length)
            target = target.split("/").slice(1, -1).join("/") // Remove userid from url to get target path
        }

        const response = await ForgeVTT.api('assets/browse', { path: target, options });
        if (!response || response.error) {
            ui.notifications.error(response.error);
            return { target, dirs: [], files: [] }
        }
        // TODO: Should be decodeURIComponent but FilePicker's _onPick needs to do encodeURIComponent too, but on each separate path.
        response.target = decodeURI(response.folder);
        delete response.folder;
        response.dirs = response.dirs.map(d => decodeURI(d.path.slice(0, -1)));
        response.files = response.files.map(f => decodeURI(f.url));
        return response;
    }
    async _onUpload(ev) {
        if (this.activeSource !== "forgevtt") {
            if (ForgeVTT.usingTheForge)
                throw new Error("You can only upload to the Assets Library.");
            return this.ForgeVTT_original__onUpload(ev);
        }
        const form = ev.target.form;
        const file = form.upload.files[0];

        // Validate file extension
        if (!this.extensions.some(ext => file.name.endsWith(ext))) {
            ui.notifications.error(`Incorrect ${this.type} file extension. Supports ${this.extensions.join(" ")}.`);
            return false;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', `${form.target.value}/${file.name}`);

        form.upload.disabled = true;
        const response = await ForgeVTT.api('assets/upload', formData);
        if (response.error) {
            ui.notifications.error(response.error);
        } else {
            ui.notifications.info("File Uploaded Successfully");
            this.browse();
        }
        form.upload.disabled = false;
    }
}

Hooks.on('init', () => ForgeVTT.init());
Hooks.on('ready', () => ForgeVTT.ready());