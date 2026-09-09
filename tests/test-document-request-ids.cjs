/* This Source Code Form is subject to the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

function scope(script) {
  const context = {
    Logger: { debug() {} }, Components: {}, Ci: {},
    ChromeUtils: { generateQI: () => () => {} },
    Services: { uuid: { generateUUID: randomUUID } },
    content: { windowGlobalChild: { innerWindowId: 123 },
               addEventListener() {}, removeEventListener() {} },
    addMessageListener() {}, removeMessageListener() {},
    sendAsyncMessage() {}, addEventListener() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(`${__dirname}/../jsscripts/${script}`, "utf8"), context);
  return context;
}

// BFCache preserves the document but recreates its helper sandbox.
const before = scope("SelectAsyncHelper.js");
const oldSelect = vm.runInContext("new Dialog(false, []).id", before);
const after = scope("SelectAsyncHelper.js");
const dialog = vm.runInContext("new Dialog(false, [])", after);
assert.notEqual(dialog.id, oldSelect);
let selected = false;
dialog.onDone = () => { selected = true; };
dialog.receiveMessage({ json: { id: oldSelect, result: [] } });
assert.equal(selected, false);
dialog.receiveMessage({ json: { id: dialog.id, result: [] } });
assert.equal(selected, true);

function clipboard() {
  const helper = scope("ClipboardReadPasteHelper.js").ClipboardReadPasteHelper;
  const responses = [];
  helper._clipboardsForEvent = () => [{
    onUserReactedToPasteMenuPopup(value) { responses.push(value); },
  }];
  helper._windowForEvent = () => null;
  helper._originForPrompt = () => "https://example.org";
  helper.handleEvent({ type: "MozClipboardReadPaste", isTrusted: true,
                       stopImmediatePropagation() {} });
  return { helper, responses };
}
const oldClipboard = clipboard().helper._pendingRequestId;
const restored = clipboard();
const newClipboard = restored.helper._pendingRequestId;
assert.notEqual(newClipboard, oldClipboard);
restored.helper.receiveMessage({ name: "embedui:clipboardreadpasteresponse",
                                json: { id: oldClipboard, accepted: true } });
assert.deepEqual(restored.responses, []);
restored.helper.receiveMessage({ name: "embedui:clipboardreadpasteresponse",
                                json: { id: newClipboard, accepted: false } });
assert.deepEqual(restored.responses, [false]);
console.log("BFCache request identity tests passed");
