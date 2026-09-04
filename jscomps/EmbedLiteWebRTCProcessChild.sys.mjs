/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

export class EmbedLiteWebRTCProcessChild extends JSProcessActorChild {
  getActor(window) {
    return window.windowGlobalChild.getActor("EmbedLiteWebRTC");
  }

  async observe(subject, topic) {
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
    }
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
