/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const Ci = Components.interfaces;

const loggerScope = {};
Services.scriptloader.loadSubScript(
  "chrome://embedlite/content/Logger.js",
  loggerScope
);
const { Logger } = loggerScope;

export function EmbedLiteChromeManager()
{
  Logger.debug("JSComp: EmbedLiteChromeManager.js loaded");
}

EmbedLiteChromeManager.prototype = {
  classID: Components.ID("{9d17cd12-da27-4f4c-957c-f355910ac2e9}"),

  observe(aSubject, aTopic, aData) {
    switch (aTopic) {
    case "app-startup":
      Services.obs.addObserver(this, "embed-network-link-status", true);
      Services.obs.addObserver(this, "xpcom-shutdown", false);
      break;
    case "embed-network-link-status": {
      let network;
      try {
        network = JSON.parse(aData);
      } catch (error) {
        Logger.warn("Invalid EmbedLite network status", error);
        return;
      }
      Services.io.manageOfflineStatus = true;
      Services.io.offline = !!network.offline;
      Services.obs.notifyObservers(
        null, "network:link-status-changed",
        network.offline ? "down" : "up");
      break;
    }
    case "xpcom-shutdown":
      Services.obs.removeObserver(this, "embed-network-link-status");
      Services.obs.removeObserver(this, "xpcom-shutdown");
      break;
    }
  },

  QueryInterface: ChromeUtils.generateQI([
    Ci.nsIObserver,
    Ci.nsISupportsWeakReference,
  ]),
};
