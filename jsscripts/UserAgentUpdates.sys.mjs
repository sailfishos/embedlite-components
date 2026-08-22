/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Ported from esr60 sha1 682b1ec3b2c92831a0ea97754ce4fdd00b9497ae
// https://git.sailfishos.org/mirror/gecko-dev/blob/esr60/netwerk/protocol/http/UserAgentUpdates.jsm
// With some esr78 compatibility changes applied.

"use strict";

const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");
const { XPCOMUtils } = ChromeUtils.importESModule("resource://gre/modules/XPCOMUtils.sys.mjs");

Cu.importGlobalProperties(["XMLHttpRequest"]);

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
  UpdateUtils: "resource://gre/modules/UpdateUtils.sys.mjs",
});

XPCOMUtils.defineLazyServiceGetter(
  lazy, "gUpdateTimer", "@mozilla.org/updates/timer-manager;1", "nsIUpdateTimerManager");

ChromeUtils.defineLazyGetter(lazy, "gApp",
  function() {
    return Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo)
                                            .QueryInterface(Ci.nsIXULRuntime);
  });

ChromeUtils.defineLazyGetter(lazy, "gDecoder",
  function() { return new TextDecoder(); }
);

ChromeUtils.defineLazyGetter(lazy, "gEncoder",
  function() { return new TextEncoder(); }
);

const TIMER_ID = "user-agent-updates-timer";

const PREF_UPDATES = "general.useragent.updates.";
const PREF_UPDATES_ENABLED = PREF_UPDATES + "enabled";
const PREF_UPDATES_URL = PREF_UPDATES + "url";
const PREF_UPDATES_INTERVAL = PREF_UPDATES + "interval";
const PREF_UPDATES_RETRY = PREF_UPDATES + "retry";
const PREF_UPDATES_TIMEOUT = PREF_UPDATES + "timeout";
const PREF_UPDATES_LASTUPDATED = PREF_UPDATES + "lastupdated";

const KEY_PREFDIR = "PrefD";
const KEY_APPDIR = "XCurProcD";
const FILE_UPDATES = "ua-update.json";

const PREF_APP_DISTRIBUTION = "distribution.id";
const PREF_APP_DISTRIBUTION_VERSION = "distribution.version";

var gInitialized = false;

function readChannel(url) {
  return new Promise((resolve, reject) => {
    try {
      let channel = lazy.NetUtil.newChannel({uri: url, loadUsingSystemPrincipal: true});
      channel.contentType = "application/json";

      lazy.NetUtil.asyncFetch(channel, (inputStream, status) => {
        if (!Components.isSuccessCode(status)) {
          reject();
          return;
        }

        let data = JSON.parse(
          lazy.NetUtil.readInputStreamToString(inputStream, inputStream.available())
        );
        resolve(data);
      });
    } catch (ex) {
      reject(new Error("UserAgentUpdates: Could not fetch " + url + " " +
                       ex + "\n" + ex.stack));
    }
  });
}

export const UserAgentUpdates = {
  init: function(callback) {
    if (gInitialized) {
      return;
    }
    gInitialized = true;

    this._callback = callback;
    this._lastUpdated = 0;
    this._applySavedUpdate();

    Services.prefs.addObserver(PREF_UPDATES, this);
  },

  uninit: function() {
    if (!gInitialized) {
      return;
    }
    gInitialized = false;
    Services.prefs.removeObserver(PREF_UPDATES, this);
  },

  _applyUpdate: function(update) {
    // Check pref again in case it has changed
    if (update && this._getPref(PREF_UPDATES_ENABLED, false)) {
      this._callback(update);
    } else {
      this._callback(null);
    }
  },

  _applySavedUpdate: function() {
    if (!this._getPref(PREF_UPDATES_ENABLED, false)) {
      // remove previous overrides
      this._applyUpdate(null);
      return;
    }
    // try loading from profile dir, then from app dir
    let dirs = [KEY_PREFDIR, KEY_APPDIR];

    dirs.reduce((prevLoad, dir) => {
      let file = lazy.FileUtils.getFile(dir, [FILE_UPDATES], true).path;
      // tryNext returns promise to read file under dir and parse it
      let tryNext = () => IOUtils.read(file).then(
        (bytes) => {
          let update = JSON.parse(lazy.gDecoder.decode(bytes));
          if (!update) {
            throw new Error("invalid update");
          }
          return update;
        }
      );
      // try to load next one if the previous load failed
      return prevLoad ? prevLoad.catch(tryNext) : tryNext();
    }, null).catch((ex) => {
      if (AppConstants.platform !== "android") {
        // All previous (non-Android) load attempts have failed, so we bail.
        throw new Error("UserAgentUpdates: Failed to load " + FILE_UPDATES +
                         ex + "\n" + ex.stack);
      }
      // Make one last attempt to read from the Fennec APK root.
      return readChannel("resource://android/" + FILE_UPDATES);
    }).then((update) => {
      // Apply update if loading was successful
      this._applyUpdate(update);
    }).catch(Cu.reportError);
    this._scheduleUpdate();
  },

  _saveToFile: function(update) {
    let file = lazy.FileUtils.getFile(KEY_PREFDIR, [FILE_UPDATES], true);
    let path = file.path;
    let bytes = lazy.gEncoder.encode(JSON.stringify(update));
    IOUtils.write(path, bytes, { tmpPath: path + ".tmp" }).then(
      () => {
        this._lastUpdated = Date.now();
        Services.prefs.setCharPref(
          PREF_UPDATES_LASTUPDATED, this._lastUpdated.toString());
      },
      Cu.reportError
    );
  },

  _getPref: function(name, def) {
    try {
      switch (typeof def) {
        case "number": return Services.prefs.getIntPref(name);
        case "boolean": return Services.prefs.getBoolPref(name);
      }
      return Services.prefs.getCharPref(name);
    } catch (e) {
      return def;
    }
  },

  _getParameters() {
    return {
      "%DATE%": function() { return Date.now().toString(); },
      "%PRODUCT%": function() { return lazy.gApp.name; },
      "%APP_ID%": function() { return lazy.gApp.ID; },
      "%APP_VERSION%": function() { return lazy.gApp.version; },
      "%BUILD_ID%": function() { return lazy.gApp.appBuildID; },
      "%OS%": function() { return lazy.gApp.OS; },
      "%CHANNEL%": function() { return lazy.UpdateUtils.UpdateChannel; },
      "%DISTRIBUTION%": function() { return this._getPref(PREF_APP_DISTRIBUTION, ""); },
      "%DISTRIBUTION_VERSION%": function() { return this._getPref(PREF_APP_DISTRIBUTION_VERSION, ""); },
    };
  },

  _getUpdateURL: function() {
    let url = this._getPref(PREF_UPDATES_URL, "");
    let params = this._getParameters();
    return url.replace(/%[A-Z_]+%/g, function(match) {
      let param = params[match];
      // preserve the %FOO% string (e.g. as an encoding) if it's not a valid parameter
      return param ? encodeURIComponent(param()) : match;
    });
  },

  _fetchUpdate: function(url, success, error) {
    let request = new XMLHttpRequest();
    request.mozBackgroundRequest = true;
    request.timeout = this._getPref(PREF_UPDATES_TIMEOUT, 60000);
    request.open("GET", url, true);
    request.overrideMimeType("application/json");
    request.responseType = "json";

    request.addEventListener("load", function() {
      let response = request.response;
      response ? success(response) : error();
    });
    request.addEventListener("error", error);
    request.send();
  },

  _update: function() {
    let url = this._getUpdateURL();
    url && this._fetchUpdate(url,
      response => { // success
        // apply update and save overrides to profile
        this._applyUpdate(response);
        this._saveToFile(response);
        this._scheduleUpdate(); // cancel any retries
      },
      response => { // error
        this._scheduleUpdate(true /* retry */);
      });
  },

  _scheduleUpdate: function(retry) {
    // only schedule updates in the main process
    if (lazy.gApp.processType !== Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT) {
      return;
    }
    let interval = this._getPref(PREF_UPDATES_INTERVAL, 604800 /* 1 week */);
    if (retry) {
      interval = this._getPref(PREF_UPDATES_RETRY, interval);
    }
    lazy.gUpdateTimer.registerTimer(TIMER_ID, this, Math.max(1, interval));
  },

  notify: function(timer) {
    // timer notification
    if (this._getPref(PREF_UPDATES_ENABLED, false)) {
      this._update();
    }
  },

  observe: function(subject, topic, data) {
    switch (topic) {
      case "nsPref:changed":
        if (data === PREF_UPDATES_ENABLED) {
          this._applySavedUpdate();
        } else if (data === PREF_UPDATES_INTERVAL) {
          this._scheduleUpdate();
        } else if (data === PREF_UPDATES_LASTUPDATED) {
          // reload from file if there has been an update
          let lastUpdated = parseInt(
            this._getPref(PREF_UPDATES_LASTUPDATED, "0"), 0);
          if (lastUpdated > this._lastUpdated) {
            this._applySavedUpdate();
            this._lastUpdated = lastUpdated;
          }
        }
        break;
    }
  },

  QueryInterface: ChromeUtils.generateQI([
    Ci.nsIObserver,
    Ci.nsITimerCallback,
  ]),
};
