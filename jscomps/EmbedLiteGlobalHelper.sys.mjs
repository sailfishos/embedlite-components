/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

const { LoginManagerParent } = ChromeUtils.importESModule("resource://gre/modules/LoginManagerParent.sys.mjs");

const loggerScope = {};
Services.scriptloader.loadSubScript(
  "chrome://embedlite/content/Logger.js",
  loggerScope
);
const { Logger } = loggerScope;

// Register ESR115 JSWindowActors in the parent process. EmbedLite does not run
// Firefox's normal browser chrome bootstrap that would otherwise do this.
ChromeUtils.importESModule("resource://gre/modules/ActorManagerParent.sys.mjs");

// Firefox registers its Prompt actor from the desktop browser bootstrap.
// EmbedLite does not run that bootstrap, but remote content still uses the
// actor to ask the parent process to show JavaScript dialogs.
try {
  ChromeUtils.registerWindowActor("Prompt", {
    parent: {
      esModuleURI:
        "resource://embedlite-components/EmbedLitePromptParent.sys.mjs",
    },
    allFrames: true,
  });
} catch (error) {
  // A product embedding EmbedLite may already provide a Prompt actor.
  if (error.result !== Cr.NS_ERROR_DOM_NOT_SUPPORTED_ERR) {
    throw error;
  }
}

try {
  ChromeUtils.registerWindowActor("EmbedLiteNetError", {
    child: {
      esModuleURI:
        "resource://embedlite-components/EmbedLiteNetErrorChild.sys.mjs",
      events: {
        DOMContentLoaded: {},
      },
    },
    matches: ["about:certerror?*", "about:neterror?*"],
    allFrames: true,
  });
} catch (error) {
  if (error.result !== Cr.NS_ERROR_DOM_NOT_SUPPORTED_ERR) {
    throw error;
  }
}

// Search-engine configuration and submission generation are parent-owned on
// current Gecko. Let the content selection helper request a submission URI
// without instantiating the search service in the content process.
try {
  ChromeUtils.registerWindowActor("EmbedLiteSelection", {
    parent: {
      esModuleURI:
        "resource://embedlite-components/EmbedLiteSelectionParent.sys.mjs",
    },
    allFrames: true,
  });
} catch (error) {
  if (error.result !== Cr.NS_ERROR_DOM_NOT_SUPPORTED_ERR) {
    throw error;
  }
}

// Media capture requests originate in the content process. Firefox registers
// its WebRTC actors from the desktop browser bootstrap, which EmbedLite does
// not run, so register an EmbedLite-specific bridge here.
try {
  ChromeUtils.registerWindowActor("EmbedLiteWebRTC", {
    parent: {
      esModuleURI:
        "resource://embedlite-components/EmbedLiteWebRTCParent.sys.mjs",
    },
    child: {
      esModuleURI:
        "resource://embedlite-components/EmbedLiteWebRTCChild.sys.mjs",
    },
    allFrames: true,
  });
} catch (error) {
  if (error.result !== Cr.NS_ERROR_DOM_NOT_SUPPORTED_ERR) {
    throw error;
  }
}

try {
  ChromeUtils.registerProcessActor("EmbedLiteWebRTCProcess", {
    kind: "JSProcessActor",
    parent: {
      esModuleURI:
        "resource://embedlite-components/EmbedLiteWebRTCProcessParent.sys.mjs",
    },
    child: {
      esModuleURI:
        "resource://embedlite-components/EmbedLiteWebRTCProcessChild.sys.mjs",
      observers: [
        "getUserMedia:ask-device-permission",
        "getUserMedia:request",
        "PeerConnection:request",
        "recording-device-events",
        "recording-device-stopped",
        "recording-window-ended",
      ],
    },
  });
} catch (error) {
  if (error.result !== Cr.NS_ERROR_DOM_NOT_SUPPORTED_ERR) {
    throw error;
  }
}

// Keep the recipe manager eagerly initialized for password-manager queries.
void LoginManagerParent.recipeParentPromise;

// Common helper service

export function EmbedLiteGlobalHelper()
{
  if (typeof L10nRegistry != "undefined" && typeof L10nFileSource != "undefined") {
    L10nRegistry.getInstance().registerSources([new L10nFileSource(
      "0-mozembedlite",
      "app",
      ["en-US", "fi", "ru"],
      "chrome://browser/content/localization/{locale}/"
    )]);
  }

  Logger.debug("JSComp: EmbedLiteGlobalHelper.js loaded");
}

EmbedLiteGlobalHelper.prototype = {
  classID: Components.ID("{6322b72e-9764-11e2-8566-cbaca05819ea}"),

  observe: function (aSubject, aTopic, aData) {
    switch(aTopic) {
      // Engine DownloadManager notifications
      case "app-startup": {
        Logger.debug("EmbedLiteGlobalHelper app-startup");
        Services.obs.addObserver(this, "invalidformsubmit", false);
        Services.obs.addObserver(this, "xpcom-shutdown", false);
        Services.obs.addObserver(this, "profile-after-change", false);

        Services.ppmm.loadProcessScript(
          "chrome://global/content/process-content.js",
          true
        );
        break;
      }
      case "invalidformsubmit": {
        Logger.debug("EmbedLiteGlobalHelper invalidformsubmit");
        break;
      }
      case "profile-after-change": {
        this._migratePreferences();
        break;
      }
      case "xpcom-shutdown": {
        Logger.debug("EmbedLiteGlobalHelper xpcom-shutdown");
        Services.obs.removeObserver(this, "invalidformsubmit", false);
        Services.obs.removeObserver(this, "xpcom-shutdown", false);
        break;
      }
    }
  },

  _migratePreferences() {
    const pref = "apz.touch_start_tolerance";
    const migrated = "embedlite.prefs.touch_start_tolerance_migrated";
    // Wait for the Gecko package with the Firefox Android touch threshold.
    if (Services.prefs.getDefaultBranch("").getStringPref(pref, "") !== "0.06" ||
        Services.prefs.getBoolPref(migrated, false)) {
      return;
    }

    // WebView used to save a Qt-derived threshold on first run. Remove it
    // once per profile so Gecko's default applies; later user changes survive.
    // Old automatic and manually set values cannot be distinguished.
    Services.prefs.clearUserPref(pref);
    Services.prefs.setBoolPref(migrated, true);
    Services.prefs.savePrefFile(null);
  },

  notifyInvalidSubmit: function notifyInvalidSubmit(aFormElement, aInvalidElements) {
    Logger.warn("NOT IMPLEMENTED Invalid Form Submit, need to do something about it.");
    if (!aInvalidElements.length)
      return;
  },

  QueryInterface: ChromeUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
};
