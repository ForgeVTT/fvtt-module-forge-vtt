class ForgeVTT {
    static replaceGetter(klass, property, getter) {
        let getterProperty = Object.getOwnPropertyDescriptor(klass, property);
        if (getterProperty == undefined)
            return false;
        Object.defineProperty(klass, 'ForgeVTT_original_' + property, getterProperty);
        Object.defineProperty(klass, property, { get: getter });
    }

    static replaceFunction(klass, name, func) {
        klass['ForgeVTT_original_' + name] = klass[name]
        klass[name] = func
    }

    static hookFilePicker() {
        this.replaceFunction(FilePicker.prototype, '_inferCurrentDirectory', ForgeVTT_FilePicker.prototype._inferCurrentDirectory)
        this.replaceGetter(FilePicker.prototype, 'canUpload', ForgeVTT_FilePicker.prototype.getCanUpload)
        this.replaceFunction(FilePicker.prototype, '_onUpload', ForgeVTT_FilePicker.prototype._onUpload)
        this.replaceFunction(FilePicker, 'browse', ForgeVTT_FilePicker.browse)
    }
}

ForgeVTT.ASSETS_LIBRARY_API_URL = "https://forgevtt.com/api"
ForgeVTT.ASSETS_LIBRARY_URL_PREFIX = 'https://storage.bhs.cloud.ovh.net/v1/AUTH_75d6cfdbfe4345d99836dac09158dc94/forgevtt/assets/'

class ForgeVTT_FilePicker extends FilePicker {
    _inferCurrentDirectory(target) {
        if (this.sources["forgevtt"] === undefined) {
            this.sources["forgevtt"] = {
                target: "",
                dirs: [],
                files: [],
                label: "My Assets Library",
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
        if (this.activeSource === "forgevtt") return true;
        return this.ForgeVTT_original_canUpload;
    }
    
    static async browse(source, target, options={}) {
        if (source !== "forgevtt") return this.ForgeVTT_original_browse(source, target, options);

        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            target = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length)
            target = target.split("/").slice(1, -1).join("/") // Remove userid from url to get target path
        }

        const response = await fetch(`${ForgeVTT.ASSETS_LIBRARY_API_URL}/browse`, {
            method: "POST",
            credentials: "include",
            body: JSON.stringify({target, options}),
            headers: {
                'Content-Type': 'application/json'
            }
        })
        const result = await response.json();
        if ( result.error ) throw result.error;
        result.target = decodeURI(result.folder);
        delete result.folder;
        result.dirs = result.dirs.map(d => decodeURI(d.path.slice(0, -1)));
        result.files = result.files.map(f => decodeURI(f.url));
        return result;
    }
    _onUpload(ev) {
        if (this.activeSource !== "forgevtt") return this.ForgeVTT_original__onUpload(ev);
        const form = ev.target.form,
              formData = new FormData(form),
              upload = form.upload,
              filename = formData.get("upload").name;
    
        // Validate file extension
        if ( !this.extensions.some(ext => filename.endsWith(ext)) ) {
          ui.notifications.error(`Incorrect ${this.type} file extension. Supports ${this.extensions.join(" ")}.`);
          return false;
        }
    
        // Add the source path
        formData.append("source", this.activeSource);
    
        // Create a POST request
        const xhr = new XMLHttpRequest();
        xhr.withCredentials = true;
        xhr.open('POST', `${ForgeVTT.ASSETS_LIBRARY_API_URL}/upload`, true);
        xhr.onloadstart = event => upload.disabled = true;
        xhr.onreadystatechange = () => {
          if ( xhr.readyState !== 4 ) return;
          const response = JSON.parse(xhr.responseText)
          if ( xhr.status !== 200 ) ui.notifications.error(response.error);
          else {
            ui.notifications.info(response.msg);
            this.browse();
          }
          upload.disabled = false;
        };
    
        // Submit the POST request
        xhr.send(formData);
    }
}
ForgeVTT.hookFilePicker()