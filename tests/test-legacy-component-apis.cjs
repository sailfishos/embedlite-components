/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Run with node tests/test-legacy-component-apis.cjs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(name, additions, exported) {
  const services = additions.Services;
  services.scriptloader = { loadSubScript() {} };
  const scope = {
    Components: {
      classes: additions.Cc || {}, interfaces: additions.Ci || {}, results: {},
      ID: value => value, isSuccessCode: code => code === 0
    },
    Logger: { debug() {}, warn(...args) { throw new Error(args.join(" ")); } },
    ChromeUtils: {
      import() { return { Services: services }; },
      importESModule() { return {
        ComponentUtils: {}, XPCOMUtils: { defineLazyServiceGetter() {} },
        PrivateBrowsingUtils: { isWindowPrivate: win => win.isPrivate }
      }; },
      defineESModuleGetters() {},
      generateQI() { return () => {}; }
    },
    ...additions
  };
  vm.createContext(scope);
  const source = fs.readFileSync(path.join(__dirname, "../jscomps", name + ".js"), "utf8");
  vm.runInContext(source + `\nglobalThis.testObject = ${exported};`, scope);
  return scope.testObject;
}

let fetches = [];
const messages = [];
const document = { documentURIObject: {
  prePath: "https://example.com", schemeIs: scheme => scheme === "https"
}, nodePrincipal: { originAttributes: { privateBrowsingId: 1 } } };
const window = { document };
const progress = load("EmbedLiteFaviconService", {
  Ci: {
    nsILoadInfo: { SEC_ALLOW_CROSS_ORIGIN_INHERITS_SEC_CONTEXT: 4, SEC_DISALLOW_SCRIPT: 32 },
    nsIContentPolicy: { TYPE_INTERNAL_IMAGE_FAVICON: 41 }
  },
  Services: { embedlite: {
    getIDByWindow: win => { assert.equal(win, window); return 123; },
    sendAsyncMessage: (...args) => messages.push(args)
  } },
  NetUtil: { asyncFetch(options, callback) {
    // ESR115 NetUtil requires an options object with an explicit load context.
    assert.equal(typeof options, "object");
    assert.equal(options.uri, "https://example.com/favicon.ico");
    assert.equal(options.loadingNode, document, "Retain the document's private/security context");
    assert.equal(options.loadUsingSystemPrincipal, undefined);
    assert.equal(options.securityFlags, 36);
    assert.equal(options.contentPolicyType, 41);
    fetches.push(callback);
  } }
}, "gProgressListener");

for (const [status, contentType, expected] of [[0, "image/x-icon", 1], [1, "image/x-icon", 0], [0, "text/html", 0]]) {
  messages.length = 0;
  progress.onLocationChange({ DOMWindow: window });
  fetches.shift()(null, status, { contentType });
  assert.equal(messages.length, expected);
  if (expected) {
    assert.deepEqual(messages[0], [123, "embed:faviconURL", JSON.stringify({url: "https://example.com/favicon.ico"})]);
  }
}
progress.onLocationChange({ DOMWindow: { document: { documentURIObject: { schemeIs: () => false } } } });
assert.equal(fetches.length, 0, "Do not fetch favicons for non-web documents");

const overrides = [];
const certHandler = load("EmbedLiteErrorPageHandler", {
  Cc: { "@mozilla.org/security/certoverride;1": { getService() { return {
    rememberValidityOverride(...args) { overrides.push(args); }
  }; } } },
  Services: {}
}, "ErrorPageEventHandler");
for (const privateMode of [false, true]) {
  for (const button of ["temporaryExceptionButton", "permanentExceptionButton"]) {
    let reloads = 0;
    const attrs = { privateBrowsingId: privateMode ? 1 : 0, userContextId: 7 };
    const cert = {};
    const securityInfo = {
      serverCert: cert, QueryInterface() { return this; },
      get isUntrusted() { throw new Error("Removed security-info field accessed"); },
      get isDomainMismatch() { throw new Error("Removed security-info field accessed"); },
      get isNotValidAtThisTime() { throw new Error("Removed security-info field accessed"); }
    };
    certHandler._docShell = { failedChannel: {
      URI: { asciiHost: "failed.example.com", port: 8443 }, securityInfo,
      loadInfo: { originAttributes: attrs }
    } };
    const buttons = {};
    const errorDoc = {
      documentURI: "about:certerror?e=nssBadCert",
      location: { href: "about:certerror?e=nssBadCert", reload() { reloads++; } },
      defaultView: { isPrivate: privateMode },
      getElementById: id => buttons[id]
    };
    for (const id of ["temporaryExceptionButton", "permanentExceptionButton", "exceptionDialogButton"]) {
      buttons[id] = { ownerDocument: errorDoc };
    }
    const before = overrides.length;
    certHandler.handleEvent({type: "click", isTrusted: false, originalTarget: buttons[button]});
    assert.equal(overrides.length, before, "Ignore synthetic clicks");
    certHandler.handleEvent({type: "click", isTrusted: true, originalTarget: buttons.exceptionDialogButton});
    assert.equal(overrides.length, before, "Leave the modern exception button to Gecko");
    certHandler.handleEvent({type: "click", isTrusted: true, originalTarget: buttons[button]});
    assert.deepEqual(overrides.at(-1), ["failed.example.com", 8443, attrs, cert,
      privateMode || button === "temporaryExceptionButton"], "Pass exactly five arguments with the correct temporary flag");
    assert.equal(reloads, 1);
  }
}
console.log("Legacy component API tests passed: favicon context/results and certificate exception lifetime");
