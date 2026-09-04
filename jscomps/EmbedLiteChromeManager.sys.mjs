/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2020 Open Mobile Platform LLC.
 */

"use strict";

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

const { XPCOMUtils } = ChromeUtils.importESModule("resource://gre/modules/XPCOMUtils.sys.mjs");
const { ContentLinkHandler } = ChromeUtils.importESModule(
  "chrome://embedlite/content/ContentLinkHandler.sys.mjs"
);
const { NetErrorHelper } = ChromeUtils.importESModule(
  "chrome://embedlite/content/NetErrorHelper.sys.mjs"
);

XPCOMUtils.defineLazyServiceGetter(Services, "embedlite",
                                    "@mozilla.org/embedlite-app-service;1",
                                    Ci.nsIEmbedAppService);

const loggerScope = {};
Services.scriptloader.loadSubScript(
  "chrome://embedlite/content/Logger.js",
  loggerScope
);
const { Logger } = loggerScope;

function EmbedLiteChromeListener(aWindow)
{

  this.windowId = Services.embedlite.getIDByWindow(aWindow);
  // Services.embedlite.getContentWindowByID will return the same as aWindow
  this.targetDOMWindow = aWindow;
  this.docShell = aWindow.docShell;
  this.blockedPopups = {};
  this.nextBlockedPopupId = 0;
  ContentLinkHandler.init(this);
}

EmbedLiteChromeListener.prototype = {
  targetDOMWindow: null,
  docShell: null,
  windowId: -1,
  userRequested: "",
  blockedPopups: null,
  nextBlockedPopupId: 0,

  // -------------------------------------------------------------------------
  // Added call through function to mimic chrome and satisfy ContentLinkHandler
  addEventListener(eventType, callback, options) {
    let chromeEventHandler = Services.embedlite.chromeEventHandler(this.targetDOMWindow);
    chromeEventHandler.addEventListener(eventType, callback, options);
  },

  removeEventListener(eventType, callback, options) {
    let chromeEventHandler = Services.embedlite.chromeEventHandler(this.targetDOMWindow);
    chromeEventHandler.removeEventListener(eventType, callback, options);
  },

  sendAsyncMessage(messageName, message) {
    try {
      Services.embedlite.sendAsyncMessage(this.windowId, messageName, JSON.stringify(message));
    } catch (e) {
      Logger.warn("EmbedLiteChromeListener: sending async message failed", e)
    }
  },

  get content() {
    return this.targetDOMWindow
  },
  // -------------------------------------------------------------------------

  handleEvent(event) {
    let window = this.targetDOMWindow;

    var messageName;
    var message = {}

    switch (event.type) {
    case "DOMMetaAdded":
      messageName = "chrome:metaadded"
      break;
    case "DOMContentLoaded":
      let doc = this.docShell.contentViewer.DOMDocument;
      var docURI = doc && doc.documentURI || "";
      if (!docURI.startsWith("about:blank")) {
        messageName = "chrome:contentloaded";
        message["docuri"] = docURI;
      }

      if (docURI.startsWith("about:neterror")) {
        NetErrorHelper.attachToBrowser(this);
      }
      break;
    case "DOMWillOpenModalDialog":
    case "DOMModalDialogClosed":
    case "DOMWindowClose":
      messageName = "chrome:winopenclose";
      message["type"] = event.type;
      break;
    case "DOMPopupBlocked":
      let requestingWindow = event.requestingWindow || this.targetDOMWindow;
      let requestingDocument = requestingWindow && requestingWindow.document;
      let requestingPrincipal = requestingDocument && requestingDocument.nodePrincipal;
      if (requestingPrincipal) {
        let permissions = Services.perms.getAllForPrincipal(requestingPrincipal);
        for (let permission of permissions) {
          if (permission.type == "popup" && permission.capability == Ci.nsIPermissionManager.DENY_ACTION) {
            // Ignore popup
            return;
          }
        }
      }

      let popupUriSpec = event.popupWindowURI ? event.popupWindowURI.spec : "about:blank";
      let popupId = ++this.nextBlockedPopupId;
      this.blockedPopups[popupId] = {
        "requestingWindow": requestingWindow,
        "requestingDocument": requestingDocument,
        "popupWindowURISpec": popupUriSpec,
        "popupWindowName": event.popupWindowName || "",
        "popupWindowFeatures": event.popupWindowFeatures || ""
      };

      messageName = "embed:popupblocked";
      message["host"] = requestingDocument && requestingDocument.documentURIObject
                      ? requestingDocument.documentURIObject.displaySpec
                      : popupUriSpec;
      message["popupUri"] = popupUriSpec;
      message["popupId"] = popupId;
      message["winId"] = this.windowId;
      break;
    }

    if (messageName) {
      this.sendAsyncMessage(messageName, message);
    }
  },

  unblockPopup(popupId) {
    let popup = this.blockedPopups[popupId];
    delete this.blockedPopups[popupId];

    if (!popup || !popup.requestingWindow) {
      return;
    }

    try {
      if (popup.requestingWindow.document == popup.requestingDocument) {
        popup.requestingWindow.open(
          popup.popupWindowURISpec,
          popup.popupWindowName,
          popup.popupWindowFeatures);
      }
    } catch (e) {
      Logger.warn("EmbedLiteChromeListener: opening blocked popup failed", e);
    }
  },

  removeBlockedPopup(popupId) {
    delete this.blockedPopups[popupId];
  },

  QueryInterface: ChromeUtils.generateQI([Ci.nsIDOMEventListener,
                                          Ci.nsISupportsWeakReference])
};

export function EmbedLiteChromeManager()
{
  Logger.debug("JSComp: EmbedLiteChromeManager.js loaded");
}

EmbedLiteChromeManager.prototype = {
  classID: Components.ID("{9d17cd12-da27-4f4c-957c-f355910ac2e9}"),
  _chromeListeners: {},
  _lastCreatedWindowId: 0,

  _initialize() {
    // Use "embedliteviewcreated" instead of "domwindowopened".
    Services.obs.addObserver(this, "embedliteviewcreated", true);
    Services.obs.addObserver(this, "embed-network-link-status", true)
    Services.obs.addObserver(this, "domwindowclosed", true);
    Services.obs.addObserver(this, "keyword-uri-fixup", true);
    Services.obs.addObserver(this, "embedui:popupblocked", true);
  },

  onPopupBlockedResponse(message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      Logger.warn("EmbedLiteChromeManager: popup response parsing failed", e);
      return;
    }

    if (!data || data.popupId === undefined || data.winId === undefined) {
      return;
    }

    let listener = this._chromeListeners[data.winId];
    if (!listener) {
      return;
    }

    if (data.allow) {
      listener.unblockPopup(data.popupId);
    } else {
      listener.removeBlockedPopup(data.popupId);
    }
  },

  onWindowOpen(aWindow) {
    // Listener creates ContentLinkHandler.jsm which handles link element parsing.
    let chromeListener = new EmbedLiteChromeListener(aWindow);
    this._chromeListeners[chromeListener.windowId] = chromeListener;
    this._lastCreatedWindowId = chromeListener.windowId;
    let chromeEventHandler = Services.embedlite.chromeEventHandler(aWindow);
    if (chromeEventHandler) {
      chromeEventHandler.addEventListener("DOMContentLoaded", chromeListener, false);
      chromeEventHandler.addEventListener("DOMWillOpenModalDialog", chromeListener, false);
      chromeEventHandler.addEventListener("DOMModalDialogClosed", chromeListener, false);
      chromeEventHandler.addEventListener("DOMWindowClose", chromeListener, false);
      chromeEventHandler.addEventListener("DOMMetaAdded", chromeListener, false);
      chromeEventHandler.addEventListener("DOMPopupBlocked", chromeListener, false);
    } else {
      Logger.warn("Something went wrong, could not get chrome event handler for window", aWindow, "id:", chromeListener.windowId, "when opening a window")
    }
  },

  onWindowClosed(aWindow) {
    let chromeEventHandler = Services.embedlite.chromeEventHandler(aWindow);
    let windowId = Services.embedlite.getIDByWindow(aWindow);
    let chromeListener = this._chromeListeners[windowId];
    if (chromeEventHandler && chromeListener) {
      chromeEventHandler.removeEventListener("DOMContentLoaded", chromeListener, false);
      chromeEventHandler.removeEventListener("DOMWillOpenModalDialog", chromeListener, false);
      chromeEventHandler.removeEventListener("DOMModalDialogClosed", chromeListener, false);
      chromeEventHandler.removeEventListener("DOMWindowClose", chromeListener, false);
      chromeEventHandler.removeEventListener("DOMMetaAdded", chromeListener, false);
      chromeEventHandler.removeEventListener("DOMPopupBlocked", chromeListener, false);
    } else {
      Logger.warn("Something went wrong, could not get chrome event handler/listener for window", aWindow, "id:", windowId, "when closing a window")
    }
    if (this._lastCreatedWindowId === windowId) {
      this._lastCreatedWindowId = 0;
    }
    delete this._chromeListeners[windowId];
  },

  observe(aSubject, aTopic, aData) {
    let self = this;
    switch (aTopic) {
    case "embedui:popupblocked":
      self.onPopupBlockedResponse(aData);
      break;
    case "keyword-uri-fixup":
      var windowId = this._lastCreatedWindowId;
      try {
        windowId = Services.embedlite.getIDByWindow(Services.ww.activeWindow);
      } catch (e) {
        // Do nothing
      }
      if (windowId) {
        this._chromeListeners[windowId].userRequested = aData;
      } else {
        Logger.warn("JSComp: EmbedLiteChromeManager.js no window to store request against");
      }
      break;
    case "app-startup":
      self._initialize();
      break;
    case "embedliteviewcreated":
      self.onWindowOpen(aSubject);
      break;
    case "domwindowclosed":
      self.onWindowClosed(aSubject);
      break;
    case "embed-network-link-status":
      let network = JSON.parse(aData);
      Services.io.manageOfflineStatus = true;
      Services.io.offline = network.offline;
      Services.obs.notifyObservers(null, "network:link-status-changed",
                                   network.offline ? "down" : "up");
    default:
      Logger.debug("EmbedLiteChromeManager subject", aSubject, "topic:", aTopic);
    }
  },

  QueryInterface: ChromeUtils.generateQI([Ci.nsIObserver,
                                          Ci.nsISupportsWeakReference])
};
