/* Copyright (c) 2026 Jolla Mobile Ltd
 * SPDX-License-Identifier: MPL-2.0 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname,
  '../jscomps/EmbedLitePromptParent.sys.mjs'), 'utf8');
const listeners = new Map();
const messages = [];
const service = {
  getIDByBrowsingContext: () => 42,
  addMessageListener(topic, listener) { listeners.set(topic, listener); },
  removeMessageListener(topic, listener) {
    if (listeners.get(topic) === listener) listeners.delete(topic);
  },
  sendAsyncMessage(winId, topic, data) { messages.push({ topic, ...JSON.parse(data) }); },
};
const context = vm.createContext({
  console,
  Components: { classes: { '@mozilla.org/embedlite-app-service;1': {
    getService: () => service,
  } }, interfaces: {} },
  ChromeUtils: { generateQI() {} },
  JSWindowActorParent: class {
    constructor() { this.windowContext = { isActiveInTab: true }; this.browsingContext = {}; }
  },
});
vm.runInContext(source.replace('export class PromptParent',
  'globalThis.PromptParent = class PromptParent'), context);
const tick = () => new Promise(setImmediate);
const open = actor => actor.receiveMessage({ name: 'Prompt:Open',
  data: { promptType: 'confirm', text: 'Proceed?' } });
const respond = data => listeners.get('confirmresponse').onMessageReceived(
  'confirmresponse', JSON.stringify(data));
(async () => {
  const first = new context.PromptParent();
  const firstResult = open(first);
  await tick();
  const a = messages.at(-1);
  first.didDestroy();
  assert.equal((await firstResult).promptAborted, true);
  assert.equal(messages.at(-1).topic, 'embed:promptabort');
  assert.equal(messages.at(-1).promptId, a.promptId);
  const second = new context.PromptParent();
  let resolved = false;
  const secondResult = open(second).then(result => { resolved = true; return result; });
  await tick();
  const b = messages.at(-1);
  assert.notEqual(a.promptId, b.promptId);
  respond({ winId: a.winId, promptId: a.promptId, accepted: true });
  respond({ winId: b.winId, accepted: true });
  respond({ winId: 99, promptId: b.promptId, accepted: true });
  await tick();
  assert.equal(resolved, false, 'stale, missing-id and wrong-tab replies must be ignored');
  respond({ winId: b.winId, promptId: b.promptId, accepted: false });
  assert.equal((await secondResult).ok, false);
  assert.equal(listeners.size, 0);
  // Queue serialization must survive destruction of an actor that has not opened yet.
  const third = new context.PromptParent();
  const fourth = new context.PromptParent();
  const thirdResult = open(third);
  const fourthResult = open(fourth);
  await tick();
  const c = messages.at(-1);
  fourth.didDestroy();
  respond({ winId: c.winId, promptId: c.promptId, accepted: true });
  assert.equal((await thirdResult).ok, true);
  assert.equal((await fourthResult).promptAborted, true);
  assert.equal(messages.at(-1), c, 'destroyed queued actors must not display a dialog');
  console.log('Prompt routing: stale replies, teardown, current reply and serialization passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
