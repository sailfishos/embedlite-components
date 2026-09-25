/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Run with node tests/test-intent-protocol.cjs (or embedding/embedlite/tests/...).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const modules = ["../jscomps", "../components/modules"]
  .map(dir => path.join(__dirname, dir)).find(dir => fs.existsSync(dir));
const extension = fs.existsSync(path.join(modules, "IntentProtocolHandler.js"))
  ? ".js" : ".sys.mjs";
const source = fs.readFileSync(path.join(modules, "IntentProtocolHandler" + extension), "utf8");
const helper = fs.readFileSync(path.join(modules, "EmbedLiteGlobalHelper" + extension), "utf8");
const malformed = "NS_ERROR_MALFORMED_URI";
const unsupported = "NS_ERROR_UNKNOWN_PROTOCOL";
const contract = "@mozilla.org/network/protocol;1?name=intent";
const flags = 64;
let channels = [];

function webURI(spec) {
  const parsed = new URL(spec);
  return {
    spec: parsed.href,
    asciiHost: parsed.hostname,
    schemeIs: scheme => parsed.protocol === scheme + ":"
  };
}

const io = {
  newURI: webURI,
  newChannelFromURIWithLoadInfo(uri, loadInfo) {
    const channel = { URI: uri, loadInfo };
    channels.push(channel);
    return channel;
  }
};
const Ci = { nsIProtocolHandler: { URI_LOADABLE_BY_ANYONE: flags }, nsIIOService: {} };
const scope = {
  Components: {
    classes: { "@mozilla.org/network/io-service;1": { getService() { return io; } } },
    interfaces: Ci,
    results: { NS_ERROR_MALFORMED_URI: malformed, NS_ERROR_UNKNOWN_PROTOCOL: unsupported },
    ID: value => value
  },
  ChromeUtils: {
    generateQI() { return () => {}; },
    importESModule() { return { ComponentUtils: {} }; }
  }
};
vm.createContext(scope);
vm.runInContext(source.replace(/^export /gm, "") +
  "\nglobalThis.handler = new IntentProtocolHandler();", scope);
const handler = scope.handler;
const inputURI = spec => ({ spec, schemeIs: scheme => spec.split(":")[0].toLowerCase() === scheme });

const successes = [
  ["intent://example.com/path#Intent;;scheme=https;;;end", "https://example.com/path"],
  ["intent://scan/#Intent;scheme=zxing;S.browser_fallback_url=https%3A%2F%2Fexample.com%2F%3Fa%3D1%3Bb%3D2;end",
    "https://example.com/?a=1;b=2"],
  // Reported maps.google.com redirect: use Google's explicit web fallback.
  ["intent://www.google.com/maps?entry=ml&utm_campaign=ml-ardi&coh=230964#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=https%3A%2F%2Fwww.google.com%2Fmaps%3Fentry%3Dml%26utm_campaign%3Dml-ardi%26coh%3D230964;end",
    "https://www.google.com/maps?entry=ml&utm_campaign=ml-ardi&coh=230964"],
  ["intent://maps.google.com/#Intent;S.browser_fallback_url=https%3A%2F%2Fwww.google.com%2Fmaps;end",
    "https://www.google.com/maps"],
  ["INTENT://www.google.com/maps?q=Paris#Intent;scheme=https;end", "https://www.google.com/maps?q=Paris"],
  ["intent://www.google.com/maps?q=48.8%2C2.3#Intent;scheme=https;package=com.google.android.apps.maps;end",
    "https://www.google.com/maps?q=48.8%2C2.3"],
  ["intent://example.com/path#Intent;scheme=http;end", "http://example.com/path"],
  ["intent://scan/#Intent;scheme=zxing;S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fmaps%3Fq%3Da%2520b%23route;end",
    "https://example.com/maps?q=a%20b#route"],
  ["intent://maps.google.com/#Intent;scheme=https;S.browser_fallback_url=https%3A%2F%2Fwww.google.com%2Fmaps%3Fforce%3Dweb;end",
    "https://www.google.com/maps?force=web"],
  ["intent://scan/#Intent;scheme=zxing;S.browser_fallback_url=http%3A%2F%2Fexample.com%2F;end", "http://example.com/"]
];
// Delimiter tokens must not change the target; Maps emits a final semicolon.
for (const [spec, expected] of [...successes]) {
  if (spec.endsWith(";end")) {
    successes.push([spec + ";", expected], [spec + ";;", expected]);
  }
}
for (const [spec, expected] of successes) {
  channels = [];
  const principal = {};
  const loadInfo = { triggeringPrincipal: principal, originAttributes: { privateBrowsingId: 1 }, resultPrincipalURI: {} };
  const channel = handler.newChannel(inputURI(spec), loadInfo);
  assert.equal(channel.URI.spec, expected, spec);
  assert.equal(channel, channels[0]);
  assert.equal(channels.length, 1);
  assert.equal(channel.loadInfo, loadInfo, "Keep the caller's security and private browsing context");
  assert.equal(loadInfo.triggeringPrincipal, principal);
  assert.equal(loadInfo.resultPrincipalURI, channel.URI, "Use the resulting website's principal");
}

const failures = [
  ["intent://example.com/#Intent;scheme=https;ending;", malformed],
  ["intent://example.com/#Intent;scheme=https;end;end;", malformed],
  ["intent://example.com/#Intent;scheme=https;end;package=app;end;", malformed],
  ["intent://maps.google.com/maps?q=Paris", unsupported],
  ["intent://maps.google.com/maps#Intent;package=com.google.android.apps.maps;end", unsupported],
  ["https://example.com/", malformed],
  ["intent://example.com/#Intent;scheme=https", malformed],
  ["intent://example.com/#Intent;scheme=https;end;extra", malformed],
  ["intent://example.com/#Intent;scheme=https;scheme=http;end", malformed],
  ["intent://example.com/#Intent;scheme=https;SEL;scheme=file;end", malformed],
  ["intent://example.com/#Intent;S.browser_fallback_url=%zz;end", malformed],
  ["intent://example.com/#Intent;S.browser_fallback_url=https%3A%2F%2Fa.test;S.browser_fallback_url=https%3A%2F%2Fb.test;end", malformed],
  ["intent://scan/#Intent;scheme=zxing;end", unsupported],
  ["intent:///etc/passwd#Intent;scheme=file;end", unsupported],
  ["intent:alert(1)#Intent;scheme=javascript;end", unsupported],
  ["intent://example.com/#Intent;S.browser_fallback_url=javascript%3Aalert(1);end", unsupported],
  ["intent://example.com/#Intent;S.browser_fallback_url=file%3A%2F%2F%2Fetc%2Fpasswd;end", unsupported],
  ["intent://example.com/#Intent;S.browser_fallback_url=intent%3A%2F%2Fexample.com%2F;end", unsupported],
  ["intent://example.com/#Intent;S.browser_fallback_url=%2Frelative;end", unsupported],
  ["intent://example.com/#Intent;S.browser_fallback_url=;end", unsupported]
];
for (const [spec, error] of failures) {
  channels = [];
  assert.throws(() => handler.newChannel(inputURI(spec), {}), value => value === error, spec);
  assert.equal(channels.length, 0, "Reject unsupported targets before creating a channel");
}
assert.equal(handler.allowPort(25, "intent"), false);

// Exercise the actual startup observer and the process script it schedules.
const observer = helper.slice(helper.indexOf("  observe: function"), helper.indexOf("  _migratePreferences()"));
const scripts = [];
const startup = {
  Logger: { debug() {} },
  encodeURIComponent,
  Services: {
    obs: { addObserver() {} },
    ppmm: { loadProcessScript(url, delayed) { scripts.push({ url, delayed }); } }
  }
};
vm.createContext(startup);
vm.runInContext("globalThis.helper = {" + observer + "};", startup);
startup.helper.observe(null, "app-startup", null);
const registration = scripts.find(script => script.url.startsWith("data:"));
assert.ok(registration, "Register the protocol during EmbedLite startup");
assert.equal(registration.delayed, true, "Also register in future content processes");
const code = decodeURIComponent(registration.url.slice(registration.url.indexOf(",") + 1));
for (const process of ["parent", "existing content", "future content"]) {
  const registered = new Map();
  vm.runInNewContext(code, {
    Cc: { [contract]: { createInstance(type) { assert.equal(type, Ci.nsIProtocolHandler); return handler; } } },
    Ci,
    Services: { io: { registerProtocolHandler(scheme, instance, protocolFlags, port) {
      assert.equal(protocolFlags, flags);
      assert.equal(port, -1);
      registered.set(scheme, instance);
    } } }
  });
  assert.equal(registered.get("intent"), handler, process);
}
console.log(`Intent protocol: ${successes.length} valid URLs, ${failures.length} rejected URLs, startup registration passed`);
