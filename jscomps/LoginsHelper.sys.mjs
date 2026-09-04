/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2021 Open Mobile Platform LLC.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

const { XPCOMUtils } = ChromeUtils.importESModule("resource://gre/modules/XPCOMUtils.sys.mjs");

XPCOMUtils.defineLazyServiceGetter(Services, "embedlite",
                                    "@mozilla.org/embedlite-app-service;1",
                                    Ci.nsIEmbedAppService);

const loggerScope = {};
Services.scriptloader.loadSubScript(
  "chrome://embedlite/content/Logger.js",
  loggerScope
);
const { Logger } = loggerScope;

const LoginInfo = Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
                                         "nsILoginInfo", "init");

export function LoginsHelper() {
  Logger.debug("JSComp: LoginsHelper.js loaded");
}

LoginsHelper.prototype = {
  classID: Components.ID("{aa0eeee6-5e1e-46a1-8b54-fbdd7cdb6e81}"),

  QueryInterface: ChromeUtils.generateQI([Ci.nsIObserver]),

  __pwmgr : null, // Password Manager service
  get _pwmgr() {
    if (!this.__pwmgr)
      this.__pwmgr = Cc["@mozilla.org/login-manager;1"].
                     getService(Ci.nsILoginManager);
    return this.__pwmgr;
  },

  observe: function(aSubject, aTopic, aData) {
    switch (aTopic) {
    case "app-startup":
      Services.obs.addObserver(this, "embedui:logins", false);
      break;
    case "embedui:logins":
      var data = JSON.parse(aData);
      switch (data.action) {
      case "getall":
        this._getAllLogins().catch(Cu.reportError);
        break;
      case "modify":
        this._modifyLogin(data).catch(Cu.reportError);
        break;
      case "remove":
        this._removeLogin(data).catch(Cu.reportError);
        break;
      case "add":
        this._addLogin(data).catch(Cu.reportError);
        break;
      case "removeAll":
        this._removeAll().catch(Cu.reportError);
        break;
      }
      break;
    }
  },

  _loginFromJson: function (aJson) {
    return new LoginInfo(aJson.hostname,
                         aJson.formSubmitURL,
                         aJson.httpRealm,
                         aJson.username,
                         aJson.password,
                         aJson.usernameField,
                         aJson.passwordField);
  },

  _getAllLogins: async function () {
    Logger.debug("LoginsHelper, requested all logins");

    // getAllLogins() returns {nsILoginInfo[]}
    // If there are no logins, the array is empty.
    var users = await this._pwmgr.getAllLogins();
    var allLogins = [];
    for (var i = 0; i < users.length; ++i) {
      allLogins.push({
        hostname: users[i].hostname,
        formSubmitURL: users[i].formSubmitURL,
        httpRealm: users[i].httpRealm,
        username: users[i].username,
        password: users[i].password,
        usernameField: users[i].usernameField,
        passwordField: users[i].passwordField
      });
    }
    Services.obs.notifyObservers(null, "embed:all-logins",
                                 JSON.stringify(allLogins));
  },

  _modifyLogin: async function (aData) {
    Logger.debug("LoginsHelper, modify login");

    var oldInfo = this._loginFromJson(aData.oldinfo);
    var newInfo = this._loginFromJson(aData.newinfo);
    await this._pwmgr.modifyLoginAsync(oldInfo, newInfo);
  },

  _removeLogin: async function (aData) {
    Logger.debug("LoginsHelper, remove login");

    var loginInfo = this._loginFromJson(aData.login);
    await this._pwmgr.removeLoginAsync(loginInfo);
  },

  // Needed for the sailfish-browser unit tests
  _addLogin: async function (aData) {
    Logger.debug("LoginsHelper, add login");

    var newInfo = this._loginFromJson(aData.newinfo);
    await this._pwmgr.addLoginAsync(newInfo);
  },

  // Needed for the sailfish-browser unit tests
  _removeAll: async function () {
    Logger.debug("LoginsHelper, remove all logins");

    await this._pwmgr.removeAllUserFacingLoginsAsync();
  },
};
