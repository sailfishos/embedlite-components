/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;
const Cu = Components.utils;

const { ComponentUtils } = ChromeUtils.import("resource://gre/modules/ComponentUtils.jsm");
const { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { PrivateBrowsingUtils } = ChromeUtils.import("resource://gre/modules/PrivateBrowsingUtils.jsm");

Services.scriptloader.loadSubScript("chrome://embedlite/content/Logger.js");

XPCOMUtils.defineLazyModuleGetter(this, "Prompt",
                                  "chrome://embedlite/content/Prompt.jsm");

var gPromptService = null;

function PromptService() {
  gPromptService = this;
  Logger.debug("JSComp: PromptService.js loaded");
}

PromptService.prototype = {
  inModalState: false,
  classID: Components.ID("{44df5fae-c5a1-11e2-8e91-1ff32ee4f840}"),

  QueryInterface: ChromeUtils.generateQI([Ci.nsIPromptFactory, Ci.nsIPromptService]),

  inPrivateBrowsing: function(domWin) {
    if (domWin) {
      return PrivateBrowsingUtils.isContentWindowPrivate(domWin);
    }

    return true;
  },

  /* ----------  nsIPromptFactory  ---------- */
  // XXX Copied from Prompter.jsm.
  getPrompt: function getPrompt(domWin, iid) {
    // This is still kind of dumb; the C++ code delegated to login manager
    // here, which in turn calls back into us via nsIPromptService.
// Disabled due to fail to obtain chrome window and browser in _getChromeWindow
// of LoginManagerPrompter.js
/*
    if (iid.equals(Ci.nsIAuthPrompt2) || iid.equals(Ci.nsIAuthPrompt)) {
      try {
        let pwmgr = Cc[
          "@mozilla.org/passwordmanager/authpromptfactory;1"
        ].getService(Ci.nsIPromptFactory);
        return pwmgr.getPrompt(domWin, iid);
      } catch (e) {
        Cu.reportError(
          "nsPrompter: Delegation to password manager failed: " + e
        );
      }
    }
*/
    let p = new InternalPrompt(domWin);
    p.QueryInterface(iid);
    return p;
  },

  /* ----------  private memebers  ---------- */

  // nsIPromptService methods proxy to our Prompt class
  callProxy: function(aMethod, aArguments) {
    let prompt;
    let domWin = aArguments[0];
    prompt = new InternalPrompt(domWin);
    return prompt[aMethod].apply(prompt, Array.prototype.slice.call(aArguments, 1));
  },

  /* ----------  nsIPromptService  ---------- */

  alert: function() {
    return this.callProxy("alert", arguments);
  },
  alertCheck: function() {
    return this.callProxy("alertCheck", arguments);
  },
  confirm: function() {
    return this.callProxy("confirm", arguments);
  },
  confirmCheck: function() {
    return this.callProxy("confirmCheck", arguments);
  },
  confirmEx: function() {
    return this.callProxy("confirmEx", arguments);
  },
  prompt: function() {
    return this.callProxy("prompt", arguments);
  },
  promptUsernameAndPassword: function() {
    return this.callProxy("promptUsernameAndPassword", arguments);
  },
  promptPassword: function() {
    return this.callProxy("promptPassword", arguments);
  },
  select: function() {
    return this.callProxy("select", arguments);
  },
  promptAuth: function() {
    return this.callProxy("promptAuth", arguments);
  },
  asyncPromptAuth: function() {
    return this.callProxy("asyncPromptAuth", arguments);
  }
};

function InternalPrompt(aDomWin) {
  this._domWin = aDomWin;
  this._privateBrowsing = gPromptService.inPrivateBrowsing(this._domWin);
}

InternalPrompt.prototype = {
  _domWin: null,

  QueryInterface: ChromeUtils.generateQI([Ci.nsIPrompt, Ci.nsIAuthPrompt, Ci.nsIAuthPrompt2]),

  /* ---------- internal methods ---------- */
  _getPrompt: function _getPrompt(aTitle, aText, aButtons, aCheckMsg, aCheckState) {
    let p = new Prompt({
      window: this._domWin,
      title: aTitle,
      message: aText,
      buttons: aButtons || [
        "OK",
        "Cancel"
      ]
    });
    return p;
  },

  addCheckbox: function addCheckbox(prompt, checkMsg, checkState, hint) {
    // Don't bother to check for aCheckSate. For nsIPomptService interfaces, checkState is an
    // out param and is required to be defined. If we've gotten here without it, something
    // has probably gone wrong and we should fail
    if (checkMsg) {
      prompt.addCheckbox({
        label: PromptUtils.cleanUpLabel(checkMsg),
        checked: checkState.value,
        hint: hint
      });
    }

    return prompt;
  },

  addTextbox: function(prompt, value, autofocus, hint) {
    prompt.addTextbox({
      value: (value !== null) ? value : "",
      autofocus: autofocus,
      hint: hint
    });
  },

  addPassword: function(prompt, value, autofocus, hint) {
    prompt.addPassword({
      value: (value !== null) ? value : "",
      autofocus: autofocus,
      hint: hint
    });
  },

  addHostInfo: function(prompt, hostname, realm) {
    prompt.addHiddenValue("hostname", hostname);
    prompt.addHiddenValue("realm", realm);
  },

  /* Shows a native prompt, and then spins the event loop for this thread while we wait
   * for a response
   */
  showPrompt: function showPrompt(aPrompt) {
    if (gPromptService.inModalState) {
      return {
        "accepted": false
      };
    }

    if (this._domWin) {
      PromptUtils.fireDialogEvent(this._domWin, "DOMWillOpenModalDialog");
      let winUtils = this._domWin.windowUtils;
      winUtils.enterModalState();
      gPromptService.inModalState = true;
    }

    let retval = null;
    aPrompt.show(function(data) {
      retval = data;
    });

    // Spin this thread while we wait for a result
    let thread = Services.tm.currentThread;
    while (retval == null)
      thread.processNextEvent(true);

    if (this._domWin) {
      let winUtils = this._domWin.windowUtils;
      winUtils.leaveModalState();
      PromptUtils.fireDialogEvent(this._domWin, "DOMModalDialogClosed");
      gPromptService.inModalState = false;
    }

    return retval;
  },

  /*
   * ---------- interface disambiguation ----------
   *
   * XXX Copied from nsPrompter.js.
   *
   * nsIPrompt and nsIAuthPrompt share 3 method names with slightly
   * different arguments. All but prompt() have the same number of
   * arguments, so look at the arg types to figure out how we're being
   * called. :-(
   */
  prompt: function prompt() {
    if (gPromptService.inContentProcess)
      return gPromptService.callProxy("prompt", [null].concat(Array.prototype.slice.call(arguments)));

    // also, the nsIPrompt flavor has 5 args instead of 6.
    if (typeof arguments[2] == "object")
      return this.nsIPrompt_prompt.apply(this, arguments);
    else
      return this.nsIAuthPrompt_prompt.apply(this, arguments);
  },

  promptUsernameAndPassword: function promptUsernameAndPassword() {
    // Both have 6 args, so use types.
    if (typeof arguments[2] == "object")
      return this.nsIPrompt_promptUsernameAndPassword.apply(this, arguments);
    else
      return this.nsIAuthPrompt_promptUsernameAndPassword.apply(this, arguments);
  },

  promptPassword: function promptPassword() {
    // Both have 5 args, so use types.
    if (typeof arguments[2] == "object")
      return this.nsIPrompt_promptPassword.apply(this, arguments);
    else
      return this.nsIAuthPrompt_promptPassword.apply(this, arguments);
  },

  /* ----------  nsIPrompt  ---------- */

  alert: function alert(aTitle, aText) {
    let p = this._getPrompt(aTitle, aText, [ "OK" ]);
    p.setHint("alert");
    this.showPrompt(p);
  },

  alertCheck: function alertCheck(aTitle, aText, aCheckMsg, aCheckState) {
    let p = this._getPrompt(aTitle, aText, [ "OK" ]);
    p.setHint("alert");
    this.addCheckbox(p, aCheckMsg, aCheckState, "preventAddionalDialog");
    let data = this.showPrompt(p);
    if (aCheckState)
      aCheckState.value = data.checkvalue || false;
  },

  confirm: function confirm(aTitle, aText) {
    let p = this._getPrompt(aTitle, aText);
    p.setHint("confirm");
    let data = this.showPrompt(p);
    return data.accepted;
  },

  confirmCheck: function confirmCheck(aTitle, aText, aCheckMsg, aCheckState) {
    let p = this._getPrompt(aTitle, aText, null);
    p.setHint("confirm");
    this.addCheckbox(p, aCheckMsg, aCheckState, "preventAddionalDialog");
    let data = this.showPrompt(p);
    let ok = data.accepted;
    if (aCheckState)
      aCheckState.value = data.checkvalue || false;
    return ok;
  },

  confirmEx: function confirmEx(aTitle, aText, aButtonFlags, aButton0,
                      aButton1, aButton2, aCheckMsg, aCheckState) {
    let buttons = [];
    let titles = [aButton0, aButton1, aButton2];
    for (let i = 0; i < 3; i++) {
      let bTitle = null;
      switch (aButtonFlags & 0xff) {
        case Ci.nsIPromptService.BUTTON_TITLE_OK :
          bTitle = "OK";
          break;
        case Ci.nsIPromptService.BUTTON_TITLE_CANCEL :
          bTitle = "Cancel";
          break;
        case Ci.nsIPromptService.BUTTON_TITLE_YES :
          bTitle = "Yes";
          break;
        case Ci.nsIPromptService.BUTTON_TITLE_NO :
          bTitle = "No";
          break;
        case Ci.nsIPromptService.BUTTON_TITLE_SAVE :
          bTitle = "Save";
          break;
        case Ci.nsIPromptService.BUTTON_TITLE_DONT_SAVE :
          bTitle = "DontSave";
          break;
        case Ci.nsIPromptService.BUTTON_TITLE_REVERT :
          bTitle = "Revert";
          break;
        case Ci.nsIPromptService.BUTTON_TITLE_IS_STRING :
          bTitle = PromptUtils.cleanUpLabel(titles[i]);
        break;
      }

      if (bTitle)
        buttons.push(bTitle);

      aButtonFlags >>= 8;
    }

    let p = this._getPrompt(aTitle, aText, buttons);
    p.setHint("confirm");
    this.addCheckbox(p, aCheckMsg, aCheckState, "preventAddionalDialog");
    let data = this.showPrompt(p);
    if (aCheckState)
      aCheckState.value = data.checkvalue || false;;
    return data.accepted;
  },

  nsIPrompt_prompt: function nsIPrompt_prompt(aTitle, aText, aValue, aCheckMsg, aCheckState) {
    let p = this._getPrompt(aTitle, aText, null, aCheckMsg, aCheckState);
    p.setHint("prompt");
    this.addTextbox(p, aValue.value, true);
    this.addCheckbox(p, aCheckMsg, aCheckState, "preventAddionalDialog");
    let data = this.showPrompt(p);

    let ok = data.accepted;
    if (aCheckState)
      aCheckState.value = data.checkvalue || false;
    if (ok)
      aValue.value = data.promptvalue || "";
    return ok;
  },

  nsIPrompt_promptPassword: function nsIPrompt_promptPassword(
      aTitle, aText, aPassword, aCheckMsg, aCheckState) {
    let p = this._getPrompt(aTitle, aText, null);
    p.setHint("auth");
    p.setPrivateBrowsing(this._privateBrowsing);
    this.addPassword(p, aPassword.value, true, "password");
    this.addCheckbox(p, aCheckMsg, aCheckState, "remember");
    let data = this.showPrompt(p);

    let ok = data.accepted;
    // True if we should remember login
    if (aCheckState)
      aCheckState.value = data.remember || false;

    if (ok)
      aPassword.value = data.password || "";
    return ok;
  },

  nsIPrompt_promptUsernameAndPassword: function nsIPrompt_promptUsernameAndPassword(
      aTitle, aText, aUsername, aPassword, aCheckMsg, aCheckState) {
    let p = this._getPrompt(aTitle, aText, null);
    p.setHint("auth");
    p.setPrivateBrowsing(this._privateBrowsing);
    this.addTextbox(p, aUsername.value, true, "username");
    this.addPassword(p, aPassword.value, false, "password");
    this.addCheckbox(p, aCheckMsg, aCheckState, "remember");
    let data = this.showPrompt(p);

    let ok = data.accepted;
    // True if we should remember login
    if (aCheckState)
      aCheckState.value = data.remember || false;

    if (ok) {
      aUsername.value = data.username || "";
      aPassword.value = data.password || "";
    }
    return ok;
  },

  nonlocalized_promptPassword: function nonlocalized_promptPassword(
      aTitle, aMessage, aHostname, aHttpRealm, aPassword, aCheckMsg, aCheckState) {
    // We abuse the Gecko-to-Qt translation key conversion process by providing a key for the
    // accept button that isn't actually available in gecko, but which we need in the front end
    let p = this._getPrompt(aTitle, aMessage, [ "AcceptLogin" ]);
    p.setHint("auth");
    p.setPrivateBrowsing(this._privateBrowsing);
    p.addHostInfo(aHostname, aHttpRealm);
    this.addPassword(p, aPassword.value, true, "password");
    this.addCheckbox(p, aCheckMsg, aCheckState, "remember");
    let data = this.showPrompt(p);

    let ok = data.accepted;
    // True if we should remember login
    if (aCheckState)
      aCheckState.value = data.remember || false;

    if (ok)
      aPassword.value = data.password || "";
    return ok;
  },

  nonlocalized_promptUsernameAndPassword: function nonlocalized_promptUsernameAndPassword(
      aTitle, aMessage, aHostname, aHttpRealm, aUsername, aPassword, aCheckMsg, aCheckState) {
    // We abuse the Gecko-to-Qt translation key conversion process by providing a key for the
    // accept button that isn't actually available in gecko, but which we need in the front end
    let p = this._getPrompt(aTitle, aMessage, [ "AcceptLogin" ]);
    p.setHint("auth");
    p.setPrivateBrowsing(this._privateBrowsing);
    this.addHostInfo(p, aHostname, aHttpRealm);
    this.addTextbox(p, aUsername.value, true, "username");
    this.addPassword(p, aPassword.value, false, "password");
    this.addCheckbox(p, aCheckMsg, aCheckState, "remember");
    let data = this.showPrompt(p);

    let ok = data.accepted;
    // True if we should remember login
    if (aCheckState)
      aCheckState.value = data.remember || false;

    if (ok) {
      aUsername.value = data.username || "";
      aPassword.value = data.password || "";
    }
    return ok;
  },

  select: function select(aTitle, aText, aCount, aSelectList, aOutSelection) {
    let p = this._getPrompt(aTitle, aText, [ "OK" ]);
    p.setHint("select");
    p.addMenulist({ values: aSelectList });
    let data = this.showPrompt(p);

    let ok = data.button == 0;
    if (ok)
      aOutSelection.value = data.menulist0;

    return ok;
  },

  /* ----------  nsIAuthPrompt  ---------- */

  nsIAuthPrompt_prompt: function(title, text, passwordRealm, savePassword, defaultText, result) {
    // TODO: Port functions from LoginManagerPrompter.js to here
    if (defaultText)
      result.value = defaultText;
    return this.nsIPrompt_prompt(title, text, result, null, {});
  },

  nsIAuthPrompt_promptUsernameAndPassword: function(aTitle, aText, aPasswordRealm, aSavePassword, aUser, aPass) {
    return this.nsIAuthPrompt_loginPrompt(aTitle, aText, aPasswordRealm, aSavePassword, aUser, aPass);
  },

  nsIAuthPrompt_promptPassword: function(aTitle, aText, aPasswordRealm, aSavePassword, aPass) {
    return this.nsIAuthPrompt_loginPrompt(aTitle, aText, aPasswordRealm, aSavePassword, null, aPass);
  },

  nsIAuthPrompt_loginPrompt: function(aTitle, aPasswordRealm, aSavePassword, aUser, aPass) {
    let checkMsg = null;
    let check = { value: false };
    let hostname, realm;
    [hostname, realm, aUser] = PromptUtils.getHostnameAndRealm(aPasswordRealm);

    let canSave = PromptUtils.canSaveLogin(hostname, aSavePassword, this._privateBrowsing);
    if (canSave) {
      // Look for existing logins.
      let foundLogins = PromptUtils.pwmgr.findLogins({}, hostname, null, realm);
      [checkMsg, check] = PromptUtils.getUsernameAndPassword(foundLogins, aUser, aPass);
    }

    // (eslint-disable: see bug 1177904)
    let ok = false;
    if (aUser)
      ok = this.nsIPrompt_promptUsernameAndPassword(aTitle, hostname, aUser, aPass, checkMsg, check); // eslint-disable-line no-undef
    else
      ok = this.nsIPrompt_promptPassword(aTitle, hostname, aPass, checkMsg, check); // eslint-disable-line no-undef

    if (ok && canSave && check.value)
      PromptUtils.savePassword(hostname, realm, aUser, aPass);

    return ok;
  },

  /* ----------  nsIAuthPrompt2  ---------- */

  promptAuth: function promptAuth(aChannel, aLevel, aAuthInfo) {
    let checkMsg = null;
    let check = { value: false };
    let message = PromptUtils.makeDialogText(aChannel, aAuthInfo);
    let [username, password] = PromptUtils.getAuthInfo(aAuthInfo);
    let [hostname, httpRealm] = PromptUtils.getAuthTarget(aChannel, aAuthInfo);
    let foundLogins = PromptUtils.pwmgr.findLogins({}, hostname, null, httpRealm);

    let canSave = PromptUtils.canSaveLogin(hostname, null, this._privateBrowsing);
    if (canSave)
      [checkMsg, check] = PromptUtils.getUsernameAndPassword(foundLogins, username, password);

    if (username.value && password.value) {
      PromptUtils.setAuthInfo(aAuthInfo, username.value, password.value);
    }

    let canAutologin = false;
    if (aAuthInfo.flags & Ci.nsIAuthInformation.AUTH_PROXY &&
        !(aAuthInfo.flags & Ci.nsIAuthInformation.PREVIOUS_FAILED) &&
        Services.prefs.getBoolPref("signon.autologin.proxy") &&
        !this._privateBrowsing)
      canAutologin = true;

    let ok = canAutologin;
    if (!ok && aAuthInfo.flags & Ci.nsIAuthInformation.ONLY_PASSWORD)
      ok = this.nonlocalized_promptPassword(null, message, hostname, httpRealm, password, checkMsg, check);
    else if (!ok)
      ok = this.nonlocalized_promptUsernameAndPassword(null, message, hostname, httpRealm,
                                                       username, password, checkMsg, check);

    PromptUtils.setAuthInfo(aAuthInfo, username.value, password.value);

    if (ok && canSave && check.value) {
      // keep login going even if saving credentials fails
      try {
        PromptUtils.savePassword(foundLogins, username, password, hostname, httpRealm);
      } catch (e) {
        Logger.warn("PromptService.js / promptAuth failed to save password: " + e)
      }
    }

    return ok;
  },

  _asyncPrompts: {},
  _asyncPromptInProgress: false,

  _doAsyncPrompt : function() {
    if (this._asyncPromptInProgress)
      return;

    // Find the first prompt key we have in the queue
    let hashKey = null;
    for (hashKey in this._asyncPrompts)
      break;

    if (!hashKey)
      return;

    // If login manger has logins for this host, defer prompting if we're
    // already waiting on a master password entry.
    let prompt = this._asyncPrompts[hashKey];
    let prompter = prompt.prompter;
    let [hostname, httpRealm] = PromptUtils.getAuthTarget(prompt.channel, prompt.authInfo);
    let foundLogins = PromptUtils.pwmgr.findLogins({}, hostname, null, httpRealm);
    if (foundLogins.length > 0 && PromptUtils.pwmgr.uiBusy)
      return;

    this._asyncPromptInProgress = true;
    prompt.inProgress = true;

    let self = this;

    let runnable = {
      run: function() {
        let ok = false;
        try {
          ok = prompter.promptAuth(prompt.channel, prompt.level, prompt.authInfo);
        } catch (e) {
          Cu.reportError("_doAsyncPrompt:run: " + e + "\n");
        }

        delete self._asyncPrompts[hashKey];
        prompt.inProgress = false;
        self._asyncPromptInProgress = false;

        for (let consumer of prompt.consumers) {
          if (!consumer.callback)
            // Not having a callback means that consumer didn't provide it
            // or canceled the notification
            continue;

          try {
            if (ok)
              consumer.callback.onAuthAvailable(consumer.context, prompt.authInfo);
            else
              consumer.callback.onAuthCancelled(consumer.context, true);
          } catch (e) { /* Throw away exceptions caused by callback */ }
        }
        self._doAsyncPrompt();
      }
    }

    Services.tm.mainThread.dispatch(runnable, Ci.nsIThread.DISPATCH_NORMAL);
  },

  asyncPromptAuth: function asyncPromptAuth(aChannel, aCallback, aContext, aLevel, aAuthInfo) {
    let cancelable = null;
    try {
      // If the user submits a login but it fails, we need to remove the
      // notification bar that was displayed. Conveniently, the user will
      // be prompted for authentication again, which brings us here.
      //this._removeLoginNotifications();

      cancelable = {
        QueryInterface: ChromeUtils.generateQI([Ci.nsICancelable]),
        callback: aCallback,
        context: aContext,
        cancel: function() {
          this.callback.onAuthCancelled(this.context, false);
          this.callback = null;
          this.context = null;
        }
      };
      let [hostname, httpRealm] = PromptUtils.getAuthTarget(aChannel, aAuthInfo);
      let hashKey = aLevel + "|" + hostname + "|" + httpRealm;
      let asyncPrompt = this._asyncPrompts[hashKey];
      if (asyncPrompt) {
        asyncPrompt.consumers.push(cancelable);
        return cancelable;
      }

      asyncPrompt = {
        consumers: [cancelable],
        channel: aChannel,
        authInfo: aAuthInfo,
        level: aLevel,
        inProgress: false,
        prompter: this
      }

      this._asyncPrompts[hashKey] = asyncPrompt;
      this._doAsyncPrompt();
    } catch (e) {
      Cu.reportError("PromptService: " + e + "\n");
      throw e;
    }
    return cancelable;
  }
};

var PromptUtils = {
  //
  // Copied from chrome://global/content/commonDialog.js
  //
  cleanUpLabel: function cleanUpLabel(aLabel) {
    // This is for labels which may contain embedded access keys.
    // If we end in (&X) where X represents the access key, optionally preceded
    // by spaces and/or followed by the ':' character,
    // remove the access key placeholder + leading spaces from the label.
    // Otherwise a character preceded by one but not two &s is the access key.

    // Note that if you change the following code, see the comment of
    // nsTextBoxFrame::UpdateAccessTitle.
    if (!aLabel)
      return "";

    if (/ *\(\&([^&])\)(:?)$/.test(aLabel)) {
      aLabel = RegExp.leftContext + RegExp.$2;
    } else if (/^([^&]*)\&(([^&]).*$)/.test(aLabel)) {
      aLabel = RegExp.$1 + RegExp.$2;
    }

    // Special code for using that & symbol
    aLabel = aLabel.replace(/\&\&/g, "&");

    return aLabel;
  },

  get pwmgr() {
    delete this.pwmgr;
    return this.pwmgr = Cc["@mozilla.org/login-manager;1"].getService(Ci.nsILoginManager);
  },

  getHostnameAndRealm: function pu_getHostnameAndRealm(aRealmString) {
    let httpRealm = /^.+ \(.+\)$/;
    if (httpRealm.test(aRealmString))
      return [null, null, null];

    let uri = Services.io.newURI(aRealmString, null, null);
    let pathname = "";

    if (uri.path != "/")
      pathname = uri.path;

    let formattedHostname = this._getFormattedHostname(uri);
    return [formattedHostname, formattedHostname + pathname, uri.username];
  },

  canSaveLogin: function pu_canSaveLogin(aHostname, aSavePassword, aPrivateBrowsing) {
    let canSave = !aPrivateBrowsing && this.pwmgr.getLoginSavingEnabled(aHostname)
    if (aSavePassword)
      canSave = canSave && (aSavePassword == Ci.nsIAuthPrompt.SAVE_PASSWORD_PERMANENTLY)
    return canSave;
  },

  getUsernameAndPassword: function pu_getUsernameAndPassword(aFoundLogins, aUser, aPass) {
    let checkLabel = null;
    let check = { value: false };
    let selectedLogin;

    checkLabel = "rememberButtonText";

    // XXX Like the original code, we can't deal with multiple
    // account selection. (bug 227632)
    if (aFoundLogins.length > 0) {
      selectedLogin = aFoundLogins[0];

      // If the caller provided a username, try to use it. If they
      // provided only a password, this will try to find a password-only
      // login (or return null if none exists).
      if (aUser.value)
        selectedLogin = this.findLogin(aFoundLogins, "username", aUser.value);

      if (selectedLogin) {
        check.value = true;
        aUser.value = selectedLogin.username;
        // If the caller provided a password, prefer it.
        if (!aPass.value)
          aPass.value = selectedLogin.password;
      }
    }

    return [checkLabel, check];
  },

  findLogin: function pu_findLogin(aLogins, aName, aValue) {
    for (let i = 0; i < aLogins.length; i++)
      if (aLogins[i][aName] == aValue)
        return aLogins[i];
    return null;
  },

  savePassword: function pu_savePassword(aLogins, aUser, aPass, aHostname, aRealm) {
    let selectedLogin = this.findLogin(aLogins, "username", aUser.value);

    // If we didn't find an existing login, or if the username
    // changed, save as a new login.
    if (!selectedLogin) {
      // add as new
      var newLogin = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
      newLogin.init(aHostname, null, aRealm, aUser.value, aPass.value, "", "");
      this.pwmgr.addLogin(newLogin);
    } else if (aPass.value != selectedLogin.password) {
      // update password
      this.updateLogin(selectedLogin, aPass.value);
    } else {
      this.updateLogin(selectedLogin);
    }
  },

  updateLogin: function pu_updateLogin(aLogin, aPassword) {
    let now = Date.now();
    let propBag = Cc["@mozilla.org/hash-property-bag;1"].createInstance(Ci.nsIWritablePropertyBag);
    if (aPassword) {
      propBag.setProperty("password", aPassword);
      // Explicitly set the password change time here (even though it would
      // be changed automatically), to ensure that it's exactly the same
      // value as timeLastUsed.
      propBag.setProperty("timePasswordChanged", now);
    }
    propBag.setProperty("timeLastUsed", now);
    propBag.setProperty("timesUsedIncrement", 1);

    this.pwmgr.modifyLogin(aLogin, propBag);
  },

  // JS port of http://mxr.mozilla.org/mozilla-central/source/embedding/components/windowwatcher/nsPrompt.cpp#388
  makeDialogText: function pu_makeDialogText(aChannel, aAuthInfo) {
    let isProxy    = (aAuthInfo.flags & Ci.nsIAuthInformation.AUTH_PROXY);
    let isPassOnly = (aAuthInfo.flags & Ci.nsIAuthInformation.ONLY_PASSWORD);
    let isCrossOrig = (aAuthInfo.flags &
                       Ci.nsIAuthInformation.CROSS_ORIGIN_SUB_RESOURCE);

    let username = aAuthInfo.username;
    let [displayHost, realm] = this.getAuthTarget(aChannel, aAuthInfo);

    // Suppress "the site says: $realm" when we synthesized a missing realm.
    if (!aAuthInfo.realm && !isProxy)
      realm = "";

    // Trim obnoxiously long realms.
    if (realm.length > 150) {
      realm = realm.substring(0, 150);
      // Append "..." (or localized equivalent).
      realm += this.ellipsis;
    }

    let textBundle;
    if (isProxy) {
      textBundle = ["EnterLoginForProxy3", realm, displayHost];
    } else if (isPassOnly) {
      textBundle = ["EnterPasswordFor", username, displayHost];
    } else if (isCrossOrig) {
      textBundle = ["EnterUserPasswordForCrossOrigin2", displayHost];
    } else if (!realm) {
      textBundle = ["EnterUserPasswordFor2", displayHost];
    } else {
      textBundle = ["EnterLoginForRealm3", realm, displayHost];
    }

    return textBundle;
  },

  // JS port of http://mxr.mozilla.org/mozilla-central/source/embedding/components/windowwatcher/nsPromptUtils.h#89
  getAuthHostPort: function pu_getAuthHostPort(aChannel, aAuthInfo) {
    let uri = aChannel.URI;
    let res = { host: null, port: -1 };
    if (aAuthInfo.flags & aAuthInfo.AUTH_PROXY) {
      let proxy = aChannel.QueryInterface(Ci.nsIProxiedChannel);
      res.host = proxy.proxyInfo.host;
      res.port = proxy.proxyInfo.port;
    } else {
      res.host = uri.host;
      res.port = uri.port;
    }
    return res;
  },

  getAuthTarget: function pu_getAuthTarget(aChannel, aAuthInfo) {
    let hostname, realm;
    // If our proxy is demanding authentication, don't use the
    // channel's actual destination.
    if (aAuthInfo.flags & Ci.nsIAuthInformation.AUTH_PROXY) {
        if (!(aChannel instanceof Ci.nsIProxiedChannel))
          throw "proxy auth needs nsIProxiedChannel";

      let info = aChannel.proxyInfo;
      if (!info)
        throw "proxy auth needs nsIProxyInfo";

      // Proxies don't have a scheme, but we'll use "moz-proxy://"
      // so that it's more obvious what the login is for.
      let idnService = Cc["@mozilla.org/network/idn-service;1"].getService(Ci.nsIIDNService);
      hostname = "moz-proxy://" + idnService.convertUTF8toACE(info.host) + ":" + info.port;
      realm = aAuthInfo.realm;
      if (!realm)
        realm = hostname;

      return [hostname, realm];
    }
    hostname = this.getFormattedHostname(aChannel.URI);

    // If a HTTP WWW-Authenticate header specified a realm, that value
    // will be available here. If it wasn't set or wasn't HTTP, we'll use
    // the formatted hostname instead.
    realm = aAuthInfo.realm;
    if (!realm)
      realm = hostname;

    return [hostname, realm];
  },

  getAuthInfo: function pu_getAuthInfo(aAuthInfo) {
    let flags = aAuthInfo.flags;
    let username = {value: ""};
    let password = {value: ""};

    if (flags & Ci.nsIAuthInformation.NEED_DOMAIN && aAuthInfo.domain)
      username.value = aAuthInfo.domain + "\\" + aAuthInfo.username;
    else
      username.value = aAuthInfo.username;

    password.value = aAuthInfo.password

    return [username, password];
  },

  setAuthInfo: function(aAuthInfo, username, password) {
    var flags = aAuthInfo.flags;
    if (flags & Ci.nsIAuthInformation.NEED_DOMAIN) {
      // Domain is separated from username by a backslash
      var idx = username.indexOf("\\");
      if (idx == -1) {
        aAuthInfo.username = username;
      } else {
        aAuthInfo.domain   =  username.substring(0, idx);
        aAuthInfo.username =  username.substring(idx + 1);
      }
    } else {
      aAuthInfo.username = username;
    }
    aAuthInfo.password = password;
  },

  /**
   * Strip out things like userPass and path for display.
   */
  getFormattedHostname: function pu_getFormattedHostname(uri) {
    return uri.scheme + "://" + uri.hostPort;
  },

  fireDialogEvent: function(aDomWin, aEventName) {
    // accessing the document object can throw if this window no longer exists. See bug 789888.
    try {
      if (!aDomWin.document)
        return;
      let event = aDomWin.document.createEvent("Events");
      event.initEvent(aEventName, true, true);
      let winUtils = aDomWin.windowUtils;
      winUtils.dispatchEventToChromeOnly(aDomWin, event);
    } catch(ex) {
    }
  }
};

XPCOMUtils.defineLazyGetter(PromptUtils, "passwdBundle", function () {
  return Services.strings.createBundle("chrome://passwordmgr/locale/passwordmgr.properties");
});

XPCOMUtils.defineLazyGetter(PromptUtils, "bundle", function () {
  return Services.strings.createBundle("chrome://global/locale/commonDialogs.properties");
});


// Factory for wrapping nsIAuthPrompt interfaces to make them usable via an nsIAuthPrompt2 interface.
// XXX Copied from nsPrompter.js.
function AuthPromptAdapterFactory() {
}

AuthPromptAdapterFactory.prototype = {
  classID: Components.ID("{80dae1e9-e0d2-4974-915f-f97050fa8068}"),
  QueryInterface: ChromeUtils.generateQI([Ci.nsIAuthPromptAdapterFactory]),

  /* ----------  nsIAuthPromptAdapterFactory ---------- */

  createAdapter: function(aPrompt) {
    return new AuthPromptAdapter(aPrompt);
  }
};


// Takes an nsIAuthPrompt implementation, wraps it with a nsIAuthPrompt2 shell.
// XXX Copied from nsPrompter.js.
function AuthPromptAdapter(aPrompt) {
  this.prompt = aPrompt;
}

AuthPromptAdapter.prototype = {
  QueryInterface: ChromeUtils.generateQI([Ci.nsIAuthPrompt2]),
  prompt: null,

  /* ----------  nsIAuthPrompt2 ---------- */

  promptAuth: function(aChannel, aLevel, aAuthInfo, aCheckLabel, aCheckValue) {
    let message = PromptUtils.makeDialogText(aChannel, aAuthInfo);

    let [username, password] = PromptUtils.getAuthInfo(aAuthInfo);
    let [host, realm]  = PromptUtils.getAuthTarget(aChannel, aAuthInfo);
    let authTarget = host + " (" + realm + ")";

    let ok;
    if (aAuthInfo.flags & Ci.nsIAuthInformation.ONLY_PASSWORD) {
      ok = this.prompt.promptPassword(null, message, authTarget, Ci.nsIAuthPrompt.SAVE_PASSWORD_PERMANENTLY, password);
    } else {
      ok = this.prompt.promptUsernameAndPassword(null, message, authTarget, Ci.nsIAuthPrompt.SAVE_PASSWORD_PERMANENTLY, username, password);
    }

    if (ok) {
      PromptUtils.setAuthInfo(aAuthInfo, username.value, password.value);
    }
    return ok;
  },

  asyncPromptAuth: function(aChannel, aCallback, aContext, aLevel, aAuthInfo, aCheckLabel, aCheckValue) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  }
};

this.NSGetFactory = ComponentUtils.generateNSGetFactory([PromptService, AuthPromptAdapterFactory]);
