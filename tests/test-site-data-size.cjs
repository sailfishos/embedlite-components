/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Run with node tests/test-site-data-size.cjs (or embedding/embedlite/tests/...).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const modules = ["../jscomps", "../components/modules"]
  .map(dir => path.join(__dirname, dir)).find(dir => fs.existsSync(dir));
const extension = fs.existsSync(path.join(modules, "PrivateDataManager.js"))
  ? ".js" : ".sys.mjs";
const source = fs.readFileSync(path.join(modules, "PrivateDataManager" + extension), "utf8");
const pending = [];
let calls = 0;
let queryError;
const logger = { debug() {} };
const services = {
  scriptloader: { loadSubScript(url, scope) { if (scope) scope.Logger = logger; } },
  qms: { getUsage(callback) {
    calls++;
    if (queryError) throw queryError;
    pending.push(callback);
  } }
};
const scope = {
  Components: { classes: {}, interfaces: {}, results: { NS_OK: 0 }, ID: value => value },
  Cr: { NS_OK: 0 }, Logger: logger, Services: services,
  ChromeUtils: {
    import() { return { Services: services }; },
    importESModule() { return { ComponentUtils: {}, XPCOMUtils: {} }; },
    generateQI() { return () => {}; }
  }
};
vm.createContext(scope);
vm.runInContext(source.replace(/^export /gm, "") +
  "\nglobalThis.Manager = PrivateDataManager;", scope);

function complete(usages, resultCode = 0) {
  // Gecko invokes this callback independently of the manager object.
  pending.shift().call({}, { resultCode, result: usages.map(usage => ({ usage })) });
}

(async () => {
  const manager = new scope.Manager();
  const first = manager.siteDataSizePromise;
  assert.equal(manager.siteDataSizePromise, first, "Coalesce outstanding queries");
  assert.equal(calls, 1);
  complete([100, 23]);
  assert.equal(await first, 123);

  const refreshed = manager.siteDataSizePromise;
  assert.notEqual(refreshed, first);
  assert.equal(calls, 2, "Re-query storage after the previous result");
  complete([9]);
  assert.equal(await refreshed, 9, "Report changed usage after clearing site data");

  const failed = manager.siteDataSizePromise;
  complete([], 1);
  assert.equal(await failed, 0, "Preserve the existing failed-result behavior");
  const afterFailure = manager.siteDataSizePromise;
  complete([42]);
  assert.equal(await afterFailure, 42, "A failed result must not stay cached");

  queryError = new Error("Quota service unavailable");
  const rejected = manager.siteDataSizePromise;
  await assert.rejects(rejected, error => error === queryError);
  queryError = undefined;
  const retry = manager.siteDataSizePromise;
  complete([7]);
  assert.equal(await retry, 7, "Retry after a synchronous service error");

  const other = new scope.Manager();
  const one = manager.siteDataSizePromise;
  const two = other.siteDataSizePromise;
  assert.notEqual(one, two, "Keep managers independent");
  complete([]);
  complete([11]);
  assert.equal(await one, 0);
  assert.equal(await two, 11);
  assert.equal(pending.length, 0);
  console.log("Site-data size tests passed: coalescing, refresh, failures, retry and isolation");
})().catch(error => { console.error(error); process.exitCode = 1; });
