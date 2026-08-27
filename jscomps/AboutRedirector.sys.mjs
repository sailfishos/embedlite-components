/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
const Cc = Components.classes;
const Ci = Components.interfaces;

const { XPCOMUtils } = ChromeUtils.importESModule("resource://gre/modules/XPCOMUtils.sys.mjs");

const loggerScope = {};
Services.scriptloader.loadSubScript(
  "chrome://embedlite/content/Logger.js",
  loggerScope
);
const { Logger } = loggerScope;

let modules = {
  // about:
  "": {
    uri: "chrome://browser/content/about.xhtml",
    flags: Ci.nsIAboutModule.ALLOW_SCRIPT
  },

  certerror: {
    uri: "chrome://global/content/aboutNetError.html",
    flags: Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT |
           Ci.nsIAboutModule.URI_CAN_LOAD_IN_CHILD |
           Ci.nsIAboutModule.ALLOW_SCRIPT |
           Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT
  },

  home: {
    uri: "about:mozilla",
    flags: Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT |
           Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD
  },

  // about:fennec and about:firefox are aliases for about:,
  // but hidden from about:about
  embedlite: {
    uri: "https://wiki.mozilla.org/Embedding/IPCLiteAPI",
    flags: Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT |
           Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD,
    external: true
  }
}

export function AboutRedirector() {
  Logger.debug("JSComp: AboutRedirector.js loaded");
}
AboutRedirector.prototype = {
  QueryInterface: ChromeUtils.generateQI([Ci.nsIAboutModule]),
  classID: Components.ID("{59f3da9a-6c88-11e2-b875-33d1bd379849}"),

  _getModuleInfo: function (aURI) {
    let moduleName = aURI.pathQueryRef.replace(/[?#].*/, "").toLowerCase();
    return modules[moduleName];
  },

  // nsIAboutModule
  getURIFlags: function(aURI) {
    return this._getModuleInfo(aURI).flags;
  },

  getChromeURI: function(aURI) {
    return Services.io.newURI(this._getModuleInfo(aURI).uri);
  },

  newChannel: function(aURI, aLoadInfo) {
    let moduleInfo = this._getModuleInfo(aURI);

    let pageURI = this.getChromeURI(aURI);
    var channel = Services.io.newChannelFromURIWithLoadInfo(pageURI, aLoadInfo);

    if (moduleInfo.external) {
      aLoadInfo.resultPrincipalURI = pageURI;
    }

    channel.originalURI = aURI;

    return channel;
  }
};
