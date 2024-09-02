/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

////////////////////////////////////////////////////////////////////////////////
//// Globals

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

const { ComponentUtils } = ChromeUtils.import("resource://gre/modules/ComponentUtils.jsm");
const { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Downloads",
                                  "resource://gre/modules/Downloads.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Services",
                                  "resource://gre/modules/Services.jsm");

Services.scriptloader.loadSubScript("chrome://embedlite/content/Logger.js");

const { DownloadSaver, DownloadError } = ChromeUtils.import(
  "resource://gre/modules/DownloadCore.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  OS: "resource://gre/modules/osfile.jsm",
});

XPCOMUtils.defineLazyServiceGetter(
  this,
  "gPrintSettingsService",
  "@mozilla.org/gfx/printsettings-service;1",
  Ci.nsIPrintSettingsService
);

const { PrivateBrowsingUtils } = ChromeUtils.import(
  "resource://gre/modules/PrivateBrowsingUtils.jsm"
);

////////////////////////////////////////////////////////////////////////////////
//// DownloadViewer

let DownloadView = {
  // This is a map of download => their properties since the previos change
  counter: 0,

  onDownloadAdded: function(download) {
    this.counter++;

    if (download["id"]) {
      Logger.warn("Download id is already set")
    } else {
      download["id"] = this.counter;
    }

    if (download["prevState"]) {
      Logger.warn("Download prevState is already set")
    }

    download["prevState"] = {
      progress: download.progress,
      succeeded: download.succeeded,
      error: download.error,
      canceled: download.canceled,
      stopped: download.stopped
    };

    Services.obs.notifyObservers(null, "embed:download",
                                 JSON.stringify({
                                     msg: "dl-start",
                                     id: this.counter,
                                     saveAsPdf: download.saveAsPdf || false,
                                     displayName: download.target.path.split('/').slice(-1)[0],
                                     sourceUrl: download.source.url,
                                     targetPath: download.target.path,
                                     mimeType: download.contentType,
                                     size: download.totalBytes
                                 }));

    if (download.progress) {
      Services.obs.notifyObservers(null, "embed:download",
                                   JSON.stringify({
                                       msg: "dl-progress",
                                       id: download.id,
                                       saveAsPdf: download.saveAsPdf || false,
                                       percent: download.progress
                                   }));
    }

    if (download.succeeded) {
      Services.obs.notifyObservers(null, "embed:download",
                                   JSON.stringify({
                                       msg: "dl-done",
                                       id: download.id,
                                       saveAsPdf: download.saveAsPdf || false,
                                       targetPath: download.target.path
                                   }));
    }

    if (download.error) {
      Logger.warn("EmbedliteDownloadManager error:", download.error.message);
      Services.obs.notifyObservers(null, "embed:download",
                                   JSON.stringify({
                                       msg: "dl-fail",
                                       id: download.id,
                                       saveAsPdf: download.saveAsPdf || false
                                   }));
    }

    if (download.canceled) {
      Services.obs.notifyObservers(null, "embed:download",
                                   JSON.stringify({
                                       msg: "dl-cancel",
                                       id: download.id,
                                       saveAsPdf: download.saveAsPdf || false
                                   }));
    }
  },

  onDownloadChanged: function(download) {
    if (download.prevState.progress !== download.progress) {
      Services.obs.notifyObservers(null, "embed:download",
                                   JSON.stringify({
                                       msg: "dl-progress",
                                       id: download.id,
                                       saveAsPdf: download.saveAsPdf || false,
                                       percent: download.progress
                                   }));
    }
    download.prevState.progress = download.progress;

    if (!download.prevState.succeeded && download.succeeded) {
      Services.obs.notifyObservers(null, "embed:download",
                                   JSON.stringify({
                                       msg: "dl-done",
                                       id: download.id,
                                       saveAsPdf: download.saveAsPdf || false,
                                       targetPath: download.target.path
                                   }));
    }
    download.prevState.succeeded = download.succeeded;

    if (!download.prevState.error && download.error) {
      Logger.debug("EmbedliteDownloadManager error:", download.error.message);
      Services.obs.notifyObservers(null, "embed:download",
                                   JSON.stringify({
                                       msg: "dl-fail",
                                       id: download.id,
                                       saveAsPdf: download.saveAsPdf || false
                                   }));
    }
    download.prevState.error = download.error;

    if (!download.prevState.canceled && download.canceled) {
      Services.obs.notifyObservers(null, "embed:download",
                                   JSON.stringify({
                                       msg: "dl-cancel",
                                       id: download.id,
                                       saveAsPdf: download.saveAsPdf || false
                                   }));
    }
    download.prevState.canceled = download.canceled;

    if (download.prevState.stopped && !download.stopped) {
      Services.obs.notifyObservers(null, "embed:download",
                                   JSON.stringify({
                                     msg: "dl-start",
                                     id: download.id,
                                     saveAsPdf: download.saveAsPdf || false,
                                     displayName: download.target.path.split('/').slice(-1)[0],
                                     sourceUrl: download.source.url,
                                     targetPath: download.target.path,
                                     mimeType: download.contentType,
                                     size: download.totalBytes
                                   }));
    }
    download.prevState.stopped = download.stopped;
  }
};

////////////////////////////////////////////////////////////////////////////////
//// EmbedliteDownloadManager

function EmbedliteDownloadManager()
{
  Logger.debug("JSComp: EmbedliteDownloadManager.js loaded");
}

EmbedliteDownloadManager.prototype = {
  classID: Components.ID("{71b0a6e8-83ac-4006-af97-d66009db97c8}"),

  QueryInterface: ChromeUtils.generateQI([Ci.nsIObserver]),

  observe: function(aSubject, aTopic, aData) {
    switch (aTopic) {
      case "app-startup":
        Services.obs.addObserver(this, "profile-after-change", false);
        break;

      case "profile-after-change":
        Services.obs.removeObserver(this, "profile-after-change");
        Services.obs.addObserver(this, "embedui:download", false);
        (async function() {
          let downloadList = await Downloads.getList(Downloads.ALL);

          // Let's remove all existing downloads from the Download List
          // before adding the view so that partial (cancelled) downloads
          // will not get restarted.
          let list = await downloadList.getAll();
          for (let download of list) {
            // No need to check if this is download has hasPartialData true or not
            // as we do not have download list at the browser side.
            await downloadList.remove(download);
            download.finalize(true).then(null, Cu.reportError);
          }

          await downloadList.addView(DownloadView);
        })().then(null, Cu.reportError);
        break;

      case "embedui:download":
        var data = JSON.parse(aData);

        switch (data.msg) {
          case "retryDownload":
            (async function() {
              let downloadList = await Downloads.getList(Downloads.ALL);
              let list = await downloadList.getAll();
              for (let download of list) {
                if (download.id === data.id) {
                  download.start();
                  break;
                }
              }
            })().then(null, Cu.reportError);
            break;

          case "cancelDownload":
            (async function() {
              let downloadList = await Downloads.getList(Downloads.ALL);
              let list = await downloadList.getAll();
              for (let download of list) {
                if (download.id === data.id) {
                  // Switch to cancel (from finalize) so that we have partially downloaded hanging.
                  // A partially downloaded download can be restarted during the same browsering
                  // session. Restarting the browser will clear download list.
                  download.cancel();
                  break;
                }
              }
            })().then(null, Cu.reportError);
            break;

          case "addDownload":
            (async function() {
              let list = await Downloads.getList(Downloads.ALL);
              let download = await Downloads.createDownload({
                source: data.from,
                target: data.to
              });
              download.start();
              list.add(download);
            })().then(null, Cu.reportError);
            break;

          case "saveAsPdf":
            if (Services.ww.activeWindow) {
              (async function() {
                let list = await Downloads.getList(Downloads.ALL);
                let download = await DownloadPDFSaver.createDownload({
                  source: Services.ww.activeWindow,
                  target: data.to
                });
                download.start();
                list.add(download);
              })().then(null, Cu.reportError);
            } else {
              Logger.warn("No active window to print to pdf")
            }
            break;
        }
        break;
    }
  }
};

this.NSGetFactory = ComponentUtils.generateNSGetFactory([EmbedliteDownloadManager]);

/**
 * This DownloadSaver type creates a PDF file from the current document in a
 * given window, specified using the windowRef property of the DownloadSource
 * object associated with the download.
 *
 * In order to prevent the download from saving a different document than the one
 * originally loaded in the window, any attempt to restart the download will fail.
 *
 * Since this DownloadSaver type requires a live document as a source, it cannot
 * be persisted across sessions, unless the download already succeeded.
 */
var DownloadPDFSaver = function() {};

DownloadPDFSaver.prototype = {
  __proto__: DownloadSaver.prototype,

  /**
   * A CanonicalBrowsingContext instance for printing this page.
   * This is null when saving has not started or has completed,
   * or while the operation is being canceled.
   */
  _browsingContext: null,

  /**
   * Implements "DownloadSaver.execute".
   */
  async execute(aSetProgressBytesFn, aSetPropertiesFn) {
    if (!this.download.source.windowRef) {
      throw new DownloadError({
        message:
          "PDF saver must be passed an open window, and cannot be restarted.",
        becauseSourceFailed: true,
      });
    }

    let win = this.download.source.windowRef.get();

    // Set windowRef to null to avoid re-trying.
    this.download.source.windowRef = null;

    if (!win) {
      throw new DownloadError({
        message: "PDF saver can't save a window that has been closed.",
        becauseSourceFailed: true,
      });
    }

    this.addToHistory();

    let targetPath = this.download.target.path;

    // An empty target file must exist for the PDF printer to work correctly.
    let file = await OS.File.open(targetPath, { truncate: true });
    await file.close();

    let printSettings = gPrintSettingsService.newPrintSettings;

    printSettings.printToFile = true;
    printSettings.outputFormat = Ci.nsIPrintSettings.kOutputFormatPDF;
    printSettings.toFileName = targetPath;

    printSettings.printSilent = true;
    printSettings.showPrintProgress = false;

    printSettings.printBGImages = true;
    printSettings.printBGColors = true;
    printSettings.headerStrCenter = "";
    printSettings.headerStrLeft = "";
    printSettings.headerStrRight = "";
    printSettings.footerStrCenter = "";
    printSettings.footerStrLeft = "";
    printSettings.footerStrRight = "";

    this._browsingContext = BrowsingContext.getFromWindow(win)

    try {
      await new Promise((resolve, reject) => {
        this._browsingContext.print(printSettings)
        .then(() => {
          resolve();
        })
        .catch(exception => {
          reject(new DownloadError({ result: exception, inferCause: true }));
        });
      });
    } finally {
      // Remove the print object to avoid leaks
      this._browsingContext = null;
    }

    let fileInfo = await OS.File.stat(targetPath);
    aSetProgressBytesFn(fileInfo.size, fileInfo.size, false);
  },

  /**
   * Implements "DownloadSaver.cancel".
   */
  cancel: function DCS_cancel() {
    if (this._browsingContext) {
      this._browsingContext.cancel();
      this._browsingContext = null;
    }
  },

  /**
   * Implements "DownloadSaver.toSerializable".
   */
  toSerializable() {
    if (this.download.succeeded) {
      return DownloadCopySaver.prototype.toSerializable.call(this);
    }

    // This object needs a window to recreate itself. If it didn't succeded
    // it will not be possible to restart. Returning null here will
    // prevent us from serializing it at all.
    return null;
  },
};

/**
 * Creates a new DownloadPDFSaver object, with its initial state derived from
 * the provided properties.
 *
 * @param aProperties
 *        Provides the initial properties for the newly created download.
 *        This matches the serializable representation of a Download object.
 *        Some of the most common properties in this object include:
 *        {
 *          source: An object providing a Ci.nsIDOMWindow interface.
 *          target: String containing the path of the target file.
 *        }
 *
 * @return The newly created DownloadPDFSaver object.
 */
DownloadPDFSaver.createDownload = async function(aProperties) {
  let download = await Downloads.createDownload({
    source: aProperties.source.location.href,
    target: aProperties.target,
    contentType: "application/pdf"
  });
  download.source.isPrivate = PrivateBrowsingUtils.isContentWindowPrivate(
    aProperties.source
  );
  download.source.windowRef = Cu.getWeakReference(aProperties.source);
  download.saver = new DownloadPDFSaver();
  download.saver.download = download;
  download["saveAsPdf"] = true;

  return download;
};
