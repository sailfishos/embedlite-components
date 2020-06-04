/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2020 Open Mobile Platform LLC.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyServiceGetter(Services, 'env',
                                  '@mozilla.org/process/environment;1',
                                  'nsIEnvironment');

Services.scriptloader.loadSubScript("chrome://embedlite/content/Logger.js");

// Common helper service

function SPConsoleListener() {
  this._cacheLogs = true;

  Logger.debug("JSComp: EmbedLiteConsoleListener.js loaded");
}

SPConsoleListener.prototype = {
  _cacheLogs: true,
  _startupCachedLogs: [],
  observe: function(msg) {
    if (Logger.enabled) {
      Logger.debug("CONSOLE message:");
      Logger.debug(msg);
    } else {
      if (this._cacheLogs) {
        this._startupCachedLogs.push(msg);
      } else {
        Services.obs.notifyObservers(null, "embed:logger", JSON.stringify({ multiple: false, log: msg }));
      }
    }
  },
  clearCache: function() {
      this._cacheLogs = false;
      this._startupCachedLogs = null;
  },

  flushCache: function() {
    if (this._cacheLogs) {
      this._cacheLogs = false;
      Services.obs.notifyObservers(null, "embed:logger", JSON.stringify({ multiple: true, log: this._startupCachedLogs }));
      this._startupCachedLogs = null;
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIConsoleListener])
};

function EmbedLiteConsoleListener()
{
}

EmbedLiteConsoleListener.prototype = {
  classID: Components.ID("{6b21b5a8-9816-11e2-86f8-fb54170a814d}"),
  _listener: null,

  formatStackFrame: function(aFrame) {
    let functionName = aFrame.functionName || '<anonymous>';
    return '    at ' + functionName +
           ' (' + aFrame.filename + ':' + aFrame.lineNumber +
           ':' + aFrame.columnNumber + ')';
  },

  observe: function (aSubject, aTopic, aData) {
    switch(aTopic) {
      // Engine DownloadManager notifications
      case "app-startup": {
        var runConsoleEnv = 0;
        if (Logger.stackTraceEnabled)
          Services.obs.addObserver(this, 'console-api-log-event', false);

        if (Logger.enabled) {
          this._listener = new SPConsoleListener();
          Services.console.registerListener(this._listener);
          Services.obs.addObserver(this, "embedui:logger", true);
        }
        break;
      }
      case "embedui:logger": {
        var data = JSON.parse(aData);
        if (data.enabled) {
          if (Logger.enabled) {
            this._listener.flushCache();
          } else {
            Services.console.registerListener(this._listener);
          }
        } else if (!data.enabled && Logger.enabled) {
          Services.console.unregisterListener(this._listener);
          this._listener.clearCache();
        }
        break;
      }
      case "console-api-log-event": {
        let message = aSubject.wrappedJSObject;
        let args = message.arguments;
        let stackTrace = '';

        if (message.stacktrace &&
            (message.level == 'assert' || message.level == 'error' || message.level == 'trace')) {
          stackTrace = Array.map(message.stacktrace, this.formatStackFrame).join('\n');
        } else {
          stackTrace = this.formatStackFrame(message);
        }

        args.push('\n' + stackTrace);

        Logger.debug("Content JS:", message.filename, "function:", message.functionName, "message:", args.join(" "));
        break;
      }
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([EmbedLiteConsoleListener]);
