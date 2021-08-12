/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2020 Open Mobile Platform LLC.
 */

"use strict";

// For the Android variant see gecko-dev/mobile/android/modules/NetErrorHelper.jsm

const Ci = Components.interfaces;
const Cu = Components.utils;

const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

Services.scriptloader.loadSubScript("chrome://embedlite/content/Logger.js");

var EXPORTED_SYMBOLS = ["NetErrorHelper"];

const KEY_CODE_ENTER = 13;

/* Handlers is a list of objects that will be notified when an error page is shown
 * or when an event occurs on the page that they are registered to handle. Registration
 * is done by just adding yourself to the dictionary.
 *
 * handlers.myKey = {
 *   onPageShown: function(browser) { },
 *   handleEvent: function(event) { },
 * }
 *
 * The key that you register yourself with should match the ID of the element you want to
 * watch for click events on.
 */

var handlers = {};

function NetErrorHelper(browser) {
  browser.addEventListener("click", this.handleClick, true);

  let listener = () => {
    browser.removeEventListener("click", this.handleClick, true);
    browser.removeEventListener("pagehide", listener, true);
  };
  browser.addEventListener("pagehide", listener, true);

  // Handlers may want to customize the page
  for (let id in handlers) {
    if (handlers[id].onPageShown) {
      handlers[id].onPageShown(browser);
    }
  }
}

NetErrorHelper.attachToBrowser = function(browser) {
  Logger.debug("JSComp: NetErrorHelper.jsm attached");
  return new NetErrorHelper(browser);
};

NetErrorHelper.prototype = {
  handleClick: function(event) {
    let node = event.target;

    while (node) {
      if (node.id in handlers && handlers[node.id].handleClick) {
        handlers[node.id].handleClick(event);
        return;
      }

      node = node.parentNode;
    }
  },
};

handlers.searchbutton = {
  _docShell: null,

  onPageShown: function(browser) {
    this._docShell = browser.docShell;
    let doc = this._docShell.getInterface(Ci.nsIDOMDocument);

    let search = doc.querySelector("#searchbox");
    if (!search) {
      return;
    }

    let browserWin = Services.wm.getMostRecentWindow("navigator:browser");
    // If there is no stored userRequested, just hide the searchbox
    if (!browser.userRequested) {
      search.style.display = "none";
    } else {
      let text = doc.querySelector("#searchtext");
      text.value = browser.userRequested;
      text.addEventListener("keypress", (event) => {
        if (event.keyCode === KEY_CODE_ENTER) {
          this.doSearch(event.target.value);
        }
      });
    }
  },

  handleClick: function(event) {
    let value = event.target.previousElementSibling.value;
    this.doSearch(value);
  },

  doSearch: function(value) {
    let engine = Services.search.defaultEngine;
    let uri = engine.getSubmission(value).uri;

    // Reset the user search to whatever the new search term was
    this._docShell.loadURI(uri.spec, Ci.nsIWebNavigation.LOAD_FLAGS_NONE, null, null, null);
  },
};

handlers.wifi = {
  // This registers itself with the nsIObserverService as a weak ref,
  // so we have to implement GetWeakReference as well
  QueryInterface: ChromeUtils.generateQI([Ci.nsIObserver,
                                          Ci.nsISupportsWeakReference]),

  _docShell: null,

  GetWeakReference: function() {
    return Cu.getWeakReference(this);
  },

  onPageShown: function(browser) {
    // If we have a connection, don't bother showing the wifi toggle
    this._docShell = browser.docShell;
    let doc = this._docShell.getInterface(Ci.nsIDOMDocument);

    if (!Services.io.offline) {
      // We're online, so hide the Wifi connection button
      let nodes = doc.querySelectorAll("#wifi");
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].style.display = "none";
      }
    }
  },

  handleClick: function(event) {
    let node = event.target;
    while (node && node.id !== "wifi") {
      node = node.parentNode;
    }

    if (!node) {
      return;
    }

    // Show indeterminate progress while we wait for the network
    node.disabled = true;
    node.classList.add("inProgress");

    if (!Services.io.offline) {
      node.ownerDocument.location.reload(false);
    } else {
      this.node = Cu.getWeakReference(node);
      Services.obs.addObserver(this, "network:link-status-changed", true);
      Services.obs.notifyObservers(null, "network-enable", null);
    }
  },

  observe: function(subject, topic, data) {
    let node = this.node.get();
    if (!node) {
      return;
    }

    // Remove the progress bar
    node.disabled = false;
    node.classList.remove("inProgress");

    if (!Services.io.offline) {
      // If everything worked, reload the page
      Services.obs.removeObserver(this, "network:link-status-changed");

      // Even at this point there may be a delay for the network to come fully up
      // so add a delay before refreshing the page to avoid the load failing
      node.ownerGlobal.setTimeout(function() {
        node.ownerDocument.location.reload(false);
      }, 1000);
    }
  }
};

