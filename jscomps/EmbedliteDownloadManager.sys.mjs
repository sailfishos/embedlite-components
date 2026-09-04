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

const { Downloads } = ChromeUtils.importESModule(
  "resource://gre/modules/Downloads.sys.mjs"
);
const { XPCOMUtils } = ChromeUtils.importESModule("resource://gre/modules/XPCOMUtils.sys.mjs");

const lazy = {};

const loggerScope = {};
Services.scriptloader.loadSubScript(
  "chrome://embedlite/content/Logger.js",
  loggerScope
);
const { Logger } = loggerScope;

const {
  DownloadCopySaver,
  DownloadSaver,
  DownloadError,
} = ChromeUtils.importESModule("resource://gre/modules/DownloadCore.sys.mjs");

XPCOMUtils.defineLazyServiceGetter(
  lazy,
  "gPrintSettingsService",
  "@mozilla.org/gfx/printsettings-service;1",
  Ci.nsIPrintSettingsService
);

const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");

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

export function EmbedliteDownloadManager()
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

          case "saveAsPdf": {
            let source = null;
            if (data.windowId !== undefined && data.tabId !== undefined) {
              try {
                source = {
                  browsingContext: Services.embedlite
                    .QueryInterface(Ci.nsIEmbedChromeAppService)
                    .getChromeTabBrowsingContext(
                      data.windowId, String(data.tabId))
                };
              } catch (error) {
                Logger.warn("No hosted tab to print to pdf", error);
              }
            } else if (Services.ww.activeWindow) {
              source = { window: Services.ww.activeWindow };
            }

            if (source) {
              (async function() {
                let list = await Downloads.getList(Downloads.ALL);
                let download = await DownloadPDFSaver.createDownload({
                  ...source,
                  target: data.to
                });
                download.start();
                list.add(download);
              })().then(null, Cu.reportError);
            } else {
              Logger.warn("No active page to print to pdf");
            }
            break;
          }
        }
        break;
    }
  }
};

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
   * Live hosted BrowsingContext used as the source for this save. This is not
   * serializable and is cleared as soon as execution starts.
   */
  _sourceBrowsingContext: null,

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
    if (!this.download.source.windowRef && !this._sourceBrowsingContext) {
      throw new DownloadError({
        message:
          "PDF saver must be passed an open page, and cannot be restarted.",
        becauseSourceFailed: true,
      });
    }

    let browsingContext = this._sourceBrowsingContext;
    this._sourceBrowsingContext = null;
    let win = this.download.source.windowRef?.get();

    // Set windowRef to null to avoid re-trying.
    this.download.source.windowRef = null;

    if (!browsingContext && !win) {
      throw new DownloadError({
        message: "PDF saver can't save a page that has been closed.",
        becauseSourceFailed: true,
      });
    }

    this.addToHistory();

    let targetPath = this.download.target.path;

    // An empty target file must exist for the PDF printer to work correctly.
    await IOUtils.writeUTF8(targetPath, "");

    let printSettings = lazy.gPrintSettingsService.createNewPrintSettings();

    printSettings.outputFormat = Ci.nsIPrintSettings.kOutputFormatPDF;
    printSettings.outputDestination =
      Ci.nsIPrintSettings.kOutputDestinationFile;
    printSettings.toFileName = targetPath;

    printSettings.printSilent = true;

    printSettings.printBGImages = true;
    printSettings.printBGColors = true;
    printSettings.headerStrCenter = "";
    printSettings.headerStrLeft = "";
    printSettings.headerStrRight = "";
    printSettings.footerStrCenter = "";
    printSettings.footerStrLeft = "";
    printSettings.footerStrRight = "";

    this._browsingContext =
      browsingContext || BrowsingContext.getFromWindow(win);
    if (!this._browsingContext || this._browsingContext.isDiscarded) {
      this._browsingContext = null;
      throw new DownloadError({
        message: "PDF saver can't save a discarded page.",
        becauseSourceFailed: true,
      });
    }

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

    let fileInfo = await IOUtils.stat(targetPath);
    aSetProgressBytesFn(fileInfo.size, fileInfo.size, false);
  },

  /**
   * Implements "DownloadSaver.cancel".
   */
  cancel: function DCS_cancel() {
    // BrowsingContext.print() has no cancellation API. DownloadCore will wait
    // for execute() to finish, then call removeData() for a canceled download.
  },

  /**
   * Implements "DownloadSaver.removeData".
   */
  removeData(canRemoveFinalTarget) {
    return DownloadCopySaver.prototype.removeData.call(
      this,
      canRemoveFinalTarget
    );
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
  let browsingContext = aProperties.browsingContext || null;
  let sourceWindow = aProperties.window || null;
  let sourceUrl;
  let isPrivate;
  if (browsingContext) {
    sourceUrl = browsingContext.currentURI?.spec || "about:blank";
    isPrivate = browsingContext.usePrivateBrowsing;
  } else {
    sourceUrl = sourceWindow.location.href;
    isPrivate = PrivateBrowsingUtils.isContentWindowPrivate(sourceWindow);
  }
  let download = await Downloads.createDownload({
    source: sourceUrl,
    target: aProperties.target,
    contentType: "application/pdf"
  });
  download.source.isPrivate = isPrivate;
  download.source.windowRef = sourceWindow
    ? Cu.getWeakReference(sourceWindow) : null;
  download.saver = new DownloadPDFSaver();
  download.saver.download = download;
  download.saver._sourceBrowsingContext = browsingContext;
  download["saveAsPdf"] = true;

  return download;
};
