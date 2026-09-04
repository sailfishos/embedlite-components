/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;

const promptQueues = new Map();

export class PromptParent extends JSWindowActorParent {
  didDestroy() {
    this._destroyed = true;
    for (let prompt of this._pendingPrompts || []) {
      prompt.abort();
    }
  }

  receiveMessage(message) {
    if (message.name !== "Prompt:Open") {
      return undefined;
    }

    if (!this.windowContext.isActiveInTab) {
      return { ...message.data, promptAborted: true };
    }

    return this.openPrompt(message.data);
  }

  openPrompt(args) {
    let topic;
    let responseTopic;
    switch (args.promptType) {
      case "alert":
      case "alertCheck":
        topic = "embed:alert";
        responseTopic = "alertresponse";
        break;
      case "confirm":
      case "confirmCheck":
      case "confirmEx":
        topic = "embed:confirm";
        responseTopic = "confirmresponse";
        break;
      case "prompt":
        topic = "embed:prompt";
        responseTopic = "promptresponse";
        break;
      default:
        return undefined;
    }

    if (args.promptType === "confirmEx" && args.button2Label) {
      console.warn("EmbedLite does not support three-button confirmEx prompts");
      return { ...args, promptAborted: true };
    }

    let embedService;
    let winId;
    try {
      embedService = Cc["@mozilla.org/embedlite-app-service;1"].getService(
        Ci.nsIEmbedAppService
      );
      winId = embedService.getIDByBrowsingContext(this.browsingContext);
    } catch (error) {
      console.error("Unable to route EmbedLite prompt", error);
      return { ...args, promptAborted: true };
    }

    if (!winId) {
      return { ...args, promptAborted: true };
    }

    let payload = {
      winId,
      title: args.title,
      text: args.text,
      inPermitUnload: !!args.inPermitUnload,
      inputs: [],
    };
    let buttons = [
      args.button0Label,
      args.button1Label,
      args.button2Label,
    ].filter(Boolean);
    if (buttons.length) {
      payload.buttons = buttons;
    }

    if (args.promptType === "prompt") {
      payload.defaultValue = args.value || "";
      payload.inputs.push({ value: args.value || "" });
    }
    if (args.checkLabel) {
      payload.inputs.push({
        label: args.checkLabel,
        hint: "preventAddionalDialog",
        checked: !!args.checked,
      });
    }

    let previousPrompt = promptQueues.get(winId) || Promise.resolve();
    let result = previousPrompt
      .catch(() => undefined)
      .then(() => {
        if (this._destroyed) {
          return { ...args, promptAborted: true };
        }
        return this.sendPrompt(
          embedService,
          winId,
          topic,
          responseTopic,
          args,
          payload
        );
    });
    promptQueues.set(winId, result);
    let removeFromQueue = () => {
      if (promptQueues.get(winId) === result) {
        promptQueues.delete(winId);
      }
    };
    void result.then(removeFromQueue, removeFromQueue);
    return result;
  }

  sendPrompt(embedService, winId, topic, responseTopic, args, payload) {
    return new Promise(resolve => {
      let finished = false;
      let pendingPrompt;
      let finish = promptAborted => {
        if (finished) {
          return;
        }
        finished = true;
        try {
          embedService.removeMessageListener(responseTopic, listener);
        } catch (error) {
          console.warn("Unable to remove EmbedLite prompt listener", error);
        }
        this._pendingPrompts?.delete(pendingPrompt);
        args.promptAborted = promptAborted;
        resolve(args);
      };

      let listener = {
        QueryInterface: ChromeUtils.generateQI(["nsIEmbedMessageListener"]),

        onMessageReceived(messageName, messageData) {
          let response;
          try {
            response = JSON.parse(messageData);
          } catch (error) {
            console.warn("Unable to parse EmbedLite prompt response", error);
            return;
          }
          if (
            !response ||
            typeof response !== "object" ||
            response.winId !== winId
          ) {
            return;
          }

          if ("checkvalue" in response) {
            args.checked = !!response.checkvalue;
          }
          if ("accepted" in response) {
            args.ok = !!response.accepted;
            args.buttonNumClicked = response.accepted ? 0 : 1;
          }
          if ("promptvalue" in response) {
            args.value = response.promptvalue;
          }
          finish(false);
        },
      };

      pendingPrompt = { abort: () => finish(true) };
      this._pendingPrompts ||= new Set();
      this._pendingPrompts.add(pendingPrompt);

      try {
        embedService.addMessageListener(responseTopic, listener);
        embedService.sendAsyncMessage(winId, topic, JSON.stringify(payload));
      } catch (error) {
        console.error("Unable to open EmbedLite prompt", error);
        finish(true);
      }
    });
  }
}
