/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Run with node tests/test-touch-threshold-migration.cjs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname,
  "../jscomps/EmbedLiteGlobalHelper.sys.mjs"), "utf8")
  .replace("export function EmbedLiteGlobalHelper", "function EmbedLiteGlobalHelper");
const threshold = "apz.touch_start_tolerance";

function startProfile(defaultValue, savedPrefs) {
  const prefs = new Map(savedPrefs);
  let persisted = new Map(savedPrefs);
  let saves = 0;
  const observers = new Map();
  const scope = {
    Components: { classes: {}, interfaces: {}, results: {}, ID: value => value },
    ChromeUtils: {
      importESModule() { return { LoginManagerParent: {} }; },
      registerWindowActor() {},
      generateQI() { return () => {}; }
    },
    Services: {
      scriptloader: { loadSubScript(url, target) { target.Logger = { debug() {} }; } },
      ppmm: { loadProcessScript() {} },
      obs: { addObserver(observer, topic) { observers.set(topic, observer); } },
      prefs: {
        getDefaultBranch() {
          return { getStringPref(key, fallback) {
            assert.equal(key, threshold);
            return defaultValue ?? fallback;
          } };
        },
        getBoolPref(key, fallback) { return prefs.get(key) ?? fallback; },
        clearUserPref(key) { prefs.delete(key); },
        setBoolPref(key, value) { prefs.set(key, value); },
        savePrefFile(file) {
          assert.equal(file, null);
          persisted = new Map(prefs);
          saves++;
        }
      }
    }
  };
  vm.createContext(scope);
  vm.runInContext(source + "\nglobalThis.helper = EmbedLiteGlobalHelper.prototype;", scope);
  scope.helper.observe(null, "app-startup", null);
  assert.equal(prefs.get(threshold), new Map(savedPrefs).get(threshold),
    "Do not migrate until profile preferences have loaded");
  observers.get("profile-after-change").observe(null, "profile-after-change", null);
  return { prefs, persisted, saves };
}

const oldProfile = new Map([[threshold, "0.0789357"], ["unrelated.preference", 42]]);
for (const oldDefault of [undefined, "0.1"]) {
  const deferred = startProfile(oldDefault, oldProfile);
  assert.deepEqual(deferred.prefs, oldProfile, "Wait for the new Gecko default");
  assert.equal(deferred.saves, 0);
}

const migrated = startProfile("0.06", oldProfile);
assert.equal(migrated.persisted.has(threshold), false, "Use Gecko's default");
assert.equal(migrated.persisted.get("unrelated.preference"), 42);
assert.equal(migrated.saves, 1, "Persist the migration in this profile");

// A later user choice must survive both restarts and future default changes.
migrated.persisted.set(threshold, "0.08");
for (const nextDefault of ["0.06", "0.05"]) {
  const restarted = startProfile(nextDefault, migrated.persisted);
  assert.equal(restarted.prefs.get(threshold), "0.08");
  assert.equal(restarted.saves, 0);
}

const fresh = startProfile("0.06", []);
assert.equal(fresh.persisted.has(threshold), false, "Fresh profiles inherit the default");
fresh.persisted.set(threshold, "0.04");
assert.equal(startProfile("0.06", fresh.persisted).prefs.get(threshold), "0.04");
assert.equal(startProfile("0.06", oldProfile).saves, 1,
  "Another application's profile is migrated independently");
console.log("Touch threshold migration tests passed");
