/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

const captureStates = new Map();

export class EmbedLiteWebRTCProcessChild extends JSProcessActorChild {
  getActor(window) {
    return window.windowGlobalChild.getActor("EmbedLiteWebRTC");
  }

  async observe(subject, topic, data) {
    switch (topic) {
      case "getUserMedia:ask-device-permission":
        // Sailjail grants the application-level device access separately.
        Services.obs.notifyObservers(
          subject,
          "getUserMedia:got-device-permission"
        );
        break;
      case "getUserMedia:request": {
        let callID = subject.callID;
        let allowedDevices = null;
        try {
          allowedDevices = await this.handleMediaRequest(subject);
        } catch (error) {
          Cu.reportError(error);
        }
        Services.obs.notifyObservers(
          allowedDevices,
          allowedDevices
            ? "getUserMedia:response:allow"
            : "getUserMedia:response:deny",
          callID
        );
        break;
      }
      case "PeerConnection:request":
        Services.obs.notifyObservers(
          null,
          "PeerConnection:response:allow",
          subject.callID
        );
        break;
      case "recording-device-events": {
        subject.QueryInterface(Ci.nsIPropertyBag2);
        this.updateMediaCaptureState(subject.getProperty("window"));
        break;
      }
      case "recording-device-stopped":
        this.updateMediaCaptureState(
          Services.wm.getOuterWindowWithId(subject.windowID),
          subject.windowID
        );
        break;
      case "recording-window-ended":
        this.removeMediaCaptureState(data);
        break;
    }
  }

  updateMediaCaptureState(
    window,
    windowId = window?.windowGlobalChild?.outerWindowId
  ) {
    if (!window || window.closed) {
      if (windowId !== undefined) {
        this.removeMediaCaptureState(windowId);
      }
      return;
    }

    let mediaManagerService = Cc[
      "@mozilla.org/mediaManagerService;1"
    ].getService(Ci.nsIMediaManagerService);
    let state = { video: false, audio: false };
    let camera = {};
    let microphone = {};
    let screen = {};
    let windowShare = {};
    let browser = {};
    let mediaDevices = {};

    mediaManagerService.mediaCaptureWindowState(
      window,
      camera,
      microphone,
      screen,
      windowShare,
      browser,
      mediaDevices
    );
    state.video = camera.value !== mediaManagerService.STATE_NOCAPTURE;
    state.audio = microphone.value !== mediaManagerService.STATE_NOCAPTURE;
    if (state.video || state.audio) {
      captureStates.set(windowId, state);
    } else {
      captureStates.delete(windowId);
    }

    this.sendMediaCaptureState();
  }

  removeMediaCaptureState(windowId) {
    captureStates.delete(Number(windowId));
    this.sendMediaCaptureState();
  }

  sendMediaCaptureState() {
    let state = { video: false, audio: false };
    for (let captureState of captureStates.values()) {
      state.video ||= captureState.video;
      state.audio ||= captureState.audio;
    }
    this.sendAsyncMessage("MediaCaptureState", state);
  }

  async handleMediaRequest(request) {
    let constraints = request.getConstraints();
    let devices = request.devices.map(device =>
      device.QueryInterface(Ci.nsIMediaDevice)
    );
    let window = Services.wm.getOuterWindowWithId(request.windowID);
    if (!window || window.closed) {
      return null;
    }

    let sources = devices.map(device => ({
      type: device.type,
      rawId: device.rawId,
      name: device.rawName || device.name,
      mediaSource: device.mediaSource,
    }));
    let video = constraints.video
      ? sources.filter(
          source =>
            source.type === "videoinput" && source.mediaSource === "camera"
        )
      : null;
    let audio = constraints.audio
      ? sources.filter(
          source =>
            source.type === "audioinput" &&
            source.mediaSource === "microphone"
        )
      : null;

    if ((constraints.video && !video.length) ||
        (constraints.audio && !audio.length)) {
      return null;
    }

    let response = await this.getActor(window).getMediaPermission({
      uri: window.document.documentURI,
      video,
      audio,
    });
    if (!response) {
      return null;
    }

    let allowedDevices = Cc["@mozilla.org/array;1"].createInstance(
      Ci.nsIMutableArray
    );
    if (constraints.video) {
      let selectedVideo = devices.find(
        device => device.rawId === response.video
      );
      if (!selectedVideo) {
        return null;
      }
      allowedDevices.appendElement(selectedVideo);
    }
    if (constraints.audio) {
      let selectedAudio = devices.find(
        device => device.rawId === response.audio
      );
      if (!selectedAudio) {
        return null;
      }
      allowedDevices.appendElement(selectedAudio);
    }
    return allowedDevices;
  }
}
