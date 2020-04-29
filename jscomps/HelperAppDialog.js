/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

const PREF_BD_USEDOWNLOADDIR = "browser.download.useDownloadDir";
const URI_GENERIC_ICON_DOWNLOAD = "drawable://alert_download";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");

// -----------------------------------------------------------------------
// HelperApp Launcher Dialog
// -----------------------------------------------------------------------

function HelperAppLauncherDialog() { }

HelperAppLauncherDialog.prototype = {
  classID: Components.ID("{e9d277a0-268a-4ec2-bb8c-10fdf3e44611}"),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIHelperAppLauncherDialog]),

  show: function hald_show(aLauncher, aContext, aReason) {
    // Check to see if we can open this file or not
    dump("HelperAppLauncherDialog show\n");

    // See nsIMIMEInfo.idl, nsIExternalHelperAppService and uriloader/exthandler/nsExternalHelperAppService.cpp
    // For now save them all.

//    if (aLauncher.MIMEInfo.hasDefaultHandler) {
//      aLauncher.MIMEInfo.preferredAction = Ci.nsIMIMEInfo.useSystemDefault;
//      aLauncher.launchWithApplication(null, false);
//    }
    aLauncher.saveToDisk(null, false);
  },

  promptForSaveToFileAsync: function hald_promptForSaveToFileAsync(aLauncher, aWindowContext, aDefaultFileName,
                                  aSuggestedFileExtension,
                                  aForcePrompt) {
    dump("HelperAppLauncherDialog promptForSaveToFileAsync\n");

    // Even if aForcePrompt is set, we don't know what to do with it, so just ignore it
    Task.spawn(function* () {
      let file = null;
      try {
        let dnldMgr = Cc["@mozilla.org/download-manager;1"].getService(Ci.nsIDownloadManager);
        let defaultFolder = dnldMgr.userDownloadsDirectory;

        file = this.validateLeafName(defaultFolder, aDefaultFileName, aSuggestedFileExtension);
      } finally {
        // The file argument will be null in case any exception occurred.
        aLauncher.saveDestinationAvailable(file);
      }
    }.bind(this)).catch(Cu.reportError);
  },

  promptForSaveToFile: function hald_promptForSaveToFile(aLauncher, aContext, aDefaultFile, aSuggestedFileExt, aForcePrompt) {
    dump("HelperAppLauncherDialog promptForSaveToFile -- not supported\n");
    throw Cr.NS_ERROR_NOT_AVAILABLE;
  },

  validateLeafName: function hald_validateLeafName(aLocalFile, aLeafName, aFileExt) {
    dump("HelperAppLauncherDialog validateLeafName\n");

    if (!(aLocalFile && this.isUsableDirectory(aLocalFile)))
      return null;

    // Remove any leading periods, since we don't want to save hidden files
    // automatically.
    aLeafName = aLeafName.replace(/^\.+/, "");

    if (aLeafName == "")
      aLeafName = "unnamed" + (aFileExt ? "." + aFileExt : "");
    aLocalFile.append(aLeafName);

    this.makeFileUnique(aLocalFile);
    return aLocalFile;
  },

  makeFileUnique: function hald_makeFileUnique(aLocalFile) {
    dump("HelperAppLauncherDialog makeFileUnique\n");
    try {
      // Note - this code is identical to that in
      //   toolkit/content/contentAreaUtils.js.
      // If you are updating this code, update that code too! We can't share code
      // here since this is called in a js component.
      var collisionCount = 0;
      while (aLocalFile.exists()) {
        collisionCount++;
        if (collisionCount == 1) {
          // Append "(2)" before the last dot in (or at the end of) the filename
          // special case .ext.gz etc files so we don't wind up with .tar(2).gz
          if (aLocalFile.leafName.match(/\.[^\.]{1,3}\.(gz|bz2|Z)$/i))
            aLocalFile.leafName = aLocalFile.leafName.replace(/\.[^\.]{1,3}\.(gz|bz2|Z)$/i, "(2)$&");
          else
            aLocalFile.leafName = aLocalFile.leafName.replace(/(\.[^\.]*)?$/, "(2)$&");
        }
        else {
          // replace the last (n) in the filename with (n+1)
          aLocalFile.leafName = aLocalFile.leafName.replace(/^(.*\()\d+\)/, "$1" + (collisionCount+1) + ")");
        }
      }
      aLocalFile.create(Ci.nsIFile.NORMAL_FILE_TYPE, 0600);
    }
    catch (e) {
      dump("*** exception in validateLeafName: " + e + "\n");

      if (e.result == Cr.NS_ERROR_FILE_ACCESS_DENIED)
        throw e;

      if (aLocalFile.leafName == "" || aLocalFile.isDirectory()) {
        aLocalFile.append("unnamed");
        if (aLocalFile.exists())
          aLocalFile.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0600);
      }
    }
  },

  isUsableDirectory: function hald_isUsableDirectory(aDirectory) {
    dump("HelperAppLauncherDialog isUsableDirectory\n");
    return aDirectory.exists() && aDirectory.isDirectory() && aDirectory.isWritable();
  },

  _notify: function hald_notify(aLauncher, aCallback) {
    let notifier = Cc[aCallback ? "@mozilla.org/alerts-service;1" : "@mozilla.org/toaster-alerts-service;1"].getService(Ci.nsIAlertsService);
    notifier.showAlertNotification(URI_GENERIC_ICON_DOWNLOAD,
                                   "alertDownloads",
                                   "alertCantOpenDownload",
                                   true, "", aCallback, "downloadopen-fail");
  }
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([HelperAppLauncherDialog]);
