/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["OrientationChangeHandler"];

const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyServiceGetter(Services, "embedlite",
                                    "@mozilla.org/embedlite-app-service;1",
                                    "nsIEmbedAppService");

this.OrientationChangeHandler = function OrientationChangeHandler(window) {
    this._winID = Services.embedlite.getIDByWindow(window);
    this._targetWindow = Services.embedlite.getContentWindowByID(this._winID);
    // "DomContentLoaded" event listener registered in EmbedLiteOrientationChangeHandler.js
}

OrientationChangeHandler.prototype = {
  _targetWindow: null,
  _winID: -1,

  lastOrientation: "portrait-primary",
  isRegistered: false,
  orientationChangeSent: false,

  handleOrientationChange: function(evt) {
    let that = this;
    let newOrientation = that._targetWindow.screen.mozOrientation;
    let fullSwitch = (newOrientation.split("-")[0] ==
                      that.lastOrientation.split("-")[0]);
    that.orientationChangeSent = false;
    that.lastOrientation = newOrientation;

    function sendOrientationChanged() {
      if (that.orientationChangeSent) {
        return;
      }
      try {
        Services.embedlite.sendAsyncMessage(that._winID, "embed:contentOrientationChanged",
                                            JSON.stringify({
                                                             "orientation": that.lastOrientation
                                                           }));
        that.orientationChangeSent = true;
      } catch (e) {
        dump("EmbedLiteOrientationChangeHandler: Failed to report orientation change " + e + "\n")
      }
    }

    // 180deg rotation, no resize
    if (fullSwitch) {
      that._targetWindow.setTimeout(sendOrientationChanged);
      return;
    }

    that._targetWindow.addEventListener("resize", resizeThrottler, false);
    let resizeTimeout;
    function resizeThrottler() {
      // ignore resize events as long as an actualResizeHandler execution is in the queue
      if (!resizeTimeout) {
        resizeTimeout = that._targetWindow.setTimeout(function() {
          resizeTimeout = null;
          that._targetWindow.removeEventListener("resize", resizeThrottler, false);
          sendOrientationChanged();

          // The sendOrientationChanged will execute at a rate of 15fps
          // Noise should be small as we're only listening resizing after
          // orientation has changed.
        }, 66);
      }
    }

    // Fallback timeout 200ms.
    // When fullscreen video playback is running, noticed that
    // resizing doesn't take always place. This guarantees that
    // we will send the message back to chrome after 200ms. Normally
    // we go always through the resizeThrottler.
    that._targetWindow.setTimeout(sendOrientationChanged, 200);
  },

  handleEvent: function(evt) {
    let window = this._targetWindow;
    switch (evt.type) {
    case "DOMContentLoaded":
      let target = evt.originalTarget;
      // ignore on frames and other documents
      if (target != window.document) {
        return;
      }

      if (!this.isRegistered) {
        window.screen.addEventListener("mozorientationchange", this, true);
        // This will take care of navigation between pages.
        window.addEventListener("beforeunload", this, true);
        this.isRegistered = true;
      }

      // Confirm initial orientation
      try {
        this.lastOrientation = this._targetWindow.screen.mozOrientation;
        Services.embedlite.sendAsyncMessage(this._winID, "embed:contentOrientationChanged",
                                            JSON.stringify({
                                                             "orientation": this.lastOrientation
                                                           }));
      } catch (e) {
        dump("EmbedLiteOrientationChangeHandler: Report initial orientation " + e + "\n")
      }


      break;
    case "mozorientationchange":
      this.handleOrientationChange(evt);
      break;
    case "beforeunload":
      if (window && window.screen) {
        window.screen.removeEventListener("mozorientationchange", this, true);
      }
      this.isRegistered = false;
      break;
    }
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIDOMEventListener, Ci.nsISupportsWeakReference])
};
