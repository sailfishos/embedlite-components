/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * This combines the functionality of various login prompt interfaces:
 *
 * The structure in this file:
 * LoginManagerPromptFactory
 *   nsIPromptFactory
 * LoginManagerPrompter
 *   nsIAuthPrompt
 *   nsIAuthPrompt2
 *   nsILoginManagerPrompter
 *   nsILoginManagerAuthPrompter
 *
 * The structure in gecko:
 * gecko-dev/toolkit/components/passwordmgr/LoginManagerPrompter.jsm
 *   nsILoginManagerPrompter
 * gecko-dev/toolkit/components/passwordmgr/LoginManagerAuthPrompter.jsm
 *   nsIPromptFactory
 *   nsIAuthPrompt
 *   nsIAuthPrompt2
 *   nsILoginManagerAuthPrompter
 *
 * Related code in gecko-dev at 2834d64c4b16c7b9
 * https://github.com/sailfishos-mirror/gecko-dev/blob/2834d64c4b16c7b93857fd58ca55dc76d8176bfd/toolkit/components/passwordmgr/LoginManagerPrompter.jsm
 * https://github.com/sailfishos-mirror/gecko-dev/blob/2834d64c4b16c7b93857fd58ca55dc76d8176bfd/toolkit/components/passwordmgr/LoginManagerAuthPrompter.jsm
 */

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;


const { XPCOMUtils } = ChromeUtils.importESModule("resource://gre/modules/XPCOMUtils.sys.mjs");
const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
const { PromptUtils } = ChromeUtils.importESModule("resource://gre/modules/PromptUtils.sys.mjs");
const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  LoginHelper: "resource://gre/modules/LoginHelper.sys.mjs",
});

const loggerScope = {};
Services.scriptloader.loadSubScript(
  "chrome://embedlite/content/Logger.js",
  loggerScope
);
const { Logger } = loggerScope;

const LoginInfo = Components.Constructor(
  "@mozilla.org/login-manager/loginInfo;1",
  "nsILoginInfo",
  "init"
);

const BRAND_BUNDLE = "chrome://branding/locale/brand.properties";

/**
 * Constants for password prompt telemetry.
 */
const PROMPT_DISPLAYED = 0;
const PROMPT_ADD_OR_UPDATE = 1;
const PROMPT_NOTNOW_OR_DONTUPDATE = 2;
const PROMPT_NEVER = 3;
const PROMPT_DELETE = 3;

/**
 * A helper module to prevent modal auth prompt abuse.
 */
const PromptAbuseHelper = {
  getBaseDomainOrFallback(hostname) {
    try {
      return Services.eTLD.getBaseDomainFromHost(hostname);
    } catch (e) {
      return hostname;
    }
  },

  incrementPromptAbuseCounter(baseDomain, browser) {
    if (!browser) {
      return;
    }

    if (!browser.authPromptAbuseCounter) {
      browser.authPromptAbuseCounter = {};
    }

    if (!browser.authPromptAbuseCounter[baseDomain]) {
      browser.authPromptAbuseCounter[baseDomain] = 0;
    }

    browser.authPromptAbuseCounter[baseDomain] += 1;
  },

  resetPromptAbuseCounter(baseDomain, browser) {
    if (!browser || !browser.authPromptAbuseCounter) {
      return;
    }

    browser.authPromptAbuseCounter[baseDomain] = 0;
  },

  hasReachedAbuseLimit(baseDomain, browser) {
    if (!browser || !browser.authPromptAbuseCounter) {
      return false;
    }

    let abuseCounter = browser.authPromptAbuseCounter[baseDomain];
    // Allow for setting -1 to turn the feature off.
    if (this.abuseLimit < 0) {
      return false;
    }
    return !!abuseCounter && abuseCounter >= this.abuseLimit;
  },
};

XPCOMUtils.defineLazyPreferenceGetter(
  PromptAbuseHelper,
  "abuseLimit",
  "prompts.authentication_dialog_abuse_limit"
);

/**
 * Implements nsIPromptFactory
 *
 * Invoked by [toolkit/components/prompts/src/Prompter.jsm]
 */
export function LoginManagerPromptFactory() {
  Logger.debug("JSComp: LoginManagerPromptFactory loaded");

  Services.obs.addObserver(this, "passwordmgr-crypto-login", true);
}

LoginManagerPromptFactory.prototype = {
  classID: Components.ID("{72de694e-6c88-11e2-a4ee-6b515bdf0cb7}"),
  QueryInterface: ChromeUtils.generateQI([
    "nsIPromptFactory",
    "nsIObserver",
    "nsISupportsWeakReference",
  ]),

  // Tracks pending auth prompts per top level browser and hash key.
  // browser -> hashkey -> prompt
  // This enables us to consolidate auth prompts with the same browser and
  // hashkey (level, origin, realm).
  _pendingPrompts: new WeakMap(),
  // We use a separate bucket for when we don't have a browser.
  // _noBrowser -> hashkey -> prompt
  _noBrowser: {},
  // Promise used to defer prompts if the password manager isn't ready when
  // they're called.
  _uiBusyPromise: null,
  _uiBusyResolve: null,

  observe(subject, topic, data) {
    this.log("Observed: " + topic);
    if (topic == "passwordmgr-crypto-login") {
      // Show the deferred prompters.
      this._uiBusyResolve?.();
    }
  },

  getPrompt(aWindow, aIID) {
    var prompt = new LoginManagerPrompter().QueryInterface(aIID);
    prompt.init(aWindow, this);
    return prompt;
  },

  getPendingPrompt(browser, hashKey) {
    // If there is already a matching auth prompt which has no browser
    // associated we can reuse it. This way we avoid showing tab level prompts
    // when there is already a pending window prompt.
    let pendingNoBrowserPrompt = this._pendingPrompts
      .get(this._noBrowser)
      ?.get(hashKey);
    if (pendingNoBrowserPrompt) {
      return pendingNoBrowserPrompt;
    }
    return this._pendingPrompts.get(browser)?.get(hashKey);
  },

  _setPendingPrompt(prompt, hashKey) {
    let browser = prompt.prompter.browser || this._noBrowser;
    let hashToPrompt = this._pendingPrompts.get(browser);
    if (!hashToPrompt) {
      hashToPrompt = new Map();
      this._pendingPrompts.set(browser, hashToPrompt);
    }
    hashToPrompt.set(hashKey, prompt);
  },

  _removePendingPrompt(prompt, hashKey) {
    let browser = prompt.prompter.browser || this._noBrowser;
    let hashToPrompt = this._pendingPrompts.get(browser);
    if (!hashToPrompt) {
      return;
    }
    hashToPrompt.delete(hashKey);
    if (!hashToPrompt.size) {
      this._pendingPrompts.delete(browser);
    }
  },

  async _waitForLoginsUI(prompt) {
    await this._uiBusyPromise;

    let [origin, httpRealm] = prompt.prompter._getAuthTarget(
      prompt.channel,
      prompt.authInfo
    );

    // No UI to wait for.
    if (!Services.logins.uiBusy) {
      return;
    }

    let hasLogins =
      (await Services.logins.countLoginsAsync(origin, null, httpRealm)) > 0;
    if (
      !hasLogins &&
      lazy.LoginHelper.schemeUpgrades &&
      origin.startsWith("https://")
    ) {
      let httpOrigin = origin.replace(/^https:\/\//, "http://");
      hasLogins =
        (await Services.logins.countLoginsAsync(
          httpOrigin,
          null,
          httpRealm
        )) > 0;
    }
    // We don't depend on saved logins.
    if (!hasLogins) {
      return;
    }

    this.log("Waiting for primary password UI");

    this._uiBusyPromise = new Promise(resolve => {
      this._uiBusyResolve = resolve;
    });
    await this._uiBusyPromise;
  },

  async _doAsyncPrompt(prompt, hashKey) {
    this._setPendingPrompt(prompt, hashKey);

    // UI might be busy due to the master password dialog. Wait for it to close.
    await this._waitForLoginsUI(prompt);

    let ok = false;
    let promptAborted = false;
    try {
      this.log("_doAsyncPrompt - performing the prompt for '" + hashKey + "'");
      ok = await prompt.prompter.promptAuthInternal(
        prompt.channel,
        prompt.level,
        prompt.authInfo
      );
    } catch (e) {
      if (
        e instanceof Components.Exception &&
        e.result == Cr.NS_ERROR_NOT_AVAILABLE
      ) {
        this.log(
          "_doAsyncPrompt bypassed, UI is not available in this context"
        );
        // Prompts throw NS_ERROR_NOT_AVAILABLE if they're aborted.
        promptAborted = true;
      } else {
        Cu.reportError("LoginManagerAuthPrompter: _doAsyncPrompt " + e + "\n");
      }
    }

    this._removePendingPrompt(prompt, hashKey);

    // Handle callbacks
    for (var consumer of prompt.consumers) {
      if (!consumer.callback) {
        // Not having a callback means that consumer didn't provide it
        // or canceled the notification
        continue;
      }

      this.log("Calling back to " + consumer.callback + " ok=" + ok);
      try {
        if (ok) {
          consumer.callback.onAuthAvailable(consumer.context, prompt.authInfo);
        } else {
          consumer.callback.onAuthCancelled(consumer.context, !promptAborted);
        }
      } catch (e) {
        /* Throw away exceptions caused by callback */
      }
    }
  },
}; // end of LoginManagerPromptFactory implementation

ChromeUtils.defineLazyGetter(
  LoginManagerPromptFactory.prototype,
  "log",
  () => {
    let logger = lazy.LoginHelper.createLogger("Login PromptFactory");
    return logger.log.bind(logger);
  }
);

/* ==================== LoginManagerPrompter ==================== */


/**
 * Implements interfaces for prompting the user to enter/save/change auth info.
 *
 * nsIAuthPrompt: Used by SeaMonkey, Thunderbird, but not Firefox.
 *
 * nsIAuthPrompt2: Is invoked by a channel for protocol-based authentication
 * (eg HTTP Authenticate, FTP login).
 *
 * nsILoginManagerPrompter: Used by Login Manager for saving/changing logins
 * found in HTML forms.
 */
export function LoginManagerPrompter() {
  Logger.debug("JSComp: LoginManagerPrompter.js loaded");
}

LoginManagerPrompter.prototype = {
  classID: Components.ID("{8aa66d77-1bbb-45a6-991e-b8f47751c291}"),
  QueryInterface: ChromeUtils.generateQI([
    "nsIAuthPrompt",
    "nsIAuthPrompt2",
    "nsILoginManagerPrompter",
    "nsILoginManagerAuthPrompter",
    "nsIEmbedMessageListener",
  ]),

  _factory: null,
  _chromeWindow: null,
  _browser: null,
  _openerBrowser: null,
  _pendingRequests: {},

  _getRandomId() {
    let idService = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator);
    return idService.generateUUID().toString();
  },

  _getPromptBrowsingContext() {
    return this._browser?.browsingContext ||
           this._chromeWindow?.browsingContext ||
           null;
  },

  _getAuthMessage(aChannel, aAuthInfo) {
    let isProxy = aAuthInfo.flags & Ci.nsIAuthInformation.AUTH_PROXY;
    let isPassOnly = aAuthInfo.flags & Ci.nsIAuthInformation.ONLY_PASSWORD;
    let isCrossOrig =
      aAuthInfo.flags & Ci.nsIAuthInformation.CROSS_ORIGIN_SUB_RESOURCE;
    let username = aAuthInfo.username;
    let displayHost;
    let realm;

    if (isProxy) {
      if (!(aChannel instanceof Ci.nsIProxiedChannel)) {
        throw new Error("proxy auth needs nsIProxiedChannel");
      }

      let info = aChannel.proxyInfo;
      if (!info) {
        throw new Error("proxy auth needs nsIProxyInfo");
      }

      let idnService = Cc["@mozilla.org/network/idn-service;1"].getService(
        Ci.nsIIDNService
      );
      displayHost =
        "moz-proxy://" +
        idnService.convertUTF8toACE(info.host) +
        ":" +
        info.port;
      realm = aAuthInfo.realm || displayHost;
    } else {
      displayHost = this._getFormattedOrigin(aChannel.URI);
      realm = aAuthInfo.realm || "";
    }

    if (realm.length > 150) {
      realm = realm.substring(0, 150) + this._ellipsis;
    }

    if (isProxy) {
      return ["EnterLoginForProxy3", realm, displayHost];
    } else if (isPassOnly) {
      return ["EnterPasswordFor", username, displayHost];
    } else if (isCrossOrig) {
      return ["EnterUserPasswordForCrossOrigin2", displayHost];
    } else if (!realm) {
      return ["EnterUserPasswordFor2", displayHost];
    }
    return ["EnterLoginForRealm3", realm, displayHost];
  },

  _promptAuth(aChannel, aLevel, aAuthInfo, checkboxLabel, checkbox) {
    return new Promise(resolve => {
      let browsingContext = this._getPromptBrowsingContext();
      let win = null;
      try {
        win = browsingContext?.top?.window || browsingContext?.window;
      } catch (e) {}

      if (!win) {
        win = this._chromeWindow;
      }

      let winId;
      try {
        winId = Services.embedlite.getIDByWindow(win);
      } catch (e) {
        this.warn("LoginManagerPrompter: unable to find window id", e);
        resolve(false);
        return;
      }

      if (!winId) {
        resolve(false);
        return;
      }

      let [username, password] = this._GetAuthInfo(aAuthInfo);
      let isPasswordOnly =
        aAuthInfo.flags & Ci.nsIAuthInformation.ONLY_PASSWORD;
      let payload = {
        winId,
        text: this._getAuthMessage(aChannel, aAuthInfo),
        inputs: [],
      };

      if (!isPasswordOnly) {
        payload.inputs.push({
          type: "textbox",
          value: username || "",
          hint: "username",
          autofocus: true,
        });
      }
      payload.inputs.push({
        type: "password",
        value: password || "",
        hint: "password",
        autofocus: !!isPasswordOnly,
      });
      if (checkboxLabel) {
        payload.inputs.push({
          label: checkboxLabel,
          hint: "remember",
          checked: !!checkbox.value,
        });
      }

      let closed = false;
      let listener = {
        QueryInterface: ChromeUtils.generateQI(["nsIEmbedMessageListener"]),

        onMessageReceived: (messageName, message) => {
          if (closed) {
            return;
          }
          closed = true;
          Services.embedlite.removeMessageListener("authresponse", listener);

          let response;
          try {
            response = JSON.parse(message);
          } catch (e) {
            this.warn("LoginManagerPrompter: auth response parsing failed", e);
            resolve(false);
            return;
          }

          if (response.winId != winId || !response.accepted) {
            resolve(false);
            return;
          }

          let responseUsername =
            "username" in response ? response.username : username;
          this._SetAuthInfo(
            aAuthInfo,
            responseUsername || "",
            response.password || ""
          );
          if ("remember" in response) {
            checkbox.value = !!response.remember;
          }
          resolve(true);
        },
      };

      Services.embedlite.addMessageListener("authresponse", listener);
      try {
        Services.embedlite.sendAsyncMessage(
          winId,
          "embed:auth",
          JSON.stringify(payload)
        );
      } catch (e) {
        Services.embedlite.removeMessageListener("authresponse", listener);
        this.warn("LoginManagerPrompter: sending auth prompt failed", e);
        resolve(false);
      }
    });
  },

  __strBundle: null, // String bundle for L10N
  get _strBundle() {
    if (!this.__strBundle) {
      this.__strBundle = Services.strings.createBundle(
        "chrome://passwordmgr/locale/passwordmgr.properties"
      );
      if (!this.__strBundle) {
        throw new Error("String bundle for Login Manager not present!");
      }
    }

    return this.__strBundle;
  },

  __ellipsis: null,
  get _ellipsis() {
    if (!this.__ellipsis) {
      this.__ellipsis = "\u2026";
      try {
        this.__ellipsis = Services.prefs.getComplexValue(
          "intl.ellipsis",
          Ci.nsIPrefLocalizedString
        ).data;
      } catch (e) {}
    }
    return this.__ellipsis;
  },


  // Whether we are in private browsing mode
  get _inPrivateBrowsing() {
    if (this._chromeWindow) {
      return PrivateBrowsingUtils.isContentWindowPrivate(this._chromeWindow);
    }
    // If we don't that we're in private browsing mode if the caller did
    // not provide a window.  The callers which really care about this
    // will indeed pass down a window to us, and for those who don't,
    // we can just assume that we don't want to save the entered login
    // information.
    this.log("We have no chromeWindow so assume we're in a private context");
    return true;
  },

  get _allowRememberLogin() {
    if (!this._inPrivateBrowsing) {
      return true;
    }
    return lazy.LoginHelper.privateBrowsingCaptureEnabled;
  },

  /* ---------- nsIAuthPrompt prompts ---------- */

  /**
   * Wrapper around the prompt service prompt. Saving random fields here
   * doesn't really make sense and therefore isn't implemented.
   */
  prompt(
    aDialogTitle,
    aText,
    aPasswordRealm,
    aSavePassword,
    aDefaultText,
    aResult
  ) {
    if (aSavePassword != Ci.nsIAuthPrompt.SAVE_PASSWORD_NEVER) {
      throw new Components.Exception(
        "prompt only supports SAVE_PASSWORD_NEVER",
        Cr.NS_ERROR_NOT_IMPLEMENTED
      );
    }

    this.log("===== prompt() called =====");

    if (aDefaultText) {
      aResult.value = aDefaultText;
    }

    return Services.prompt.prompt(
      this._chromeWindow,
      aDialogTitle,
      aText,
      aResult,
      null,
      {}
    );
  },

  /**
   * Looks up a username and password in the database. Will prompt the user
   * with a dialog, even if a username and password are found.
   */
  async asyncPromptUsernameAndPassword(
    aDialogTitle,
    aText,
    aPasswordRealm,
    aSavePassword,
    aUsername,
    aPassword
  ) {
    this.log("===== asyncPromptUsernameAndPassword() called =====");

    if (aSavePassword == Ci.nsIAuthPrompt.SAVE_PASSWORD_FOR_SESSION) {
      throw new Components.Exception(
        "asyncPromptUsernameAndPassword doesn't support SAVE_PASSWORD_FOR_SESSION",
        Cr.NS_ERROR_NOT_IMPLEMENTED
      );
    }

    let foundLogins = null;
    let canRememberLogin = false;
    var selectedLogin = null;
    var [origin, realm, unused] = this._getRealmInfo(aPasswordRealm);

    // If origin is null, we can't save this login.
    if (origin) {
      if (this._allowRememberLogin) {
        canRememberLogin =
          aSavePassword == Ci.nsIAuthPrompt.SAVE_PASSWORD_PERMANENTLY &&
          Services.logins.getLoginSavingEnabled(origin);
      }

      foundLogins = await Services.logins.searchLoginsAsync({
        origin,
        httpRealm: realm,
      });

      // XXX Like the original code, we can't deal with multiple
      // account selection. (bug 227632)
      if (foundLogins.length) {
        selectedLogin = foundLogins[0];

        // If the caller provided a username, try to use it. If they
        // provided only a password, this will try to find a password-only
        // login (or return null if none exists).
        if (aUsername.value) {
          selectedLogin = this._repickSelectedLogin(
            foundLogins,
            aUsername.value
          );
        }

        if (selectedLogin) {
          aUsername.value = selectedLogin.username;
          // If the caller provided a password, prefer it.
          if (!aPassword.value) {
            aPassword.value = selectedLogin.password;
          }
        }
      }
    }

    let autofilled = !!aPassword.value;
    var ok = Services.prompt.promptUsernameAndPassword(
      this._chromeWindow,
      aDialogTitle,
      aText,
      aUsername,
      aPassword
    );

    if (!ok || !canRememberLogin) {
      return {
        ok,
        username: aUsername.value,
        password: aPassword.value,
      };
    }

    if (!aPassword.value) {
      this.log("No password entered, so won't offer to save.");
      return {
        ok,
        username: aUsername.value,
        password: aPassword.value,
      };
    }

    // XXX We can't prompt with multiple logins yet (bug 227632), so
    // the entered login might correspond to an existing login
    // other than the one we originally selected.
    selectedLogin = this._repickSelectedLogin(foundLogins, aUsername.value);

    // If we didn't find an existing login, or if the username
    // changed, save as a new login.
    let newLogin = new LoginInfo(
      origin,
      null,
      realm,
      aUsername.value,
      aPassword.value
    );
    if (!selectedLogin) {
      // add as new
      this.log("New login seen for " + realm);
      await Services.logins.addLoginAsync(newLogin);
    } else if (aPassword.value != selectedLogin.password) {
      // update password
      this.log("Updating password for  " + realm);
      await this._updateLogin(selectedLogin, newLogin);
    } else {
      this.log("Login unchanged, no further action needed.");
      await Services.logins.recordPasswordUseAsync(
        selectedLogin,
        this._inPrivateBrowsing,
        "PromptLogin",
        autofilled
      );
    }

    return {
      ok,
      username: aUsername.value,
      password: aPassword.value,
    };
  },

  /**
   * If a password is found in the database for the password realm, it is
   * returned straight away without displaying a dialog.
   *
   * If a password is not found in the database, the user will be prompted
   * with a dialog with a text field and ok/cancel buttons. If the user
   * allows it, then the password will be saved in the database.
   */
  async asyncPromptPassword(
    aDialogTitle,
    aText,
    aPasswordRealm,
    aSavePassword,
    aPassword
  ) {
    this.log("===== asyncPromptPassword() called =====");

    if (aSavePassword == Ci.nsIAuthPrompt.SAVE_PASSWORD_FOR_SESSION) {
      throw new Components.Exception(
        "asyncPromptPassword doesn't support SAVE_PASSWORD_FOR_SESSION",
        Cr.NS_ERROR_NOT_IMPLEMENTED
      );
    }

    var [origin, realm, username] = this._getRealmInfo(aPasswordRealm);

    username = decodeURIComponent(username);

    let canRememberLogin = false;
    // If origin is null, we can't save this login.
    if (origin && !this._inPrivateBrowsing) {
      canRememberLogin =
        aSavePassword == Ci.nsIAuthPrompt.SAVE_PASSWORD_PERMANENTLY &&
        Services.logins.getLoginSavingEnabled(origin);

      if (!aPassword.value) {
        var foundLogins = await Services.logins.searchLoginsAsync({
          origin,
          httpRealm: realm,
        });

        // XXX Like the original code, we can't deal with multiple
        // account selection (bug 227632). We can deal with finding the
        // account based on the supplied username - but in this case we'll
        // just return the first match.
        for (var i = 0; i < foundLogins.length; ++i) {
          if (foundLogins[i].username == username) {
            aPassword.value = foundLogins[i].password;
            // wallet returned straight away, so this mimics that code
            return {
              ok: true,
              password: aPassword.value,
            };
          }
        }
      }
    }

    var ok = Services.prompt.promptPassword(
      this._chromeWindow,
      aDialogTitle,
      aText,
      aPassword
    );

    if (ok && canRememberLogin && aPassword.value) {
      let newLogin = new LoginInfo(
        origin,
        null,
        realm,
        username,
        aPassword.value
      );

      this.log("New login seen for " + realm);

      await Services.logins.addLoginAsync(newLogin);
    }

    return {
      ok,
      password: aPassword.value,
    };
  },

  /* ---------- nsIAuthPrompt helpers ---------- */

  /**
   * Given aRealmString, such as "http://user@example.com/foo", returns an
   * array of:
   *   - the formatted origin
   *   - the realm (origin + path)
   *   - the username, if present
   *
   * If aRealmString is in the format produced by NS_GetAuthKey for HTTP[S]
   * channels, e.g. "example.com:80 (httprealm)", null is returned for all
   * arguments to let callers know the login can't be saved because we don't
   * know whether it's http or https.
   */
  _getRealmInfo(aRealmString) {
    var httpRealm = /^.+ \(.+\)$/;
    if (httpRealm.test(aRealmString)) {
      return [null, null, null];
    }

    var uri = Services.io.newURI(aRealmString);
    var pathname = "";

    if (uri.pathQueryRef != "/") {
      pathname = uri.pathQueryRef;
    }

    var formattedOrigin = this._getFormattedOrigin(uri);

    return [formattedOrigin, formattedOrigin + pathname, uri.username];
  },

  async promptAuthInternal(aChannel, aLevel, aAuthInfo) {
    var selectedLogin = null;
    var checkbox = { value: false };
    var checkboxLabel = null;
    var epicfail = false;
    var canAutologin = false;
    var notifyObj;
    var foundLogins;
    let autofilled = false;

    try {
      this.log("===== promptAuth called =====");

      // If the user submits a login but it fails, we need to remove the
      // notification prompt that was displayed. Conveniently, the user will
      // be prompted for authentication again, which brings us here.
      this._removeLoginNotifications();

      var [origin, httpRealm] = this._getAuthTarget(aChannel, aAuthInfo);

      // Looks for existing logins to prefill the prompt with.
      foundLogins = await Services.logins.searchLoginsAsync({
        origin,
        httpRealm,
        schemeUpgrades: lazy.LoginHelper.schemeUpgrades,
      });
      this.log("found", foundLogins.length, "matching logins.");
      let resolveBy = ["scheme", "timePasswordChanged"];
      foundLogins = lazy.LoginHelper.dedupeLogins(
        foundLogins,
        ["username"],
        resolveBy,
        origin
      );
      this.log(foundLogins.length, "matching logins remain after deduping");

      // XXX Can't select from multiple accounts yet. (bug 227632)
      if (foundLogins.length) {
        selectedLogin = foundLogins[0];
        this._SetAuthInfo(
          aAuthInfo,
          selectedLogin.username,
          selectedLogin.password
        );
        autofilled = true;

        // Allow automatic proxy login
        if (
          aAuthInfo.flags & Ci.nsIAuthInformation.AUTH_PROXY &&
          !(aAuthInfo.flags & Ci.nsIAuthInformation.PREVIOUS_FAILED) &&
          Services.prefs.getBoolPref("signon.autologin.proxy") &&
          /* TODO: Check if this should be !this._inPrivateBrowsing */
          !PrivateBrowsingUtils.permanentPrivateBrowsing
        ) {
          this.log("Autologin enabled, skipping auth prompt.");
          canAutologin = true;
        }

        checkbox.value = true;
      }

      var canRememberLogin = Services.logins.getLoginSavingEnabled(origin);
      if (!this._allowRememberLogin) {
        this.log("LOGIN: can't remember password.");
        canRememberLogin = false;
      }

      // if checkboxLabel is null, the checkbox won't be shown at all.
      this.log("LOGIN: Checking popup note.");
      notifyObj = this._getPopupNote();
      this.log("LOGIN: Popup note: " + notifyObj);
      if (canRememberLogin && !notifyObj) {
        // Localisation happens in the QML front end, so we don't use _getLocalizedString()
        checkboxLabel = "rememberPassword";
      }
    } catch (e) {
      // Ignore any errors and display the prompt anyway.
      epicfail = true;
      Cu.reportError(
        "LoginManagerAuthPrompter: Epic fail in promptAuth: " + e + "\n"
      );
    }

    var ok = canAutologin;
    let browser = this._browser;
    let baseDomain;

    // We might not have a browser or browser.currentURI.host could fail
    // (e.g. on about:blank). Fall back to the subresource hostname in that case.
    try {
      let topLevelHost = browser.currentURI.host;
      baseDomain = PromptAbuseHelper.getBaseDomainOrFallback(topLevelHost);
    } catch (e) {
      baseDomain = PromptAbuseHelper.getBaseDomainOrFallback(origin);
    }

    if (!ok) {
      if (PromptAbuseHelper.hasReachedAbuseLimit(baseDomain, browser)) {
        this.log("Blocking auth dialog, due to exceeding dialog bloat limit");
        return false;
      }

      // Set up a counter for ensuring that the basic auth prompt can not
      // be abused for DOS-style attacks. With this counter, each eTLD+1
      // per browser will get a limited number of times a user can
      // cancel the prompt until we stop showing it.
      PromptAbuseHelper.incrementPromptAbuseCounter(baseDomain, browser);

      if (this._chromeWindow) {
        PromptUtils.fireDialogEvent(
          this._chromeWindow,
          "DOMWillOpenModalDialog",
          this._browser
        );
      }

      ok = await this._promptAuth(
        aChannel,
        aLevel,
        aAuthInfo,
        checkboxLabel,
        checkbox
      );
    }

    let [username, password] = this._GetAuthInfo(aAuthInfo);

    // Reset the counter state if the user replied to a prompt and actually
    // tried to login (vs. simply clicking any button to get out).
    if (ok && (username || password)) {
      PromptAbuseHelper.resetPromptAbuseCounter(baseDomain, browser);
    }

    // If there's a notification prompt, use it to allow the user to
    // determine if the login should be saved. If there isn't a
    // notification prompt, only save the login if the user set the
    // checkbox to do so.
    var rememberLogin = notifyObj ? canRememberLogin : checkbox.value;
    if (!ok || !rememberLogin || epicfail) {
      return ok;
    }

    try {
      if (!password) {
        this.log("No password entered, so won't offer to save.");
        return ok;
      }

      // XXX We can't prompt with multiple logins yet (bug 227632), so
      // the entered login might correspond to an existing login
      // other than the one we originally selected.
      selectedLogin = this._repickSelectedLogin(foundLogins, username);

      // If we didn't find an existing login, or if the username
      // changed, save as a new login.
      let newLogin = new LoginInfo(origin, null, httpRealm, username, password);
      if (!selectedLogin) {
        this.log(
          "New login seen for " +
            username +
            " @ " +
            origin +
            " (" +
            httpRealm +
            ")"
        );

        if (notifyObj) {
          this._showSaveLoginNotification(this._chromeWindow, newLogin);
        } else {
          await Services.logins.addLoginAsync(newLogin);
        }
      } else if (password != selectedLogin.password) {
        this.log(
          "Updating password for " +
            username +
            " @ " +
            origin +
            " (" +
            httpRealm +
            ")"
        );
        if (notifyObj) {
          this._showChangeLoginNotification(this._chromeWindow, selectedLogin, newLogin);
        } else {
          await this._updateLogin(selectedLogin, newLogin);
        }
      } else {
        this.log("Login unchanged, no further action needed.");
        await Services.logins.recordPasswordUseAsync(
          selectedLogin,
          this._inPrivateBrowsing,
          "AuthLogin",
          autofilled
        );
      }
    } catch (e) {
      Cu.reportError("LoginManagerAuthPrompter: Fail2 in promptAuth: " + e);
    }

    return ok;
  },

  /* ---------- nsIAuthPrompt2 prompts ---------- */

  /**
   * Implementation of nsIAuthPrompt2.
   *
   * @param {nsIChannel} aChannel
   * @param {int}        aLevel
   * @param {nsIAuthInformation} aAuthInfo
   */
  promptAuth(aChannel, aLevel, aAuthInfo) {
    let closed = false;
    let result = false;
    this.promptAuthInternal(aChannel, aLevel, aAuthInfo)
      .then(ok => (result = ok))
      .finally(() => (closed = true));
    Services.tm.spinEventLoopUntilOrQuit(
      "LoginManagerAuthPrompter.jsm:promptAuth",
      () => closed
    );
    return result;
  },

  asyncPromptAuth(aChannel, aCallback, aContext, aLevel, aAuthInfo) {
    var cancelable = null;

    try {
      this.log("===== asyncPromptAuth called =====");

      // If the user submits a login but it fails, we need to remove the
      // notification prompt that was displayed. Conveniently, the user will
      // be prompted for authentication again, which brings us here.
      this._removeLoginNotifications();

      cancelable = this._newAsyncPromptConsumer(aCallback, aContext);

      let [origin, httpRealm] = this._getAuthTarget(aChannel, aAuthInfo);

      let hashKey = aLevel + "|" + origin + "|" + httpRealm;
      this.log("Async prompt key = " + hashKey);
      let pendingPrompt = this._factory.getPendingPrompt(
        this._browser,
        hashKey
      );
      if (pendingPrompt) {
        this.log(
          "Prompt bound to an existing one in the queue, callback = " +
            aCallback
        );
        pendingPrompt.consumers.push(cancelable);
        return cancelable;
      }

      this.log("Adding new async prompt, callback = " + aCallback);
      let asyncPrompt = {
        consumers: [cancelable],
        channel: aChannel,
        authInfo: aAuthInfo,
        level: aLevel,
        prompter: this,
      };

      this._factory._doAsyncPrompt(asyncPrompt, hashKey);
    } catch (e) {
      Cu.reportError(
        "LoginManagerAuthPrompter: " +
          "asyncPromptAuth: " +
          e +
          "\nFalling back to promptAuth\n"
      );
      // Fail the prompt operation to let the consumer fall back
      // to synchronous promptAuth method
      throw e;
    }

    return cancelable;
  },

  /* ---------- nsILoginManagerAuthPrompter prompts ---------- */

  init(aWindow = null, aFactory = null) {
    if (!aWindow) {
      // There may be no applicable window e.g. in a Sandbox or JSM.
      this._chromeWindow = null;
      this._browser = null;
    } else if (aWindow.isChromeWindow) {
      this._chromeWindow = aWindow;
      // needs to be set explicitly using setBrowser
      this._browser = null;
    } else {
      let chrome = this._getChromeWindow(aWindow);
      if (chrome) {
        this._chromeWindow = chrome.win;
        this._browser = chrome.browser;
      } else {
        this.log("LOGIN: unable to find chrome window, using prompt window");
        this._chromeWindow = aWindow;
        this._browser = null;
      }
    }
    this._openerBrowser = null;
    this._factory = aFactory || null;

    this.log("JSComp: LoginManagerPrompter initialized");
    this.log("LOGIN: aWindow: " + aWindow);
  },

  set browser(aBrowser) {
    this._browser = aBrowser;
  },

  get browser() {
    return this._browser;
  },

  set openerBrowser(aOpenerBrowser) {
    this._openerBrowser = aOpenerBrowser;
  },

  _removeLoginNotifications() {
    var popupNote = this._getPopupNote();
    if (popupNote) {
      popupNote = popupNote.getNotification("password");
    }
    if (popupNote) {
      popupNote.remove();
    }
  },

  /**
   * Ask the user if they want to save a login (Yes, Never, Not Now)
   *
   * @param aBrowser
   *        The browser of the webpage request that triggered the prompt.
   * @param aLogin
   *        The login to be saved.
   * @param dismissed (optional)
   *        A boolean value indicating whether the save logins doorhanger should
   *        be dismissed automatically when shown.
   * @param notifySaved (optional)
   *        A boolean value indicating whether the notification should indicate that
   *        a login has been saved
   * @param autoFilledLoginGuid (optional)
   *        A string guid value for the login which was autofilled into the form
   */
  promptToSavePassword(
    aBrowser,
    aLogin,
    dismissed = false,
    notifySaved = false,
    autoFilledLoginGuid = "",
    possibleValues = {}
  ) {
    this.log("promptToSavePassword");
    this._showSaveLoginNotification(aBrowser, aLogin);
    //Services.obs.notifyObservers(aLogin, "passwordmgr-prompt-save");
  },

  /**
   * Called when we think we detect a password or username change for
   * an existing login, when the form being submitted contains multiple
   * password fields.
   *
   * @param {Element} aBrowser
   *                  The browser element that the request came from.
   * @param {nsILoginInfo} aOldLogin
   *                       The old login we may want to update.
   * @param {nsILoginInfo} aNewLogin
   *                       The new login from the page form.
   * @param {boolean} [dismissed = false]
   *                  If the prompt should be automatically dismissed on being shown.
   * @param {boolean} [notifySaved = false]
   *                  Whether the notification should indicate that a login has been saved
   * @param {string} [autoSavedLoginGuid = ""]
   *                 A guid value for the old login to be removed if the changes match it
   *                 to a different login
   */
  promptToChangePassword(
    aBrowser,
    aOldLogin,
    aNewLogin,
    dismissed = false,
    notifySaved = false,
    autoSavedLoginGuid = "",
    autoFilledLoginGuid = "",
    possibleValues = {}
  ) {
    this.log("promptToChangePassword");
    this._showChangeLoginNotification(aBrowser, aOldLogin, aNewLogin);
  },

  /**
   * Ask the user if they want to change the password for one of
   * multiple logins, when the caller can't determine exactly which
   * login should be changed. If the user consents, modifyLogin() will
   * be called.
   *
   * @param aBrowser
   *        The browser of the webpage request that triggered the prompt.
   * @param logins
   *        An array of existing logins.
   * @param aNewLogin
   *        The new login.
   *
   * Note: Because the caller does not know the username of the login
   *       to be changed, aNewLogin.username and aNewLogin.usernameField
   *       will be set (using the user's selection) before modifyLogin()
   *       is called.
   */
  promptToChangePasswordWithUsernames(aBrowser, logins, aNewLogin) {
    this.log("promptToChangePasswordWithUsernames");

    // We reuse the existing message, even if it expects a username, until we
    // switch to the final terminology in bug 1144856.
    var displayHost = aNewLogin.displayOrigin;
    var notificationTextBundle = ["passwordChangeTitle"];
    var usernames = logins.map(l => this._sanitizeUsername(l.username));
    var dialogTextBundle  = ["userSelectText2"];

    var formData = {
      "textBundle": dialogTextBundle
    };

    // The callbacks in |buttons| have a closure to access the variables
    // in scope here.
    var self = this;

    var buttons = [
      // "Yes" button
      {
        label: "notifyBarUpdateButtonText",
        accessKey: "notifyBarUpdateButtonAccessKey",
        popup: null,
        callback: function(aButton, selectedIndex) {
          // Now that we know which login to use, modify its password.
          var selectedLogin = logins[selectedIndex];


          var newLoginWithUsername = Cc[
            "@mozilla.org/login-manager/loginInfo;1"
          ].createInstance(Ci.nsILoginInfo);
          newLoginWithUsername.init(
            aNewLogin.origin,
            aNewLogin.formActionOrigin,
            aNewLogin.httpRealm,
            selectedLogin.username,
            aNewLogin.password,
            selectedLogin.usernameField,
            aNewLogin.passwordField
          );
          self._updateLogin(selectedLogin, newLoginWithUsername).catch(
            Cu.reportError
          );
        }
      },

      // "No" button
      {
        label: "notifyBarDontChangeButtonText",
        accessKey: "notifyBarDontChangeButtonAccessKey",
        popup: null,
        callback: function(aButton) {
          // do nothing
        }
      }
    ];

    this._showLoginNotification(aBrowser, "password-update-multiuser", notificationTextBundle,
                                buttons, formData);
  },

  onMessageReceived(messageName, message) {
    this.log("LoginManagerPrompter.js on message received: top:", messageName, ", msg:", message);
    var ret = JSON.parse(message);
    // Send Request
    if (!ret.id) {
      this.warn("LoginManagerPrompter.js: Request id not defined in response");
      return;
    }
    let request = this._pendingRequests[ret.id];
    if (!request) {
      this.warn("LoginManagerPrompter.js: Wrong request id:", ret.id);
      return;
    }
    let selectedIndex = ret.selectedIndex || 0;
    request[ret.buttonidx].callback(ret.buttonidx, selectedIndex);
    Services.embedlite.removeMessageListener("embedui:login", this);
    delete this._pendingRequests[ret.id];
  },

  /* ---------- Internal Methods (LoginManagerAuthPrompter) ---------- */

  /**
   * Shows the Change Password notification bar or popup notification.
   *
   * @param aBrowser
   *        The browser of the webpage request that triggered the prompt.
   * @param aOldLogin
   *        The stored login we want to update.
   * @param aNewLogin
   *        The login object with the changes we want to make.
   */
  _showChangeLoginNotification(aBrowser, aOldLogin, aNewLogin) {
    // We reuse the existing message, even if it expects a username, until we
    // switch to the final terminology in bug 1144856.
    var displayHost = aOldLogin.displayOrigin;
    var notificationTextBundle;
    var formData = {
      "displayHost": displayHost
    };
    if (aOldLogin.username) {
      var displayUser = this._sanitizeUsername(aOldLogin.username);
      notificationTextBundle = ["updatePasswordMsg", displayUser];
      formData["displayUser"] = displayUser;
    } else {
      notificationTextBundle = ["updatePasswordMsgNoUser"];
    }

    // The callbacks in |buttons| have a closure to access the variables
    // in scope here.
    var self = this;

    var buttons = [
      // "Yes" button
      {
        label: "notifyBarUpdateButtonText",
        accessKey: "notifyBarUpdateButtonAccessKey",
        popup: null,
        callback: function(aButton) {
          self._updateLogin(aOldLogin, aNewLogin).catch(Cu.reportError);
        }
      },

      // "No" button
      {
        label: "notifyBarDontChangeButtonText",
        accessKey: "notifyBarDontChangeButtonAccessKey",
        popup: null,
        callback: function(aButton) {
          // do nothing
        }
      }
    ];

    this._showLoginNotification(aBrowser, "password-change", notificationTextBundle,
                                buttons, formData);

    let oldGUID = aOldLogin.QueryInterface(Ci.nsILoginMetaInfo).guid;
    Services.obs.notifyObservers(
      aNewLogin,
      "passwordmgr-prompt-change",
      oldGUID
    );
  },

  /**
   * Given a content DOM window, returns the chrome window and browser it's in.
   */
  _getChromeWindow(aWindow) {
    let browser = aWindow.docShell.chromeEventHandler;
    if (!browser) {
      return null;
    }

    let chromeWin = browser.ownerGlobal;
    if (!chromeWin) {
      return null;
    }

    return { win: chromeWin, browser };
  },

  _getNotifyWindow() {
    if (this._openerBrowser) {
      let chromeDoc = this._chromeWindow.document.documentElement;

      // Check to see if the current window was opened with chrome
      // disabled, and if so use the opener window. But if the window
      // has been used to visit other pages (ie, has a history),
      // assume it'll stick around and *don't* use the opener.
      if (chromeDoc.getAttribute("chromehidden") && !this._browser.canGoBack) {
        this.log("Using opener window for notification prompt.");
        return {
          win: this._openerBrowser.ownerGlobal,
          browser: this._openerBrowser,
        };
      }
    }

    return {
      win: this._chromeWindow,
      browser: this._browser,
    };
  },

  /**
   * Returns the popup notification to this prompter,
   * or null if there isn't one available.
   */
  _getPopupNote() {
    let popupNote = null;

    try {
      let { win: notifyWin } = this._getNotifyWindow();

      // .wrappedJSObject needed here -- see bug 422974 comment 5.
      popupNote = notifyWin.wrappedJSObject.PopupNotifications;
    } catch (e) {
      this.log("Popup notifications not available on window");
    }

    return popupNote;
  },

  /**
   * The user might enter a login that isn't the one we prefilled, but
   * is the same as some other existing login. So, pick a login with a
   * matching username, or return null.
   */
  _repickSelectedLogin(foundLogins, username) {
    for (var i = 0; i < foundLogins.length; i++) {
      if (foundLogins[i].username == username) {
        return foundLogins[i];
      }
    }
    return null;
  },

  /**
   * Sanitizes the specified username, by stripping quotes and truncating if
   * it's too long. This helps prevent an evil site from messing with the
   * "save password?" prompt too much.
   */
  _sanitizeUsername(username) {
    if (username.length > 30) {
      username = username.substring(0, 30);
      username += this._ellipsis;
    }
    return username.replace(/['"]/g, "");
  },

  /**
   * Returns the origin and realm for which authentication is being
   * requested, in the format expected to be used with nsILoginInfo.
   */
  _getAuthTarget(aChannel, aAuthInfo) {
    var origin, realm;

    // If our proxy is demanding authentication, don't use the
    // channel's actual destination.
    if (aAuthInfo.flags & Ci.nsIAuthInformation.AUTH_PROXY) {
      this.log("getAuthTarget is for proxy auth");
      if (!(aChannel instanceof Ci.nsIProxiedChannel)) {
        throw new Error("proxy auth needs nsIProxiedChannel");
      }

      var info = aChannel.proxyInfo;
      if (!info) {
        throw new Error("proxy auth needs nsIProxyInfo");
      }

      // Proxies don't have a scheme, but we'll use "moz-proxy://"
      // so that it's more obvious what the login is for.
      var idnService = Cc["@mozilla.org/network/idn-service;1"].getService(
        Ci.nsIIDNService
      );
      origin =
        "moz-proxy://" +
        idnService.convertUTF8toACE(info.host) +
        ":" +
        info.port;
      realm = aAuthInfo.realm;
      if (!realm) {
        realm = origin;
      }

      return [origin, realm];
    }

    origin = this._getFormattedOrigin(aChannel.URI);

    // If a HTTP WWW-Authenticate header specified a realm, that value
    // will be available here. If it wasn't set or wasn't HTTP, we'll use
    // the formatted origin instead.
    realm = aAuthInfo.realm;
    if (!realm) {
      realm = origin;
    }

    return [origin, realm];
  },

  /**
   * Returns [username, password] as extracted from aAuthInfo (which
   * holds this info after having prompted the user).
   *
   * If the authentication was for a Windows domain, we'll prepend the
   * return username with the domain. (eg, "domain\user")
   */
  _GetAuthInfo(aAuthInfo) {
    var username, password;

    var flags = aAuthInfo.flags;
    if (flags & Ci.nsIAuthInformation.NEED_DOMAIN && aAuthInfo.domain) {
      username = aAuthInfo.domain + "\\" + aAuthInfo.username;
    } else {
      username = aAuthInfo.username;
    }

    password = aAuthInfo.password;

    return [username, password];
  },

  /**
   * Given a username (possibly in DOMAIN\user form) and password, parses the
   * domain out of the username if necessary and sets domain, username and
   * password on the auth information object.
   */
  _SetAuthInfo(aAuthInfo, username, password) {
    var flags = aAuthInfo.flags;
    if (flags & Ci.nsIAuthInformation.NEED_DOMAIN) {
      // Domain is separated from username by a backslash
      var idx = username.indexOf("\\");
      if (idx == -1) {
        aAuthInfo.username = username;
      } else {
        aAuthInfo.domain = username.substring(0, idx);
        aAuthInfo.username = username.substring(idx + 1);
      }
    } else {
      aAuthInfo.username = username;
    }
    aAuthInfo.password = password;
  },

  _newAsyncPromptConsumer(aCallback, aContext) {
    return {
      QueryInterface: ChromeUtils.generateQI(["nsICancelable"]),
      callback: aCallback,
      context: aContext,
      cancel() {
        this.callback.onAuthCancelled(this.context, false);
        this.callback = null;
        this.context = null;
      },
    };
  },

  /* ---------- Internal Methods (shared) ---------- */

  async _updateLogin(login, aNewLogin) {
    var now = Date.now();
    var propBag = Cc["@mozilla.org/hash-property-bag;1"].createInstance(
      Ci.nsIWritablePropertyBag
    );
    propBag.setProperty("formActionOrigin", aNewLogin.formActionOrigin);
    propBag.setProperty("origin", aNewLogin.origin);
    propBag.setProperty("password", aNewLogin.password);
    propBag.setProperty("username", aNewLogin.username);
    // Explicitly set the password change time here (even though it would
    // be changed automatically), to ensure that it's exactly the same
    // value as timeLastUsed.
    propBag.setProperty("timePasswordChanged", now);
    propBag.setProperty("timeLastUsed", now);
    propBag.setProperty("timesUsedIncrement", 1);
    // Note that we don't call `recordPasswordUseAsync` so telemetry won't record a
    // use in this case though that is normally correct since we would instead
    // record the save/update in a separate probe and recording it in both would
    // be wrong.
    await Services.logins.modifyLoginAsync(login, propBag);
  },

  /**
   * The aURI parameter may either be a string uri, or an nsIURI instance.
   *
   * Returns the origin to use in a nsILoginInfo object (for example,
   * "http://example.com").
   */
  _getFormattedOrigin(aURI) {
    let uri;
    if (aURI instanceof Ci.nsIURI) {
      uri = aURI;
    } else {
      uri = Services.io.newURI(aURI);
    }

    return uri.scheme + "://" + uri.displayHostPort;
  },
    
  /* ---------- Internal Methods (new) ---------- */

  /**
   * Displays a notification bar.
   */
  _showLoginNotification(aBrowser, aName, aTextBundle, aButtons, aFormData) {
    this.log("Adding new " + aName + " notification bar");

    // The page we're going to hasn't loaded yet, so we want to persist
    // across the first location change.
    let logoptions = {
      persistWhileVisible: true,
      timeout: Date.now() + 10000
    }

    Services.embedlite.addMessageListener("embedui:login", this);
    try {
      // Form prompts carry the browser element, including for remote tabs.
      // Internal HTTP-auth callers may still supply a DOM window.
      let winid = aBrowser?.ownerDocument && aBrowser.browsingContext
        ? Services.embedlite.getIDByBrowsingContext(aBrowser.browsingContext)
        : Services.embedlite.getIDByWindow(aBrowser?.top || null);
      let uniqueid = this._getRandomId();
      Services.embedlite.sendAsyncMessage(winid, "embed:login",
                                          JSON.stringify({
                                                           name: aName,
                                                           textBundle: aTextBundle,
                                                           buttons: aButtons,
                                                           options: logoptions,
                                                           id: uniqueid,
                                                           formdata: aFormData
                                                         }));
      this._pendingRequests[uniqueid] = aButtons;
    } catch (e) {
      Logger.warn("LoginManagerPrompter: sending async message failed", e)
    }
  },

  /**
   * Displays a notification bar or a popup notification, to allow the user
   * to save the specified login. This allows the user to see the results of
   * their login, and only save a login which they know worked.
   *
   * @param aLogin
   *        The login captured from the form.
   */
  _showSaveLoginNotification(aBrowser, aLogin) {
    var displayHost = aLogin.displayOrigin;
    var notificationTextBundle = ["rememberPasswordMsgNoUsername", displayHost];
    var formData = {
      "displayHost": displayHost
    };
    if (aLogin.username) {
      var displayUser = this._sanitizeUsername(aLogin.username);
      formData["displayUser"] = displayUser;
      notificationTextBundle = ["rememberPasswordMsg", displayUser, displayHost];
    }

    var buttons = [
      // "Remember" button
      {
        label: "notifyBarRememberPasswordButtonText",
        accessKey: "notifyBarRememberPasswordButtonAccessKey",
        popup: null,
        callback: function(aButton) {
          Services.logins.addLoginAsync(aLogin).catch(Cu.reportError);
        }
      },

      // "Never for this site" button
      {
        label: "notifyBarNeverRememberButtonText",
        accessKey: "notifyBarNeverRememberButtonAccessKey",
        popup: null,
        callback: function(aButton) {
          Services.logins.setLoginSavingEnabled(aLogin.hostname, false);
        }
      },

      // "Not now" button
      {
        label: "notifyBarNotNowButtonText",
        accessKey: "notifyBarNotNowButtonAccessKey",
        popup: null,
        callback: function() { /* NOP */ }
      }
    ];

    this._showLoginNotification(aBrowser, "password-save", notificationTextBundle,
                                buttons, formData);

    Services.obs.notifyObservers(aLogin, "passwordmgr-prompt-save", null);
  },


}; // end of LoginManagerPrompter implementation

ChromeUtils.defineLazyGetter(LoginManagerPrompter.prototype, "log", () => {
  let logger = Logger
  return logger.debug.bind(logger);
});

ChromeUtils.defineLazyGetter(LoginManagerPrompter.prototype, "warn", () => {
  let logger = Logger
  return logger.warn.bind(logger);
});
