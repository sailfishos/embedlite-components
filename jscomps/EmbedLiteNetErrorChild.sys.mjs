/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const STYLESHEET = "chrome://browser/skin/embedliteAboutNetError.css";

export class EmbedLiteNetErrorChild extends JSWindowActorChild {
  handleEvent(event) {
    let document = event.originalTarget;
    if (document.defaultView !== this.contentWindow || !document.head) {
      return;
    }

    if (!document.querySelector('meta[name="viewport"]')) {
      let viewport = document.createElement("meta");
      viewport.name = "viewport";
      viewport.content = "width=device-width, initial-scale=1";
      document.head.appendChild(viewport);
    }

    if (!document.querySelector(`link[href="${STYLESHEET}"]`)) {
      let stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = STYLESHEET;
      document.head.appendChild(stylesheet);
    }
  }
}
