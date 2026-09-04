/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function(global) {

var ClipboardReadPasteHelper = global.ClipboardReadPasteHelper || {};

Object.assign(ClipboardReadPasteHelper, {
  _requestId: ClipboardReadPasteHelper._requestId || 0,
  _pendingRequestId: null,
  _pendingClipboards: null,
  _eventTarget: ClipboardReadPasteHelper._eventTarget || null,

  init: function init() {
    if (this._eventTarget) {
      this._eventTarget.removeEventListener("MozClipboardReadPaste", this, false);
    }
    removeMessageListener("embedui:clipboardreadpasteresponse", this);

    this._eventTarget = this._clipboardEventTarget();
    this._eventTarget.addEventListener("MozClipboardReadPaste", this, false);
    addMessageListener("embedui:clipboardreadpasteresponse", this);
  },

  handleEvent: function handleEvent(event) {
    if (event.type != "MozClipboardReadPaste" || !event.isTrusted) {
      return;
    }

    // EmbedLite does not load Firefox's content-side JSWindowActor bootstrap.
    // Handle the event here so Clipboard.cpp does not wait forever for the
    // upstream XUL paste popup actor.
    event.stopImmediatePropagation();

    var clipboards = this._clipboardsForEvent(event);
    if (!clipboards.length) {
      return;
    }

    if (this._pendingRequestId) {
      this._respond(false);
    }

    this._pendingRequestId = ++this._requestId;
    this._pendingClipboards = clipboards;
    sendAsyncMessage("embed:clipboardreadpaste", {
      id: this._pendingRequestId,
      delay: this._pasteDialogDelay(),
      origin: this._originForPrompt(this._windowForEvent(event))
    });
  },

  receiveMessage: function receiveMessage(message) {
    if (message.name != "embedui:clipboardreadpasteresponse") {
      return;
    }

    var data = message.json || {};
    if (!this._pendingRequestId || data.id != this._pendingRequestId) {
      return;
    }

    this._respond(!!data.accepted);
  },

  _respond: function _respond(accepted) {
    var clipboards = this._pendingClipboards || [];
    this._pendingRequestId = null;
    this._pendingClipboards = null;

    for (var i = 0; i < clipboards.length; ++i) {
      try {
        clipboards[i].onUserReactedToPasteMenuPopup(accepted);
      } catch (e) {
        Components.utils.reportError(e);
      }
    }
  },

  _clipboardsForEvent: function _clipboardsForEvent(event) {
    var clipboards = [];
    this._addClipboardForWindow(clipboards, this._windowForEvent(event));
    if (!clipboards.length) {
      this._addClipboardForWindow(clipboards, content);
    }

    return clipboards;
  },

  _windowForEvent: function _windowForEvent(event) {
    var targets = [
      event.originalTarget,
      event.explicitOriginalTarget,
      event.target,
      event.currentTarget
    ];

    for (var i = 0; i < targets.length; ++i) {
      var win = this._windowForTarget(targets[i]);
      if (win) {
        return win;
      }
    }

    return null;
  },

  _windowForTarget: function _windowForTarget(target) {
    if (!target) {
      return null;
    }

    try {
      if (target.document && target.navigator) {
        return target;
      }
    } catch (e) {}

    try {
      if (target.ownerGlobal) {
        return target.ownerGlobal;
      }
    } catch (e) {}

    try {
      if (target.defaultView) {
        return target.defaultView;
      }
    } catch (e) {}

    try {
      return target.ownerDocument && target.ownerDocument.defaultView;
    } catch (e) {}

    return null;
  },

  _addClipboardForWindow: function _addClipboardForWindow(clipboards, win) {
    if (!win) {
      return;
    }

    try {
      var clipboard = win.navigator && win.navigator.clipboard;
      if (clipboard && clipboards.indexOf(clipboard) < 0) {
        clipboards.push(clipboard);
      }
    } catch (e) {}
  },

  _clipboardEventTarget: function _clipboardEventTarget() {
    try {
      return Services.embedlite.chromeEventHandler(content) || content;
    } catch (e) {
      return content;
    }
  },

  _pasteDialogDelay: function _pasteDialogDelay() {
    try {
      return Services.prefs.getIntPref("security.dialog_enable_delay", 0);
    } catch (e) {
      return 0;
    }
  },

  _originForPrompt: function _originForPrompt(win) {
    win = win || content;

    try {
      var principal = win.document.nodePrincipal;
      return principal.originNoSuffix || principal.origin || "";
    } catch (e) {}

    try {
      return win.location.origin || "";
    } catch (e) {
      return "";
    }
  }
});

global.ClipboardReadPasteHelper = ClipboardReadPasteHelper;
ClipboardReadPasteHelper.init();
})(this);
