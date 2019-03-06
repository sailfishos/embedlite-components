/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

const APP_STARTUP         = "app-startup"
const VIEW_CREATED        = "embedliteviewcreated";
const XPCOM_SHUTDOWN      = "xpcom-shutdown";
const PREF_OVERRIDE       = "general.useragent.override";

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

// Common helper service

function UserAgentOverrideHelper()
{
}

UserAgentOverrideHelper.prototype = {
  classID: Components.ID("{69d68654-b5a0-11e2-bb91-2b8ad5eb98ac}"),

  observe: function (aSubject, aTopic, aData) {
    switch(aTopic) {
      // Engine DownloadManager notifications
      case APP_STARTUP: {
        dump("UserAgentOverrideHelper app-startup\n");
        Services.obs.addObserver(this, VIEW_CREATED, true);
        Services.obs.addObserver(this, XPCOM_SHUTDOWN, false);
        Services.prefs.addObserver(PREF_OVERRIDE, this, false);
        // Do not initialize UserAgent here because then UserAgentOverrides.jsm
        // will receive desktop ua as a default user agent <= initialized too ealy.
        // If initialized too early regular expression based user agent overrides will
        // not work.
        break;
      }
      case "nsPref:changed": {
        if (aData == PREF_OVERRIDE) {
          UserAgent.init();
        }
        break;
      }
      case VIEW_CREATED: {
        UserAgent.init();
        break;
      }

      case XPCOM_SHUTDOWN: {
        dump("UserAgentOverrideHelper " + XPCOM_SHUTDOWN + "\n");
        Services.obs.removeObserver(this, XPCOM_SHUTDOWN, false);
        UserAgent.uninit();
        break;
      }
      default:
        break;
    }
  },

  // From nsISiteSpecificUserAgent
  getUserAgentForURIAndWindow: function ssua_getUserAgentForURIAndWindow(aURI, aWindow) {
    return UserAgent.getUserAgentForWindow(aURI)
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsISiteSpecificUserAgent, Ci.nsIObserver,
                                         Ci.nsISupportsWeakReference, Ci.nsIFormSubmitObserver])
};

var UserAgent = {
  _desktopMode: false,
  _customUA: null,
  overrideMap: new Map,
  initilized: false,
  DESKTOP_UA: null,
  GOOGLE_DOMAIN: /(^|\.)google\.com$/,
  GOOGLE_MAPS_DOMAIN: /(^|\.)maps\.google\.com$/,
  YOUTUBE_DOMAIN: /(^|\.)youtube\.com$/,
  NOKIA_HERE_DOMAIN: /(^|\.)here\.com$/,

  init: function ua_init() {
    if (this.initilized) {
      return
    }

    Services.obs.addObserver(this, "DesktopMode:Change", false);
    Services.prefs.addObserver(PREF_OVERRIDE, this, false);
    this._customUA = this.getCustomUserAgent();
    Cu.import("resource://gre/modules/UserAgentOverrides.jsm");
    UserAgentOverrides.init();
    UserAgentOverrides.addComplexOverride(this.onRequest.bind(this));
    // See https://developer.mozilla.org/en/Gecko_user_agent_string_reference
    this.DESKTOP_UA = Cc["@mozilla.org/network/protocol;1?name=http"]
                        .getService(Ci.nsIHttpProtocolHandler).userAgent
                        .replace(/Android; [a-zA-Z]+/, "X11; Linux x86_64")
                        .replace(/Gecko\/[0-9\.]+/, "Gecko/20100101");
    this.initilized = true;
  },

  getCustomUserAgent: function() {
    if (Services.prefs.prefHasUserValue(PREF_OVERRIDE)) {
      let ua = Services.prefs.getCharPref(PREF_OVERRIDE);
      return ua;
    } else {
      return null;
    }
  },

  getDefaultUserAgent : function ua_getDefaultUserAgent() {
    // Send desktop UA if "Request Desktop Site" is enabled.
    if (this._desktopMode)
      return this.DESKTOP_UA;

    return this._customUA ? this._customUA : this.DESKTOP_UA;
  },

  getUserAgentForUriAndTab: function ua_getUserAgentForUriAndTab(aUri) {
    // Not all schemes have a host member.
    if (aUri && (aUri.schemeIs("http") || aUri.schemeIs("https"))) {
      let ua = this.getDefaultUserAgent();
      if (this.GOOGLE_DOMAIN.test(aUri.host)) {
        if (this.GOOGLE_MAPS_DOMAIN.test(aUri.host)) {
            return ua.replace("X11", "Android").replace("Linux", "Android");
        }

        // Send the phone UA to google
        if (!ua.contains("Mobile")) {
          return ua.replace("X11", "Android").replace("Unix", "Android").replace("Linux", "Mobile");
        }
      } else if (this.YOUTUBE_DOMAIN.test(aUri.host)) {
        // Send the phone UA to google
        if (!ua.contains("Safari")) {
          ua = ua + " like Safari/538.1";
        }
        if (!ua.contains("Android")) {
          // Nexus 7 Android chrome has best capabilities
          return ua.replace("Linux", "Android 4.4.2").replace("Unix", "Android 4.4.2").replace("Mobile", "");
        }
      } else if (this.NOKIA_HERE_DOMAIN.test(aUri.host)) {
        // Send the phone UA to here
        if (!ua.contains("Mobile")) {
          return ua.replace("X11", "Android").replace("Unix", "Android").replace("Linux", "Mobile");
        }
      }
    }

    return "";
  },

  uninit: function ua_uninit() {
    Services.obs.removeObserver(this, "DesktopMode:Change");
    Services.prefs.removeObserver(PREF_OVERRIDE, this);
    UserAgentOverrides.uninit();
  },

  // Complex override calls this first.
  onRequest: function(channel, defaultUA) {
    let ua = "";
    let uri = channel.URI;

    // Prefer current uri over the loading principal's uri in case both have overrides.
    ua = uri && UserAgentOverrides.getOverrideForURI(uri)

    if (ua) {
      return ua
    } else {
      let loadInfo = channel.loadInfo;
      let loadingPrincipalURI = loadInfo && loadInfo.loadingPrincipal && loadInfo.loadingPrincipal.URI;
      if (loadingPrincipalURI && loadingPrincipalURI.asciiHost) {
        uri = loadingPrincipalURI;
      }
    }

    return this.getUserAgentForWindow(uri);
  },

  getUserAgentForWindow: function ua_getUserAgentForWindow(aUri, aWindow) {
    // Try to pick 'general.useragent.override.*'
    let ua = null;

    if (aUri) {
      ua = UserAgentOverrides.getOverrideForURI(aUri);
    }

    if (ua) {
      return ua;
    } else if (aUri) {
      ua = this.getUserAgentForUriAndTab(aUri);
    }

    if (ua) {
      return ua
    }

    return this.getDefaultUserAgent();
  },

  observe: function ua_observe(aSubject, aTopic, aData) {
    switch (aTopic) {
      case "DesktopMode:Change": {
        //let args = JSON.parse(aData);
        //dump("UserAgentOverrideHelper observe:" + aTopic + "\n");
        break;
      }
      case "nsPref:changed": {
        if (aData == PREF_OVERRIDE) {
          this._customUA = this.getCustomUserAgent();
        }
        break;
      }
    }
  }
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([UserAgentOverrideHelper]);
