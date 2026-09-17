/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;

const ALLOW_ACTION = Ci.nsIPermissionManager.ALLOW_ACTION;
const DENY_ACTION = Ci.nsIPermissionManager.DENY_ACTION;
const EXPIRE_SESSION = Ci.nsIPermissionManager.EXPIRE_SESSION;

export class EmbedLiteWebRTCParent extends JSWindowActorParent {
  didDestroy() {
    this._destroyed = true;
    for (let request of this._pendingRequests || []) {
      request.abort();
    }
  }

  receiveMessage(message) {
    if (message.name !== "GetMediaPermission") {
      return undefined;
    }
    return this.getMediaPermission(message.data);
  }

  async getMediaPermission(request) {
    if (this._destroyed || !this.windowContext.isActiveInTab) {
      return null;
    }

    let principal = this.manager.documentPrincipal;
    let selected = {};
    let promptSources = {};
    let mediaTypes = [
      {
        permission: "camera",
        responseProperty: "video",
        sources: request.video || [],
      },
      {
        permission: "microphone",
        responseProperty: "audio",
        sources: request.audio || [],
      },
    ];

    for (let type of mediaTypes) {
      if (!type.sources.length) {
        continue;
      }
      let permission = Services.perms.testExactPermissionFromPrincipal(
        principal,
        type.permission
      );
      if (permission === DENY_ACTION) {
        return null;
      }
      if (permission === ALLOW_ACTION) {
        selected[type.responseProperty] = type.sources[0].rawId;
      } else {
        promptSources[type.permission] = type.sources;
      }
    }

    let response;
    let promptTypes = Object.keys(promptSources);
    if (promptTypes.length) {
      response = await this.openPrompt(promptSources);
      if (response?.checkedDontAsk) {
        let action = response.allow ? ALLOW_ACTION : DENY_ACTION;
        for (let permission of promptTypes) {
          Services.perms.addFromPrincipal(principal, permission, action);
        }
      }
      if (!response?.allow) {
        return null;
      }

      for (let type of mediaTypes) {
        let sources = promptSources[type.permission];
        if (!sources) {
          continue;
        }
        let selectedIndex = response.choices?.[type.permission];
        if (!Number.isInteger(selectedIndex) || !sources[selectedIndex]) {
          return null;
        }
        selected[type.responseProperty] = sources[selectedIndex].rawId;
      }
    }

    if (selected.video) {
      Services.perms.addFromPrincipal(
        principal,
        "MediaManagerVideo",
        ALLOW_ACTION,
        EXPIRE_SESSION
      );
    }
    return selected;
  }

  openPrompt(promptSources) {
    let embedService;
    let winId;
    try {
      embedService = Cc["@mozilla.org/embedlite-app-service;1"].getService(
        Ci.nsIEmbedAppService
      );
      winId = embedService.getIDByBrowsingContext(this.browsingContext);
    } catch (error) {
      console.error("Unable to route EmbedLite WebRTC prompt", error);
      return null;
    }
    if (!winId) {
      return null;
    }

    let principal = this.manager.documentPrincipal;
    let id = Services.uuid.generateUUID().toString();
    let devices = {};
    for (let [permission, sources] of Object.entries(promptSources)) {
      devices[permission] = sources.map(source => source.name);
    }
    // Pulseaudio selects the actual microphone route, so exposing multiple
    // input names here would suggest a choice that cannot be honored.
    if (devices.microphone) {
      devices.microphone = ["Integrated microphone"];
      promptSources.microphone = promptSources.microphone.slice(0, 1);
    }

    let origin;
    try {
      origin = principal.URI.host || principal.originNoSuffix;
    } catch (error) {
      origin = principal.originNoSuffix;
    }
    let payload = { id, origin, devices };
    return this.sendPrompt(embedService, winId, payload);
  }

  sendPrompt(embedService, winId, payload) {
    return new Promise(resolve => {
      let finished = false;
      let pendingRequest;
      let finish = response => {
        if (finished) {
          return;
        }
        finished = true;
        try {
          embedService.removeMessageListener(
            "embedui:webrtcresponse",
            listener
          );
        } catch (error) {
          console.warn("Unable to remove EmbedLite WebRTC listener", error);
        }
        this._pendingRequests?.delete(pendingRequest);
        resolve(response);
      };
      let listener = {
        QueryInterface: ChromeUtils.generateQI(["nsIEmbedMessageListener"]),

        onMessageReceived(messageName, messageData) {
          let response;
          try {
            response = JSON.parse(messageData);
          } catch (error) {
            console.warn("Unable to parse EmbedLite WebRTC response", error);
            return;
          }
          if (!response || response.id !== payload.id) {
            return;
          }
          finish(response);
        },
      };

      pendingRequest = { abort: () => finish(null) };
      this._pendingRequests ||= new Set();
      this._pendingRequests.add(pendingRequest);

      try {
        embedService.addMessageListener(
          "embedui:webrtcresponse",
          listener
        );
        embedService.sendAsyncMessage(
          winId,
          "embed:webrtcrequest",
          JSON.stringify(payload)
        );
      } catch (error) {
        console.error("Unable to open EmbedLite WebRTC prompt", error);
        finish(null);
      }
    });
  }
}
