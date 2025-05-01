/**
 * @file A utility class that manages API requests to Forge services
 */

import { ForgeVTT } from "./ForgeVTT.mjs";
import { ForgeAPI_RateMonitor } from "./ForgeAPIRateMonitor.mjs";

export class ForgeAPI {
  /**
   * Send an API request
   * @param {string} endpoint               API endpoint
   * @param {FormData} formData             Form Data to send. POST if set, GET otherwise
   * @param {object} options                Options
   * @param {string} options.method         Override API request method to use
   * @param {Function} options.progress     Progress report. function(step, percent)
   *                                        Step 0: Request started
   *                                        Step 1: Uploading request
   *                                        Step 2: Downloading response
   *                                        Step 3: Request completed
   * @param {boolean} options.cookieKey     Force the use of the API Key from the cookies (ignoring custom key in client settings)
   * @param {boolean} options.apiKey        Force the use of the specified API Key
   * @returns {Promise} The sent request
   */
  static async call(endpoint, formData = null, { method, progress, cookieKey, apiKey } = {}) {
    ForgeAPI_RateMonitor.monitor(endpoint);
    // We do need this to be async in order to get our API key.
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, _reject) => {
      if (!ForgeVTT.usingTheForge && !endpoint) {
        return resolve({});
      }

      const url = endpoint
        ? endpoint.startsWith("https://")
          ? endpoint
          : `${ForgeVTT.FORGE_URL}/api/${endpoint}`
        : "/api/forgevtt";
      const xhr = new XMLHttpRequest();
      xhr.withCredentials = true;
      method = method || (formData ? "POST" : "GET");
      xhr.open(method, url);

      // /api/forgevtt is non authenticated (requires XSRF though) and is used to refresh cookies
      if (endpoint) {
        const apiKeyToUse = apiKey || (await this.getAPIKey(cookieKey));
        if (apiKeyToUse) {
          xhr.setRequestHeader("Access-Key", apiKeyToUse);
        } else {
          return resolve({
            code: 403,
            error: "Access Unauthorized. Please enter your API key or sign in to The Forge.",
          });
        }
      }
      if (method === "POST") {
        xhr.setRequestHeader("X-XSRF-TOKEN", await this.getXSRFToken());
      }

      xhr.responseType = "json";
      if (progress) {
        xhr.onloadstart = () => progress(0, 0);
        xhr.upload.onprogress = (event) => progress(1, event.loaded / event.total);
        xhr.onprogress = (event) => progress(2, event.loaded / event.total);
      }
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) {
          return;
        }
        if (progress) {
          progress(3, 1);
        }
        resolve(xhr.response);
      };
      xhr.onerror = (err) => {
        resolve({ code: 500, error: err.message });
      };
      if (!(formData instanceof FormData)) {
        xhr.setRequestHeader("Content-type", "application/json; charset=utf-8");
        formData = JSON.stringify(formData);
      }
      xhr.send(formData);
    });
  }

  static async getAPIKey(cookieKey = false) {
    const apiKey = game.settings && game.settings.get("forge-vtt", "apiKey");
    if (!cookieKey && apiKey && this.isValidAPIKey(apiKey)) {
      return apiKey.trim();
    }
    let cookies = this._parseCookies();
    if (this._isKeyExpired(cookies["ForgeVTT-AccessKey"])) {
      // renew site cookies
      await this.status();
      cookies = this._parseCookies();
    }
    return cookies["ForgeVTT-AccessKey"];
  }
  static async getXSRFToken() {
    let cookies = this._parseCookies();
    if (!cookies["XSRF-TOKEN"]) {
      // renew site cookies
      await this.status();
      cookies = this._parseCookies();
    }
    return cookies["XSRF-TOKEN"];
  }
  static async getUserId() {
    const apiKey = await this.getAPIKey();
    if (!apiKey) {
      return null;
    }
    const info = this._tokenToInfo(apiKey);
    return info.id;
  }
  static _tokenToInfo(token) {
    if (!token) {
      return {};
    }
    try {
      return JSON.parse(atob(token.split(".")[1]));
    } catch {
      return {};
    }
  }

  static _tokenToHash(token) {
    if (!token) {
      return "";
    }
    return token.split(".")[2] || "";
  }
  static _isKeyExpired(token) {
    if (!token) {
      return true;
    }
    const info = this._tokenToInfo(token);
    // token exp field is in epoch seconds, Date.now() is in milliseconds
    // Expire it 1 minute in advance to avoid a race where by the time the request
    // is received on the server, the key has already expired.
    return info.exp && info.exp - 60 < Date.now() / 1000;
  }

  static isValidAPIKey(apiKey) {
    const info = this._tokenToInfo(apiKey);
    if (!info.id) {
      return false;
    }
    return !this._isKeyExpired(apiKey);
  }
  static _parseCookies() {
    return Object.fromEntries(
      document.cookie.split(/; */).map((c) => {
        const [key, ...v] = c.split("=");
        return [key, decodeURIComponent(v.join("="))];
      })
    );
  }
  static async status() {
    if (this._inProgressStatus) {
      return this._inProgressStatus;
    }
    this._inProgressStatus = this.call();
    this.lastStatus = await this._inProgressStatus;
    this._inProgressStatus = null;
    return this.lastStatus;
  }
}
