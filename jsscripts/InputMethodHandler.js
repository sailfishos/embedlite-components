/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2021 Open Mobile Platform LLC.
 */

"use strict";

var gInputMethodHandler = null;

function debug(msg) {
  Logger.debug("InputMethodHandler.js -", msg);
}

/**
  * InputMethodHandler
  *
  * Provides surrounding text, cursor and anchor position of editable
  * element for predictive input.
  */
InputMethodHandler.prototype = {
  QueryInterface: ChromeUtils.generateQI([Ci.nsIObserver,
                                          Ci.nsISupportsWeakReference,
                                          Ci.nsISelectionListener]),

  // Weak-ref used to keep track of the currently focused element.
  _currentFocusedElement: null,

  _init: function() {
    Logger.debug("JSScript: InputMethodHandler.js loaded");
    addEventListener("focus", this, true);
    addEventListener("blur", this, true);
    addEventListener("input", this, false);
  },

  get focusedElement() {
    return this._currentFocusedElement && this._currentFocusedElement.get();
  },

  notifySelectionChanged: function(doc, sel, reason) {
    this._sendInputContext(this.focusedElement);
  },

  handleEvent: function(aEvent) {
    switch (aEvent.type) {
      case "focus": {
        let currentElement = aEvent.target;
        if (this._isTextInput(currentElement)) {
          this._sendInputAttributes(currentElement);
          try {
            this._currentFocusedElement = Cu.getWeakReference(currentElement);
            if (this._isInputContextAvailable(currentElement)) {
              let selection = currentElement.editor.selectionController
                              .getSelection(Ci.nsISelectionController.SELECTION_NORMAL);
              selection.addSelectionListener(this);
            }
          } catch (e) {
            Logger.warn("InputMethodHandler: adding selection listener failed", e);
          }
        }
        break;
      }

      case "blur": {
        let focused = this.focusedElement;
        if (focused) {
          if (this._isInputContextAvailable(focused)) {
            try {
              let selection = focused.editor.selectionController
                              .getSelection(Ci.nsISelectionController.SELECTION_NORMAL);
              selection.removeSelectionListener(this);
              this._resetInputContext(focused);
            } catch (e) {
              Logger.warn("InputMethodHandler: removing selection listener failed", e);
            }
          }
          this._resetInputAttributes(focused);
        }
        this._currentFocusedElement = null;
        break;
      }

      case "input": {
        let currentElement = aEvent.target;
        if (currentElement !== this.focusedElement) {
          break;
        }
        this._sendInputContext(currentElement);
        break;
      }
    }
  },

  _sendInputContext: function(aElement) {
    if (!this._isInputContextAvailable(aElement) || aElement !== this.focusedElement) {
      return;
    }

    try {
      let cursorPosition = aElement.selectionStart;
      let anchorPosition = aElement.selectionEnd;
      if (cursorPosition === null) {
        // The email and number input types have no selection API, but their
        // editor still has a selection, and the input method needs the cursor.
        let selection = aElement.editor.selection;
        cursorPosition = this._valueOffset(aElement, selection.focusNode, selection.focusOffset);
        anchorPosition = this._valueOffset(aElement, selection.anchorNode, selection.anchorOffset);
      }
      sendAsyncMessage("InputMethodHandler:SetInputContext",
                       {surroundingText: aElement.value,
                        cursorPosition: cursorPosition,
                        anchorPosition: anchorPosition});
    } catch (e) {
      Logger.warn("InputMethodHandler: sending async message failed", e);
    }
  },

  // A single-line editor keeps its value in one text node; any other
  // selection node is the editor root, before or after that text.
  _valueOffset: function(aElement, aNode, aOffset) {
    if (aNode && aNode.nodeType === aNode.TEXT_NODE) {
      return aOffset;
    }
    return aOffset > 0 ? aElement.value.length : 0;
  },

  _resetInputContext: function(aElement) {
    try {
      sendAsyncMessage("InputMethodHandler:ResetInputContext", []);
    } catch (e) {
      Logger.warn("InputMethodHandler: sending async message failed", e);
    }
  },

  _sendInputAttributes: function(aElement) {
    try {
      sendAsyncMessage("InputMethodHandler:SetInputAttributes",
                       {autocomplete: aElement.getAttribute("autocomplete"),
                        autocapitalize: aElement.getAttribute("autocapitalize")});
    } catch (e) {
      Logger.warn("InputMethodHandler: sending async message failed", e);
    }
  },

  _resetInputAttributes: function(aElement) {
    try {
      sendAsyncMessage("InputMethodHandler:ResetInputAttributes", []);
    } catch (e) {
      Logger.warn("InputMethodHandler: sending async message failed", e);
    }
  },

  _isTextInput: function(aElement) {
    return (Util.isEditable(aElement) && aElement.editor) &&
           !aElement.readOnly &&
           !this._isDisabledElement(aElement);
  },

  _isInputContextAvailable: function(aElement) {
    return this._isTextInput(aElement) &&
           (aElement.type !== "password");
  },

  _isDisabledElement: function(aElement) {
    let currentElement = aElement;
    while (currentElement) {
      if (currentElement.disabled) {
        return true;
      }
      currentElement = currentElement.parentElement;
    }
    return false;
  },

};

function InputMethodHandler() {
  this._init();
}

gInputMethodHandler = new InputMethodHandler();
