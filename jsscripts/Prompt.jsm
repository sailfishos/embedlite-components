/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict"

var Cc = Components.classes;
var Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyServiceGetter(Services, "embedlite",
                                    "@mozilla.org/embedlite-app-service;1",
                                    "nsIEmbedAppService");

Services.scriptloader.loadSubScript("chrome://embedlite/content/Logger.js");

this.EXPORTED_SYMBOLS = ["Prompt"];

function log(msg) {
  Services.console.logStringMessage(msg);
}

function Prompt(aOptions) {
  this.window = "window" in aOptions ? aOptions.window : null;

  this.msg = {
    async: true,
    winId: Services.embedlite.getIDByWindow(this.window)
  };

  if (aOptions.priority === 1)
    this.msg.type = "Prompt:ShowTop"
  else
    this.msg.type = "Prompt:Show"

  if ("title" in aOptions && aOptions.title != null)
    this.msg.title = aOptions.title;

  if ("message" in aOptions && aOptions.message != null)
    this.msg.text = aOptions.message;

  if ("buttons" in aOptions && aOptions.buttons != null)
    this.msg.buttons = aOptions.buttons;

  if ("doubleTapButton" in aOptions && aOptions.doubleTapButton != null)
    this.msg.doubleTapButton = aOptions.doubleTapButton;

  if ("hint" in aOptions && aOptions.hint != null)
    this.msg.hint = aOptions.hint;
}

Prompt.prototype = {
  QueryInterface: ChromeUtils.generateQI([Ci.nsIEmbedMessageListener]),
  onMessageReceived: function(messageName, message) {
    let data = JSON.parse(message);

    if (this.callback) {
      this.callback(data)
    }

    Services.embedlite.removeMessageListener(this.getResponseName(), this);
  },

  setHint: function(aHint) {
    if (!aHint)
      delete this.msg.hint;
    else
      this.msg.hint = aHint;
    return this;
  },

  addHiddenValue: function(aKey, aValue) {
    this.msg[aKey] = aValue;
  },

  setPrivateBrowsing: function(aPrivateBrowsing) {
    if (!aPrivateBrowsing)
      delete this.msg.privateBrowsing;
    else
      this.msg.privateBrowsing = aPrivateBrowsing;
    return this;
  },

  getMessageName: function() {
    let hint = this.msg && this.msg.hint

    if (!hint)
      Logger.warn("Prompt.jsm is doomed to fail without a hint");

    return "embed:" + hint;
  },

  getResponseName: function() {
    let hint = this.msg && this.msg.hint;

    if (!hint)
      Logger.warn("Prompt.jsm is doomed to fail without a hint (for response)");

    return hint + "response";
  },

  addButton: function(aOptions) {
    if (!this.msg.buttons)
      this.msg.buttons = [];
    this.msg.buttons.push(aOptions.label);
    return this;
  },

  _addInput: function(aOptions) {
    let obj = aOptions;
    if (this[aOptions.type + "_count"] === undefined)
      this[aOptions.type + "_count"] = 0;

    obj.id = aOptions.id || (aOptions.type + this[aOptions.type + "_count"]);
    this[aOptions.type + "_count"]++;

    if (!this.msg.inputs)
      this.msg.inputs = [];
    this.msg.inputs.push(obj);
    return this;
  },

  addCheckbox: function(aOptions) {
    return this._addInput({
      type: "checkbox",
      label: aOptions.label,
      hint: aOptions.hint,
      checked: aOptions.checked,
      id: aOptions.id
    });
  },

  addTextbox: function(aOptions) {
    return this._addInput({
      type: "textbox",
      value: aOptions.value,
      hint: aOptions.hint,
      autofocus: aOptions.autofocus,
      id: aOptions.id
    });
  },

  addNumber: function(aOptions) {
    return this._addInput({
      type: "number",
      value: aOptions.value,
      hint: aOptions.hint,
      autofocus: aOptions.autofocus,
      id: aOptions.id
    });
  },

  addPassword: function(aOptions) {
    return this._addInput({
      type: "password",
      value: aOptions.value,
      hint: aOptions.hint,
      autofocus: aOptions.autofocus,
      id : aOptions.id
    });
  },

  addDatePicker: function(aOptions) {
    return this._addInput({
      type: aOptions.type || "date",
      value: aOptions.value,
      id: aOptions.id,
      max: aOptions.max,
      min: aOptions.min
    });
  },

  addColorPicker: function(aOptions) {
    return this._addInput({
      type: "color",
      value: aOptions.value,
      id: aOptions.id
    });
  },

  addLabel: function(aOptions) {
    return this._addInput({
      type: "label",
      label: aOptions.label,
      id: aOptions.id
    });
  },

  addMenulist: function(aOptions) {
    return this._addInput({
      type: "menulist",
      values: aOptions.values,
      id: aOptions.id
    });
  },

  addIconGrid: function(aOptions) {
    return this._addInput({
      type: "icongrid",
      items: aOptions.items,
      id: aOptions.id
    });
  },

  addTabs: function(aOptions) {
    return this._addInput({
      type: "tabs",
      items: aOptions.items,
      id: aOptions.id
    });
  },

  show: function(callback) {
    this.callback = callback;
    log("Sending message");
    this._innerShow();
  },

  _innerShow: function() {
    Services.embedlite.addMessageListener(this.getResponseName(), this);
    try {
      Services.embedlite.sendAsyncMessage(this.msg.winId, this.getMessageName(), JSON.stringify(this.msg));
    } catch (e) {
      Logger.warn("Prompt: sending async message failed", e)
    }
  },

  _setListItems: function(aItems) {
    let hasSelected = false;
    this.msg.listitems = [];

    aItems.forEach(function(item) {
      let obj = { id: item.id };

      obj.label = item.label;

      if (item.disabled)
        obj.disabled = true;

      if (item.selected) {
        if (!this.msg.choiceMode) {
          this.msg.choiceMode = "single";
        }
        obj.selected = item.selected;
      }

      if (item.header)
        obj.isGroup = true;

      if (item.menu)
        obj.isParent = true;

      if (item.child)
        obj.inGroup = true;

      if (item.showAsActions)
        obj.showAsActions = item.showAsActions;

      if (item.icon)
        obj.icon = item.icon;

      this.msg.listitems.push(obj);

    }, this);
    return this;
  },

  setSingleChoiceItems: function(aItems) {
    return this._setListItems(aItems);
  },

  setMultiChoiceItems: function(aItems) {
    this.msg.choiceMode = "multiple";
    return this._setListItems(aItems);
  },

}
