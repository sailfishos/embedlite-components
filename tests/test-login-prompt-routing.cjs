/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Run with node tests/test-login-prompt-routing.cjs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname,
  "../jscomps/LoginManagerPrompter.sys.mjs"), "utf8");
const method = source.match(/  _showLoginNotification\(aBrowser,[\s\S]*?\n  },/);
assert.ok(method, "Production notification method must be present");

const sent = [];
let warnings = 0;
const scope = {
  Services: { embedlite: {
    addMessageListener() {},
    getIDByBrowsingContext(context) {
      assert.equal(context.window, null, "Remote contexts have no DOM window");
      return context.endpoint;
    },
    getIDByWindow(window) {
      if (!window) throw new Error("No prompt window");
      return window.endpoint;
    },
    sendAsyncMessage(endpoint, name, json) {
      sent.push({ endpoint, name, data: JSON.parse(json) });
    }
  } },
  Logger: { warn() { warnings++; } }
};
vm.createContext(scope);
vm.runInContext(`globalThis.prompter = {
  log() {}, _getRandomId() { return String(++this.serial); },
  serial: 0, _pendingRequests: {}, ${method[0]}
};`, scope);

for (const [endpoint, name] of [[17, "password-save"], [23, "password-change"]]) {
  const buttons = [{ label: "Save" }];
  scope.prompter._showLoginNotification({
    ownerDocument: {}, browsingContext: { window: null, endpoint }
  }, name, ["Prompt"], buttons, { displayHost: "example.org" });
  const message = sent[sent.length - 1];
  assert.equal(message.endpoint, endpoint);
  assert.equal(message.name, "embed:login");
  assert.equal(message.data.name, name);
  assert.equal(scope.prompter._pendingRequests[message.data.id], buttons);
}

// HTTP-auth callers pass a chrome DOM window which also has a browsingContext.
scope.prompter._showLoginNotification({
  browsingContext: {}, top: { endpoint: 31 }
}, "password-save", [], [], {});
assert.equal(sent[2].endpoint, 31);
assert.equal(warnings, 0);

scope.prompter._showLoginNotification(null, "password-save", [], [], {});
assert.equal(sent.length, 3, "Missing origins must not target another tab");
assert.equal(warnings, 1);
console.log("Login prompt routing tests passed");


// HTTP authentication must stay attached to a remote background tab even
// when the chrome window belongs to a different selected tab.
const authMethod = source.match(/  _promptAuth\([^\n]*\) \{[\s\S]*?\n  },/);
assert.ok(authMethod);
async function testAuthRouting() {
  const listeners = new Set();
  const authSent = [];
  const authScope = {
    ChromeUtils: { generateQI() { return () => {}; } },
    Ci: { nsIAuthInformation: { ONLY_PASSWORD: 1 } },
    Services: { embedlite: {
      getIDByBrowsingContext(context) {
        if (!context || !context.endpoint) throw new Error("No source endpoint");
        return context.endpoint;
      },
      getIDByWindow() { assert.fail("Auth must not target the selected chrome tab"); },
      addMessageListener(name, listener) { listeners.add(listener); },
      removeMessageListener(name, listener) { listeners.delete(listener); },
      sendAsyncMessage(endpoint, name, json) { authSent.push({ endpoint, name, data: JSON.parse(json) }); }
    } }
  };
  vm.createContext(authScope);
  vm.runInContext(`globalThis.prompter = {
    _getPromptBrowsingContext() { return this.context; },
    _chromeWindow: { endpoint: 99 },
    _getAuthMessage() { return "Password"; },
    _GetAuthInfo() { return ["user", ""]; },
    _SetAuthInfo(info, user, password) { info.username = user; info.password = password; },
    warn() {}, ${authMethod[0]}
  };`, authScope);
  authScope.prompter.context = { window: null, endpoint: 17 };
  const info = { flags: 0 };
  const pending = authScope.prompter._promptAuth({}, 0, info, "", {});
  assert.equal(authSent.length, 1);
  assert.equal(authSent[0].endpoint, 17);
  assert.equal(authSent[0].data.winId, 17);
  for (const listener of [...listeners]) {
    listener.onMessageReceived("authresponse", JSON.stringify({ winId: 17, accepted: true, password: "test" }));
  }
  assert.equal(await pending, true);
  assert.equal(info.password, "test");
  assert.equal(listeners.size, 0);
  for (const context of [null, { window: null }]) {
    authScope.prompter.context = context;
    assert.equal(await authScope.prompter._promptAuth({}, 0, { flags: 0 }, "", {}), false);
  }
  assert.equal(authSent.length, 1);
  console.log("Background HTTP-auth routing tests passed");
}
testAuthRouting().catch(error => { console.error(error); process.exitCode = 1; });
