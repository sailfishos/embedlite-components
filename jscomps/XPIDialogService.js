/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Ci = Components.interfaces;

const { ComponentUtils } = ChromeUtils.import("resource://gre/modules/ComponentUtils.jsm");
const { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

Services.scriptloader.loadSubScript("chrome://embedlite/content/Logger.js");

// -----------------------------------------------------------------------
// Web Install Prompt service
// -----------------------------------------------------------------------

function WebInstallPrompt() {
  Logger.debug("JSComp: XPIDialogService.js loaded");
}

WebInstallPrompt.prototype = {
  classID: Components.ID("{ce2d8764-c366-11e2-8e71-1bb058e7ef52}"),
  QueryInterface: ChromeUtils.generateQI([Ci.amIWebInstallPrompt]),

  confirm: function(aWindow, aURL, aInstalls) {

    let prompt = Services.prompt;
    let flags = prompt.BUTTON_POS_0 * prompt.BUTTON_TITLE_IS_STRING + prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_CANCEL;

    aInstalls.forEach(function(install) {
      // ConfirmEx not implemented yet
    let title = "Install Extension " + install.name;

//      let result = (prompt.confirm(aWindow, title, install.name, flags, "test.bt", null, null, null, {value: false}) == 0);
      let result = aWindow.confirm(title);
      if (result) {
        install.install();
      }
      else {
        install.cancel();
      }
    });
  }
};

this.NSGetFactory = ComponentUtils.generateNSGetFactory([WebInstallPrompt]);
