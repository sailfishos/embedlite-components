/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
});

export class EmbedLiteSelectionParent extends JSWindowActorParent {
  async receiveMessage(message) {
    if (message.name !== "EmbedLiteSelection:GetSearchSubmission") {
      return undefined;
    }

    let engine = await lazy.SearchService.getDefault();
    let submission = engine?.getSubmission(String(message.data.text));
    return submission?.uri?.spec || "";
  }
}
