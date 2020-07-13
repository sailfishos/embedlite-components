/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Copyright (c) 2020 Open Mobile Platform LLC. */

const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyServiceGetter(Services, "embedlite",
                                    "@mozilla.org/embedlite-app-service;1",
                                    "nsIEmbedAppService");

Services.scriptloader.loadSubScript("chrome://embedlite/content/Logger.js");

const kPermission = {
  "unknown": Services.perms.UNKNOWN_ACTION,
  "allow": Services.perms.ALLOW_ACTION,
  "deny": Services.perms.DENY_ACTION,
  "prompt": Services.perms.PROMPT_ACTION
}
var kPermissionRev = new Map(Array.from(kPermission.entries()).reverse());

function ContentPermissionManager() {
  Logger.debug("JSComp: ContentPermissionManager.js loaded");
}

function debug(msg) {
  Logger.debug("PermissionManager:", msg);
}

function sendResult(topic, result) {
  Services.obs.notifyObservers(null, topic, JSON.stringify(result));
}

ContentPermissionManager.prototype = {
  classID: Components.ID("{86d354c6-81bc-4eb5-82c3-4c9859586165}"),

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),

  observe: function(aSubject, aTopic, aData) {
      switch (aTopic) {
      case "app-startup":
          Services.obs.addObserver(this, "embedui:perms", false);
          break;
      case "embedui:perms":
          var data = JSON.parse(aData);

          switch (data.msg) {
          case "get-all":
              let permissionList = [];
              let iterator = Services.perms.enumerator;
              while (iterator.hasMoreElements()) {
                  let permission = iterator.getNext().QueryInterface(Ci.nsIPermission);
                  let capability = kPermissionRev.get(permission.capability);
                  permissionList.push({
                                  type: permission.type,
                                  uri: permission.principal.origin,
                                  capability: capability
                              })
              }
              sendResult("embed:perms:all", permissionList);
              break;
          case "get-all-for-uri":
              let result = [];
              let permissions = Services.perms.getAllForURI(Services.io.newURI(data.uri, null, null));
              while (permissions.hasMoreElements()) {
                  let permission = permissions.getNext().QueryInterface(Ci.nsIPermission);
                  let capability = kPermissionRev.get(permission.capability);
                  result.push({
                                  type: permission.type,
                                  uri: data.uri,
                                  capability: capability
                              });
              }
              sendResult("embed:perms:all-for-uri", result);
              break;
          case "add":
              Services.perms.add(Services.io.newURI(data.uri, null, null),
                                 data.type, kPermission[data.permission]);
              debug("set, uri: " + data.uri
                    + ", type: " + data.type
                    + ", permission: " + data.permission);
              break;
          case "remove":
              Services.perms.remove(Services.io.newURI(data.uri, null, null), data.type);
              debug("remove type: " + data.type + ", for uri: " + data.uri);
              break;
          case "remove-all":
              Services.perms.removeAll();
              debug("remove all permissions");
              break;
          }
          break;
      }
  }
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([ContentPermissionManager]);
