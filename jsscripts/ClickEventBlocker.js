/*
 * Copyright (c) 2020 Open Mobile Platform LLC.
 */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");

var ClickEventBlocker = {
    _context: null,

    init: function init(context) {
        this._context = context
        Services.els.addSystemEventListener(context, "click", this, true);
    },

    handleEvent(event) {
        switch (event.type) {
        case "click":
            event.preventDefault()
            let originalTarget = event.originalTarget;
            let ownerDoc = originalTarget.ownerDocument;
            if (!ownerDoc) {
                return;
            }

            let href = this._hrefAndLinkNodeForClickEvent(event);
            if (href) {
                sendAsyncMessage("embed:OpenLink", {
                                     "uri":  href
                                 })
            }
        }
    },


  /**
   * Extracts linkNode and href for the current click target.
   *
   * @param event
   *        The click event.
   * @return [href, linkNode, linkPrincipal].
   *
   * @note linkNode will be null if the click wasn't on an anchor
   *       element. This includes SVG links, because callers expect |node|
   *       to behave like an <a> element, which SVG links (XLink) don't.
   */
  _hrefAndLinkNodeForClickEvent(event) {
    function isHTMLLink(aNode) {
      // Be consistent with what nsContextMenu.js does.
      return ((aNode instanceof content.HTMLAnchorElement && aNode.href) ||
              (aNode instanceof content.HTMLAreaElement && aNode.href) ||
              aNode instanceof content.HTMLLinkElement);
    }

    let node = event.target;
    while (node && !isHTMLLink(node)) {
      node = node.parentNode;
    }

    if (node)
      return node.href;

    // If there is no linkNode, try simple XLink.
    let href, baseURI;
    node = event.target;
    while (node && !href) {
      if (node.nodeType == content.Node.ELEMENT_NODE &&
          (node.localName == "a" ||
           node.namespaceURI == "http://www.w3.org/1998/Math/MathML")) {
        href = node.getAttribute("href") ||
               node.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        if (href) {
          baseURI = node.ownerDocument.baseURIObject;
          break;
        }
      }
      node = node.parentNode;
    }

    // In case of XLink, we don't return the node we got href from since
    // callers expect <a>-like elements.
    // Note: makeURI() will throw if aUri is not a valid URI.
    return href ? Services.io.newURI(href, null, baseURI).spec : null;
  }
};
