/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "EmbedChromeListener.h"
#include "../logger/EmbedComponentsLog.h"

#include "nsServiceManagerUtils.h"
#include "nsIObserverService.h"
#include "nsStringGlue.h"
#include "nsIInterfaceRequestorUtils.h"
#include "nsIDOMWindow.h"
#include "nsIDOMEventTarget.h"
#include "nsIDOMEvent.h"
#include "nsIURI.h"
#include "nsIDOMDocument.h"
#include "nsPIDOMWindow.h"
#include "nsIEmbedLiteJSON.h"
#include "nsComponentManagerUtils.h"
#include "nsIVariant.h"
#include "nsHashPropertyBag.h"
#include "nsIDOMWindowUtils.h"
#include "nsIDOMHTMLLinkElement.h"
#include "nsIFocusManager.h"
#include "nsIDocShellTreeItem.h"
#include "nsIWebNavigation.h"
#include "mozilla/dom/ScriptSettings.h"

EmbedChromeListener::EmbedChromeListener(mozIDOMWindowProxy *aWin)
  :  DOMWindow(aWin)
  ,  mWindowCounter(0)
{
    if (!mService) {
        mService = do_GetService("@mozilla.org/embedlite-app-service;1");
    }
}

EmbedChromeListener::~EmbedChromeListener()
{
}

NS_IMPL_ISUPPORTS(EmbedChromeListener, nsIDOMEventListener)

NS_IMETHODIMP
EmbedChromeListener::HandleEvent(nsIDOMEvent* aEvent)
{
    nsresult rv;
    nsString type;
    if (aEvent) {
        aEvent->GetType(type);
    }
    // LOGT("Event:'%s'", NS_ConvertUTF16toUTF8(type).get());

    nsString messageName;
    nsString message;
    // Just simple property bag support still
    nsCOMPtr<nsIEmbedLiteJSON> json = do_GetService("@mozilla.org/embedlite-json;1", &rv);
    if (!json) {
        LOGT("Failed to create json component");
    }
    nsCOMPtr<nsIWritablePropertyBag2> root;
    json->CreateObject(getter_AddRefs(root));

    uint32_t winId;
    mService->GetIDByWindow(DOMWindow, &winId);
    NS_ENSURE_TRUE(winId , NS_ERROR_FAILURE);
    mozilla::dom::AutoNoJSAPI noJSAPI();

    if (type.EqualsLiteral(MOZ_DOMMetaAdded)) {
        messageName.AssignLiteral("chrome:metaadded");
    } else if (type.EqualsLiteral(MOZ_DOMContentLoaded)) {
        nsCOMPtr<nsIWebNavigation> webNav(do_GetInterface(DOMWindow));
        nsCOMPtr<nsIDOMDocument> ctDoc;
        webNav->GetDocument(getter_AddRefs(ctDoc));
        nsString docURI;
        ctDoc->GetDocumentURI(docURI);
        if (!docURI.EqualsLiteral("about:blank")) {
            messageName.AssignLiteral("chrome:contentloaded");
            root->SetPropertyAsAString(NS_LITERAL_STRING("docuri"), docURI);
        }
        // Need send session history from here
    } else if (type.EqualsLiteral(MOZ_DOMLinkAdded)) {
        nsCOMPtr<nsIDOMEventTarget> origTarget;
        aEvent->GetOriginalTarget(getter_AddRefs(origTarget));
        nsCOMPtr<nsIDOMHTMLLinkElement> disabledIface = do_QueryInterface(origTarget);
        nsString href;
        bool disabled = true;
        disabledIface->GetMozDisabled(&disabled);
        if (!disabledIface || disabled) {
            return NS_OK;
        }
        disabledIface->GetHref(href);
        nsCOMPtr<nsIWebNavigation> webNav(do_GetInterface(DOMWindow));
        nsCOMPtr<nsIDOMDocument> ctDoc;
        webNav->GetDocument(getter_AddRefs(ctDoc));
        // ignore on frames and other documents
        nsCOMPtr<nsIDOMDocument> ownDoc;
        nsCOMPtr<nsIDOMNode> node = do_QueryInterface(origTarget);
        node->GetOwnerDocument(getter_AddRefs(ownDoc));
        if (ownDoc != ctDoc) {
          return NS_OK;
        }

        nsString charset, title, rel, type;
        ctDoc->GetCharacterSet(charset);
        ctDoc->GetTitle(title);
        disabledIface->GetRel(rel);
        disabledIface->GetType(type);
        nsString sizes;
        nsCOMPtr<nsIDOMElement> element = do_QueryInterface(origTarget);
        bool hasSizesAttr = false;
        if (NS_SUCCEEDED(element->HasAttribute(NS_LITERAL_STRING("sizes"), &hasSizesAttr)) && hasSizesAttr) {
            element->GetAttribute(NS_LITERAL_STRING("sizes"), sizes);
        }
        messageName.AssignLiteral("chrome:linkadded");
        root->SetPropertyAsAString(NS_LITERAL_STRING("href"), href);
        root->SetPropertyAsAString(NS_LITERAL_STRING("charset"), charset);
        root->SetPropertyAsAString(NS_LITERAL_STRING("title"), title);
        root->SetPropertyAsAString(NS_LITERAL_STRING("rel"), rel);
        root->SetPropertyAsAString(NS_LITERAL_STRING("sizes"), sizes);
        root->SetPropertyAsAString(NS_LITERAL_STRING("get"), type);
    } else if (type.EqualsLiteral(MOZ_DOMWillOpenModalDialog) ||
               type.EqualsLiteral(MOZ_DOMModalDialogClosed) ||
               type.EqualsLiteral(MOZ_DOMWindowClose)) {
        messageName.AssignLiteral("chrome:winopenclose");
        root->SetPropertyAsAString(NS_LITERAL_STRING("type"), type);
    } else {
        return NS_OK;
    }

    nsString outStr;
    json->CreateJSON(root, message);
    mService->SendAsyncMessage(winId, messageName.get(), message.get());

    return NS_OK;
}
