/* Copyright (c) 2026 Jolla Mobile Ltd
 * SPDX-License-Identifier: MPL-2.0 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,
  '../jscomps/HelperAppDialog.sys.mjs'), 'utf8');
const observers = new Set(), messages = [], completed = [];
const contexts = new Map([[7, { winId: 42 }], [8, { winId: 0 }]]);
let useDownloadDir = false, request = 0;
const scope = vm.createContext({
  Components: { classes: {}, interfaces: {}, utils: {}, results: {}, ID() {} },
  ChromeUtils: {
    importESModule() { return { XPCOMUtils: { defineLazyServiceGetter() {} } }; },
    generateQI() {},
  },
  Logger: { debug() {}, warn() {} },
  BrowsingContext: { get: id => contexts.get(id) },
  Services: {
    scriptloader: { loadSubScript() {} },
    obs: { addObserver: value => observers.add(value), removeObserver: value => observers.delete(value) },
    prefs: { getBoolPref: () => useDownloadDir, getStringPref: () => '/downloads' },
    uuid: { generateUUID: () => String(++request) },
    ww: { get activeWindow() { assert.fail('Must not route to the foreground window'); } },
    embedlite: {
      getIDByWindow() { assert.fail('Dialog parent is not the source tab'); },
      getIDByBrowsingContext: context => context.winId,
      sendAsyncMessage(winId, topic, json) { messages.push({ winId, topic, data: JSON.parse(json) }); },
    },
  },
});
vm.runInContext(source.replace('export function', 'function'), scope);
function open(id, force = true) {
  const dialog = new scope.HelperAppLauncherDialog();
  const launcher = { browsingContextId: id,
    saveDestinationAvailable(file, shown) { completed.push({ file, shown }); } };
  dialog.promptForSaveToFileAsync(launcher, null, 'file.txt', '.txt', force);
  return dialog;
}
const dialog = open(7);
assert.equal(messages.length, 1);
assert.equal(messages[0].winId, 42);
assert.equal(messages[0].data.winId, 42);
assert.ok(observers.has(dialog));
const responses = [];
dialog.saveAndDownload = data => responses.push(data);
const reply = { ...messages[0].data, cancelled: true };
for (const data of [{ ...reply, winId: 99 }, { ...reply, requestId: 'stale' }]) {
  dialog.observe(null, 'embedui:downloadpicker', JSON.stringify(data));
}
assert.equal(responses.length, 0);
dialog.observe(null, 'embedui:downloadpicker', JSON.stringify(reply));
assert.equal(responses.length, 1);
dialog.finishDownloadPicker(null, true);
assert.equal(observers.size, 0);
for (const id of [0, 8, 99]) {
  const unroutable = open(id);
  assert.equal(unroutable.mLauncher, null);
  assert.equal(observers.size, 0);
  assert.deepEqual(completed.at(-1), { file: null, shown: true });
}
assert.equal(messages.length, 1, 'Missing or stale source must not open another tab picker');
useDownloadDir = true;
const automatic = new scope.HelperAppLauncherDialog();
let saved;
automatic.saveAndDownload = data => { saved = data; automatic.finishDownloadPicker(null, false); };
automatic.promptForSaveToFileAsync({ browsingContextId: 0,
  saveDestinationAvailable() {} }, null, 'automatic.txt', '.txt', false);
assert.equal(saved.downloadDirectory, '/downloads');
assert.equal(messages.length, 1);
assert.equal(observers.size, 0);
console.log('Download picker source routing, stale replies, cancellation and automatic path passed');
