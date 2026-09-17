/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const captureStates = new Map();

function notifyMediaCaptureState() {
  let mediaInfo = { video: false, audio: false };
  for (let state of captureStates.values()) {
    mediaInfo.video ||= state.video;
    mediaInfo.audio ||= state.audio;
  }
  Services.obs.notifyObservers(
    null,
    "webrtc-media-info",
    JSON.stringify(mediaInfo)
  );
}

export class EmbedLiteWebRTCProcessParent extends JSProcessActorParent {
  didDestroy() {
    if (captureStates.delete(this)) {
      notifyMediaCaptureState();
    }
  }

  receiveMessage(message) {
    if (message.name !== "MediaCaptureState") {
      return undefined;
    }

    let state = {
      video: !!message.data.video,
      audio: !!message.data.audio,
    };
    if (state.video || state.audio) {
      captureStates.set(this, state);
    } else {
      captureStates.delete(this);
    }
    notifyMediaCaptureState();
    return undefined;
  }
}
