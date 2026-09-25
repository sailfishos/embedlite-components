/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * IntentProtocolHandler.js
 */

"use strict";

const {classes: Cc, interfaces: Ci, results: Cr} = Components;

export function IntentProtocolHandler() {
}

IntentProtocolHandler.prototype = {

  scheme: "intent",
  newChannel: function(aURI, aLoadInfo) {
    const ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
    const spec = aURI.spec;
    if (!aURI.schemeIs("intent")) {
      throw Cr.NS_ERROR_MALFORMED_URI;
    }

    let target = spec.slice(spec.indexOf(":") + 1);
    let scheme;
    let fallback;
    const marker = target.indexOf("#Intent;");
    if (marker !== -1) {
      // Empty fields allow trailing or repeated semicolon separators.
      const fields = target.slice(marker + "#Intent;".length).split(";").filter(Boolean);
      if (fields.pop() !== "end") {
        throw Cr.NS_ERROR_MALFORMED_URI;
      }
      target = target.slice(0, marker);
      let hasScheme = false;
      for (const field of fields) {
        // No fields may follow end; selectors describe a different intent.
        if (field === "end" || field === "SEL") {
          throw Cr.NS_ERROR_MALFORMED_URI;
        }
        if (field.startsWith("scheme=")) {
          if (hasScheme) {
            throw Cr.NS_ERROR_MALFORMED_URI;
          }
          scheme = field.slice("scheme=".length);
          hasScheme = true;
        } else if (field.startsWith("S.browser_fallback_url=")) {
          if (fallback !== undefined) {
            throw Cr.NS_ERROR_MALFORMED_URI;
          }
          try {
            fallback = decodeURIComponent(field.slice("S.browser_fallback_url=".length));
          } catch (error) {
            throw Cr.NS_ERROR_MALFORMED_URI;
          }
        }
      }
    }

    // We cannot launch an Android activity. Prefer its explicit web fallback,
    // otherwise require an explicitly supplied HTTP(S) scheme.
    if (fallback === undefined && scheme === undefined) {
      throw Cr.NS_ERROR_UNKNOWN_PROTOCOL;
    }
    target = fallback !== undefined ? fallback : scheme + ":" + target;
    if (!/^https?:\/\//i.test(target)) {
      throw Cr.NS_ERROR_UNKNOWN_PROTOCOL;
    }
    const uri = ioService.newURI(target);
    if ((!uri.schemeIs("http") && !uri.schemeIs("https")) || !uri.asciiHost) {
      throw Cr.NS_ERROR_MALFORMED_URI;
    }
    const channel = ioService.newChannelFromURIWithLoadInfo(uri, aLoadInfo);
    aLoadInfo.resultPrincipalURI = uri;
    return channel;
  },

  allowPort: function(aPort, aScheme) {
    return false;
  },

  classID: Components.ID("{878c8294-b764-48fd-87be-7d5e7a44faa9}"),
  QueryInterface: ChromeUtils.generateQI([Ci.nsIProtocolHandler])
};
