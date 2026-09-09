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
