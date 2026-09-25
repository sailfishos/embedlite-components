/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Run with node tests/test-date-picker-routing.cjs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let source = fs.readFileSync(
  path.join(__dirname, "../jscomps/EmbedLiteDateTimePickerParent.sys.mjs"),
  "utf8"
);
source = source
  .replace(/^import .*DateTimePickerParent\.sys\.mjs";\n/m, "")
  .replace(
    "export class DateTimePickerParent",
    "globalThis.DateTimePickerParent = class DateTimePickerParent"
  );

let listener;
const requests = [];
const removedListeners = [];
const service = {
  getIDByBrowsingContext(context) {
    return context.winId;
  },
  addMessageListener(name, value) {
    assert.equal(name, "embedui:datepickerresponse");
    listener = value;
  },
  removeMessageListener(name, value) {
    assert.equal(name, "embedui:datepickerresponse");
    removedListeners.push(value);
    if (listener === value) {
      listener = null;
    }
  },
  sendAsyncMessage(winId, name, json) {
    requests.push({ winId, name, data: JSON.parse(json) });
  },
};

class GeckoDateTimePickerParent {
  constructor() {
    this.browsingContext = { canOpenModalPicker: true, winId: 42 };
    this.messages = [];
  }

  receiveMessage(message) {
    this.fallbackMessage = message;
  }

  showPicker(data) {
    this.fallbackPicker = data;
  }

  close() {
    this.fallbackClosed = true;
  }

  sendAsyncMessage(name, data) {
    this.messages.push({ name, data });
  }
}

const scope = {
  GeckoDateTimePickerParent,
  Components: {
    classes: {
      "@mozilla.org/embedlite-app-service;1": {
        getService() {
          return service;
        },
      },
    },
    interfaces: { nsIEmbedAppService: {} },
  },
  ChromeUtils: { generateQI() { return function() {}; } },
  console: { error() {}, warn() {} },
};
vm.createContext(scope);
vm.runInContext(source, scope);

const DAY = 24 * 60 * 60 * 1000;
const dateValue = Date.UTC(2026, 8, 17);
const actor = new scope.DateTimePickerParent();
actor.showPicker({
  type: "date",
  detail: {
    value: { year: 2026, month: 9, day: 17 },
    min: dateValue - DAY,
    max: dateValue + DAY,
    step: DAY,
    stepBase: 0,
  },
});

assert.equal(requests.length, 1);
assert.equal(requests[0].winId, 42);
assert.equal(requests[0].name, "embed:datepicker");
assert.deepEqual(requests[0].data.value, { year: 2026, month: 9, day: 17 });
assert.equal(requests[0].data.min, dateValue - DAY);
const requestId = requests[0].data.id;
assert.ok(listener, "Response listener must be installed before sending");

listener.onMessageReceived(
  "embedui:datepickerresponse",
  JSON.stringify({
    winId: 9,
    id: requestId,
    accepted: true,
    year: 2026,
    month: 9,
    day: 17,
  })
);
assert.equal(actor.messages.length, 0, "Another window's response is ignored");

listener.onMessageReceived(
  "embedui:datepickerresponse",
  JSON.stringify({
    winId: 42,
    id: requestId,
    accepted: true,
    year: 2026,
    month: 9,
    day: 17,
  })
);
assert.deepEqual(JSON.parse(JSON.stringify(actor.messages)), [
  {
    name: "InputPicker:ValueChanged",
    data: { year: 2026, month: 9, day: 17 },
  },
  { name: "InputPicker:Closed", data: {} },
]);
assert.equal(listener, null);
assert.equal(removedListeners.length, 1);

const invalidActor = new scope.DateTimePickerParent();
invalidActor.showPicker({
  type: "date",
  detail: { min: dateValue, max: dateValue, step: DAY, stepBase: 0 },
});
const invalidRequestId = requests[1].data.id;
listener.onMessageReceived(
  "embedui:datepickerresponse",
  JSON.stringify({
    winId: 42,
    id: invalidRequestId,
    accepted: true,
    year: 2026,
    month: 9,
    day: 18,
  })
);
assert.deepEqual(JSON.parse(JSON.stringify(invalidActor.messages)), [
  { name: "InputPicker:Closed", data: {} },
]);

const cancelledActor = new scope.DateTimePickerParent();
cancelledActor.showPicker({ type: "date", detail: {} });
const cancelledRequestId = requests[2].data.id;
cancelledActor.receiveMessage({ name: "InputPicker:Close" });
assert.equal(listener, null);
assert.equal(cancelledActor.messages.length, 0);
assert.deepEqual(requests[3], {
  winId: 42,
  name: "embed:datepickerabort",
  data: { winId: 42, id: cancelledRequestId },
});

const timeActor = new scope.DateTimePickerParent();
const timeRequest = { type: "time", detail: {} };
timeActor.showPicker(timeRequest);
assert.equal(timeActor.fallbackPicker, timeRequest);

console.log("Date picker routing tests passed");
