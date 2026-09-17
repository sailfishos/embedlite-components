/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
});

const { XPCOMUtils } = ChromeUtils.importESModule("resource://gre/modules/XPCOMUtils.sys.mjs");

const loggerScope = {};
Services.scriptloader.loadSubScript(
  "chrome://embedlite/content/Logger.js",
  loggerScope
);
const { Logger } = loggerScope;

// Common helper service
export function EmbedLiteSearchEngine()
{
  Logger.debug("JSComp: EmbedLiteSearchEngine.js loaded");
}

EmbedLiteSearchEngine.prototype = {
  classID: Components.ID("{924fe7ba-afa1-11e2-9d4f-533572064b73}"),

  _initSent: false,

  _notifyInit: function AC_notifyInit(force) {
    if (this._initSent && !force) {
      return;
    }

    lazy.SearchService.getEngines().then((engines) => {
      let engineNames = engines.map(function (element) {
        return element.name;
      });
      let enginesAvailable = (engines && engines.length > 0);
      let defaultEngine = null;
      if (enginesAvailable) {
        try {
          defaultEngine = lazy.SearchService.defaultEngine;
        } catch (e) {
          Logger.warn("EmbedLiteSearchEngine failed to get default engine:", e);
        }
      }
      var messg = {
        msg: "init",
        engines: engineNames,
        defaultEngine: defaultEngine ? defaultEngine.name : null
      }
      this._initSent = true;
      Services.obs.notifyObservers(null, "embed:search", JSON.stringify(messg));
    }, (error) => {
      Logger.warn("EmbedLiteSearchEngine init failed:", error);
    });
  },

  observe: function (aSubject, aTopic, aData) {
    switch(aTopic) {
      // Engine DownloadManager notifications
      case "app-startup": {
        Services.obs.addObserver(this, "xpcom-shutdown", true);
        Services.obs.addObserver(this, "embedui:search", true);
        Services.obs.addObserver(this, "profile-after-change", false);
        this._notifyInit();
        break;
      }
      case "profile-after-change": {
        Services.obs.removeObserver(this, "profile-after-change");
        this._notifyInit();
        break;
      }
      case "embedui:search": {
        var data = JSON.parse(aData);
        switch (data.msg) {
          case "init": {
            this._notifyInit(true);
            break;
          }
          case "loadxml": {
            lazy.SearchService.addOpenSearchEngine(data.uri, null).then(
              engine => {
                var message = {
                  "msg": "search-engine-added",
                  "engine": (engine && engine.name) || "",
                  "errorCode": 0,
                }
                Services.obs.notifyObservers(null, "embed:search", JSON.stringify(message));
              },
              errorCode => {
                // For failure conditions see the SearchService API.
                var message = {
                  "msg": "search-engine-added",
                  "engine": "",
                  "errorCode": errorCode
                }
                Services.obs.notifyObservers(null, "embed:search", JSON.stringify(message));
              }
            );
            break;
          }
          case "setdefault": {
            var engine = lazy.SearchService.getEngineByName(data.name);
            if (!engine) {
              Logger.warn("EmbedLiteSearchEngine could not find engine:", data.name);
              var missingEngineMessage = {
                "msg": "search-engine-default-changed",
                "defaultEngine": "",
                "errorCode": Cr.NS_ERROR_NOT_AVAILABLE,
              }
              Services.obs.notifyObservers(null, "embed:search", JSON.stringify(missingEngineMessage));
              break;
            }
            lazy.SearchService.setDefault(engine, lazy.SearchService.CHANGE_REASON.USER).then(
              () => {
                try {
                  Services.prefs.setStringPref("browser.search.defaultenginename", engine.name);
                  Services.prefs.savePrefFile(null);
                } catch (e) {
                  Logger.warn("EmbedLiteSearchEngine failed to save default engine pref:", e);
                }
                var message = {
                  "msg": "search-engine-default-changed",
                  "defaultEngine": (engine && engine.name) || "",
                  "errorCode": 0,
                }

                Services.obs.notifyObservers(null, "embed:search", JSON.stringify(message));
              },
              error => {
                var message = {
                  "msg": "search-engine-default-changed",
                  "defaultEngine": "",
                  "errorCode": (error && error.result) || Cr.NS_ERROR_FAILURE,
                }
                Services.obs.notifyObservers(null, "embed:search", JSON.stringify(message));
              }
            );
            break;
          }
          default:
            Logger.debug("Unhandled embedui:search message: " + data.msg);
            break;
        }
        break;
      }
      case "xpcom-shutdown": {
        Services.obs.removeObserver(this, "embedui:search");
        Services.obs.removeObserver(this, "xpcom-shutdown");
        break;
      }
      default:
        break;
    }
  },

  QueryInterface: ChromeUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
};
