/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DateTimePickerParent as GeckoDateTimePickerParent } from "moz-src:///toolkit/actors/DateTimePickerParent.sys.mjs";

const Cc = Components.classes;
const Ci = Components.interfaces;

const DATE_PICKER_REQUEST = "embed:datepicker";
const DATE_PICKER_ABORT = "embed:datepickerabort";
const DATE_PICKER_RESPONSE = "embedui:datepickerresponse";
let nextRequestId = 0;

// JSWindowActor modules must export <registered actor name>Parent.
export class DateTimePickerParent extends GeckoDateTimePickerParent {
  #embedService;
  #embedListener;
  #embedWinId;
  #requestId;
  #pickerDetail;

  receiveMessage(message) {
    if (message.name === "InputPicker:Close" && this.#embedListener) {
      this.#cancelEmbedPicker();
      return;
    }
    super.receiveMessage(message);
  }

  didDestroy() {
    this.#cancelEmbedPicker();
  }

  showPicker(data) {
    // The Sailfish UI currently provides a native date picker only. Keep the
    // standard Gecko panel for the time and datetime-local input types.
    if (data.type !== "date") {
      super.showPicker(data);
      return;
    }

    if (!this.browsingContext.canOpenModalPicker) {
      return;
    }

    this.#cancelEmbedPicker();

    let embedService;
    let winId;
    try {
      embedService = Cc["@mozilla.org/embedlite-app-service;1"].getService(
        Ci.nsIEmbedAppService
      );
      winId = embedService.getIDByBrowsingContext(this.browsingContext);
    } catch (error) {
      console.error("Unable to route Sailfish date picker", error);
      this.sendAsyncMessage("InputPicker:Closed", {});
      return;
    }
    if (!winId) {
      this.sendAsyncMessage("InputPicker:Closed", {});
      return;
    }

    const detail = data.detail || {};
    const requestId = `${winId}:${++nextRequestId}`;
    const payload = {
      winId,
      id: requestId,
      value: detail.value,
      min: Number.isFinite(detail.min) ? detail.min : null,
      max: Number.isFinite(detail.max) ? detail.max : null,
      step: Number.isFinite(detail.step) ? detail.step : null,
      stepBase: Number.isFinite(detail.stepBase) ? detail.stepBase : null,
    };
    const actor = this;
    const listener = {
      QueryInterface: ChromeUtils.generateQI(["nsIEmbedMessageListener"]),

      onMessageReceived(_messageName, messageData) {
        if (actor.#embedListener !== listener) {
          return;
        }

        let response;
        try {
          response = JSON.parse(messageData);
        } catch (error) {
          console.warn("Unable to parse Sailfish date picker response", error);
          return;
        }
        if (
          !response ||
          typeof response !== "object" ||
          response.winId !== winId ||
          response.id !== requestId
        ) {
          return;
        }

        actor.#finishEmbedPicker(response);
      },
    };

    this.#embedService = embedService;
    this.#embedListener = listener;
    this.#embedWinId = winId;
    this.#requestId = requestId;
    this.#pickerDetail = detail;

    try {
      embedService.addMessageListener(DATE_PICKER_RESPONSE, listener);
      embedService.sendAsyncMessage(
        winId,
        DATE_PICKER_REQUEST,
        JSON.stringify(payload)
      );
    } catch (error) {
      console.error("Unable to open Sailfish date picker", error);
      this.#cancelEmbedPicker();
      this.sendAsyncMessage("InputPicker:Closed", {});
    }
  }

  close() {
    if (this.#embedListener) {
      this.#cancelEmbedPicker();
      return;
    }
    super.close();
  }

  #finishEmbedPicker(response) {
    const detail = this.#pickerDetail;
    const value =
      response.accepted && this.#isValidDate(response, detail)
        ? {
            year: response.year,
            month: response.month,
            day: response.day,
          }
        : null;

    if (response.accepted && !value) {
      console.warn("Ignoring invalid Sailfish date picker response");
    }

    this.#cleanupEmbedPicker();
    if (value) {
      this.sendAsyncMessage("InputPicker:ValueChanged", value);
    }
    this.sendAsyncMessage("InputPicker:Closed", {});
  }

  #isValidDate(response, detail) {
    const { year, month, day } = response;
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      year < 1 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return false;
    }

    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return false;
    }

    const value = date.getTime();
    if (
      (Number.isFinite(detail.min) && value < detail.min) ||
      (Number.isFinite(detail.max) && value > detail.max)
    ) {
      return false;
    }

    if (Number.isFinite(detail.step) && detail.step > 0) {
      const stepBase = Number.isFinite(detail.stepBase) ? detail.stepBase : 0;
      if ((value - stepBase) % detail.step !== 0) {
        return false;
      }
    }
    return true;
  }

  #cleanupEmbedPicker() {
    if (this.#embedService && this.#embedListener) {
      try {
        this.#embedService.removeMessageListener(
          DATE_PICKER_RESPONSE,
          this.#embedListener
        );
      } catch (error) {
        console.warn("Unable to remove Sailfish date picker listener", error);
      }
    }
    this.#embedService = null;
    this.#embedListener = null;
    this.#embedWinId = 0;
    this.#requestId = null;
    this.#pickerDetail = null;
  }

  #cancelEmbedPicker() {
    const embedService = this.#embedService;
    const wasOpen = !!this.#embedListener;
    const winId = this.#embedWinId;
    const requestId = this.#requestId;
    this.#cleanupEmbedPicker();

    if (embedService && wasOpen && winId && requestId) {
      try {
        embedService.sendAsyncMessage(
          winId,
          DATE_PICKER_ABORT,
          JSON.stringify({ winId, id: requestId })
        );
      } catch (error) {
        console.warn("Unable to cancel Sailfish date picker", error);
      }
    }
  }
}
