/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "EmbedTouchListener.h"

#include "nsServiceManagerUtils.h"
#include "nsIObserverService.h"
#include "mozilla/embedlite/EmbedLog.h"

#include "nsIInterfaceRequestorUtils.h"
#include "nsIDOMWindow.h"
#include "nsIDOMDocument.h"
#include "nsIDOMElement.h"
#include "nsIDOMHTMLInputElement.h"
#include "nsIDocument.h"
#include "nsIDOMEventTarget.h"
#include "nsIDOMEvent.h"
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
#include "nsIDOMHTMLIFrameElement.h"
#include "nsIDOMHTMLFrameElement.h"
#include "nsIDOMClientRect.h"
#include "nsIDOMHTMLLIElement.h"
#include "nsIDOMCSSStyleDeclaration.h"
#include "nsIBaseWindow.h"
#include "nsPIDOMWindow.h"         // for nsPIDOMWindowOuter
#include "nsIDOMHTMLTextAreaElement.h"
#include "nsIDOMHTMLBodyElement.h"
#include "nsIDOMHTMLInputElement.h"
#include "nsIDOMHTMLAnchorElement.h"
#include "nsIDOMHTMLAreaElement.h"
#include "nsIDOMHTMLImageElement.h"
#include "mozilla/dom/ScriptSettings.h"

using namespace mozilla;

EmbedTouchListener::EmbedTouchListener(mozIDOMWindowProxy* aParent)
  : DOMWindow(nsPIDOMWindowOuter::From(aParent))
{
    if (!mService) {
        mService = do_GetService("@mozilla.org/embedlite-app-service;1");
    }
    mService->GetIDByWindow(aParent, &mTopWinid);
}

EmbedTouchListener::~EmbedTouchListener()
{
}

NS_IMPL_ISUPPORTS(EmbedTouchListener, nsIDOMEventListener)

void EmbedTouchListener::HandleSingleTap(const CSSPoint& aPoint, mozilla::Modifiers)
{
    // SingleTap handler of JavaScript (embedhelper.js) is taken care of input zooming.
}

void EmbedTouchListener::HandleLongTap(const CSSPoint& aPoint, mozilla::Modifiers, uint64_t)
{
    LOGT("pt[%f,%f]", aPoint.x, aPoint.y);
}

void EmbedTouchListener::HandleScrollEvent(bool aIsRootScrollFrame,
                                           const mozilla::CSSRect& aRect,
                                           const mozilla::CSSSize& aSize)
{
    // LOGT("r[%g,%g,%g,%g], size[%g,%g]", aRect.x, aRect.y, aRect.width, aRect.height, aSize.width, aSize.height);
}

NS_IMETHODIMP
EmbedTouchListener::HandleEvent(nsIDOMEvent* aEvent)
{
    nsAutoString type;
    if (aEvent) {
        aEvent->GetType(type);
    }
    LOGT("Event:'%s'", NS_ConvertUTF16toUTF8(type).get());

    return NS_OK;
}

void EmbedTouchListener::HandleDoubleTap(const CSSPoint& aPoint, mozilla::Modifiers)
{
    LOGT("pt[%f,%f]", aPoint.x, aPoint.y);

    nsCOMPtr<nsIDOMElement> element;
    gfxRect retRect(0,0,0,0);
    AnyElementFromPoint(DOMWindow, aPoint.x, aPoint.y, getter_AddRefs(element));
    if (!element) {
        mService->ZoomToRect(mTopWinid, 0, 0, 0, 0);
        return;
    }

    nsCOMPtr<nsIDOMNode> node = do_QueryInterface(element);
    NS_ENSURE_TRUE(node, );
    nsCOMPtr<nsIDOMElement> elementtest = element;
    while (elementtest && !ShouldZoomToElement(elementtest)) {
        node->GetParentNode(getter_AddRefs(node));
        elementtest = do_QueryInterface(node);
        if (elementtest) {
            element = elementtest;
        }
    }

    // Don't zoom in or out when in full screen
    nsCOMPtr<nsIDOMDocument> document;
    NS_ENSURE_SUCCESS(node->GetOwnerDocument(getter_AddRefs(document)), );
    bool isFullScreen(false);
    document->GetMozFullScreen(&isFullScreen);
    if (isFullScreen) {
        return;
    }

    if (!element) {
        mService->ZoomToRect(mTopWinid, 0, 0, 0, 0);
    } else {
        ZoomToElement(element, aPoint.y, true, true);
    }
}

void
EmbedTouchListener::AnyElementFromPoint(mozIDOMWindowProxy* aWindow, double aX, double aY, nsIDOMElement* *aElem)
{
    mozilla::dom::AutoNoJSAPI noJSAPI();
    nsCOMPtr<nsIDOMWindowUtils> utils = do_GetInterface(aWindow);
    nsCOMPtr<nsIDOMElement> elem;
    NS_ENSURE_SUCCESS(utils->ElementFromPoint(aX, aY, true, true, getter_AddRefs(elem)), );

    nsCOMPtr<nsIDOMHTMLIFrameElement> elAsIFrame = do_QueryInterface(elem);
    nsCOMPtr<nsIDOMHTMLFrameElement> elAsFrame = do_QueryInterface(elem);
    while (elem && (elAsIFrame || elAsFrame)) {
        nsCOMPtr<nsIDOMClientRect> rect;
        elem->GetBoundingClientRect(getter_AddRefs(rect));
        float left, top;
        rect->GetLeft(&left);
        rect->GetTop(&top);
        aX -= left;
        aY -= top;
        nsCOMPtr<nsIDOMDocument> contentDocument;
        if (!elAsIFrame || NS_FAILED(elAsIFrame->GetContentDocument(getter_AddRefs(contentDocument)))) {
            if (!elAsFrame || NS_FAILED(elAsFrame->GetContentDocument(getter_AddRefs(contentDocument)))) {
                break;
            }
        }
        nsCOMPtr<mozIDOMWindowProxy> newWin;
        contentDocument->GetDefaultView(getter_AddRefs(newWin));
        utils = do_GetInterface(newWin);
        if (NS_FAILED(utils->ElementFromPoint(aX, aY, true, true, getter_AddRefs(elem)))) {
            elem = nullptr;
        } else {
            elAsIFrame = do_QueryInterface(elem);
            elAsFrame = do_QueryInterface(elem);
        }
    }
    if (elem) {
        NS_ADDREF(*aElem = elem);
    }

    return;
}

bool
EmbedTouchListener::ShouldZoomToElement(nsIDOMElement* aElement)
{
#if 0

    nsCOMPtr<nsIDOMNode> node = do_QueryInterface(aElement);
    NS_ENSURE_TRUE(node, false);

    nsCOMPtr<nsIDOMDocument> document;
    NS_ENSURE_SUCCESS(node->GetOwnerDocument(getter_AddRefs(document)), false);

    nsCOMPtr<nsIDOMWindow> win;
    NS_ENSURE_SUCCESS(document->GetDefaultView(getter_AddRefs(win)), false);

    nsCOMPtr<nsPIDOMWindow> pwin = do_GetInterface(win);
    NS_ENSURE_TRUE(pwin, false);

    nsCOMPtr<mozilla::dom::Element> element = do_QueryInterface(aElement);
    NS_ENSURE_TRUE(element, false);

    nsCOMPtr<nsIDOMCSSStyleDeclaration> bW;
    {
      mozilla::ErrorResult rv;
      bW = pwin->GetComputedStyle(*element, nsString(), rv);
    }
    NS_ENSURE_TRUE(bW, false);

    nsString display;
    if (NS_SUCCEEDED(bW->GetPropertyValue(NS_LITERAL_STRING("display"), display))) {
        if (display.EqualsLiteral("inline")) {
            return false;
        }
    }
    nsCOMPtr<nsIDOMHTMLLIElement> liel = do_QueryInterface(aElement);
    nsCOMPtr<nsIDOMHTMLLIElement> qoteel = do_QueryInterface(aElement);
    if (liel || qoteel)
        return false;
#endif
    return true;
}

/* Zoom to an element, optionally keeping a particular part of it
 * in view if it is really tall.
 */
void
EmbedTouchListener::ZoomToElement(nsIDOMElement* aElement, int aClickY, bool aCanZoomOut, bool aCanZoomIn)
{
    const int margin = 15;
    gfx::Rect clrect = GetBoundingContentRect(aElement);
    clrect.x = std::max(float(0.0), clrect.x - margin);
    clrect.y = std::max(float(0.0), clrect.y - margin);
    clrect.width = std::min(clrect.width + 2*margin, mCssCompositedRect.width);
    clrect.height = std::min(clrect.height + 2*margin, mCssCompositedRect.height);
    float elementAspectRatio = clrect.width / clrect.height;
    float viewportAspectRatio = mCssCompositedRect.width / mCssCompositedRect.height;
    bool zoomed = false;
    if (IsRectZoomedIn(clrect, mCssCompositedRect)) {
        if (aCanZoomOut) {
            mService->ZoomToRect(mTopWinid, 0, 0, 0, 0);
        }
        return;
    }
    if (elementAspectRatio > viewportAspectRatio) {
        if ((clrect.width < mCssCompositedRect.width && aCanZoomIn) ||
            (clrect.width > mCssCompositedRect.width && aCanZoomOut) ) {
            mService->ZoomToRect(mTopWinid, clrect.x, clrect.y, clrect.width, clrect.height);
            zoomed = true;
        }
    }
    else if (elementAspectRatio < viewportAspectRatio && viewportAspectRatio < 1) {
        if ((clrect.height < mCssCompositedRect.height && aCanZoomIn) ||
            (clrect.height > mCssCompositedRect.height && aCanZoomOut) ) {
            mService->ZoomToRect(mTopWinid, clrect.x, clrect.y, clrect.width, clrect.height);
            zoomed = true;
        }
    }

    if (!zoomed) {
        mService->ZoomToRect(mTopWinid, clrect.x, clrect.y, mCssCompositedRect.width, mCssCompositedRect.height);
    }
}

static bool HasFrameElement(nsIDOMDocument* aDocument, nsIDOMElement* *aFrameElement = nullptr)
{
    if (!aDocument) {
        return false;
    }
    nsCOMPtr<mozIDOMWindowProxy> newWin;
    if (NS_FAILED(aDocument->GetDefaultView(getter_AddRefs(newWin))) || !newWin) {
        return false;
    }

    nsCOMPtr<nsPIDOMWindowOuter> pwin = do_GetInterface(newWin);
    nsCOMPtr<nsIDOMElement> frameElement = pwin->GetFrameElement();
    if (!frameElement) {
        return false;
    }
    if (aFrameElement) {
        *aFrameElement = frameElement.forget().take();
    }
    return true;
}

static void GetDefViewFrameElemOwnerDocument(nsIDOMDocument* aDocument, nsIDOMDocument* *aOutDocument)
{
    nsCOMPtr<nsIDOMElement> frameElement;
    if (HasFrameElement(aDocument, getter_AddRefs(frameElement)) && frameElement) {
        nsCOMPtr<nsIDOMNode> node = do_QueryInterface(frameElement);
        if (node) {
            node->GetOwnerDocument(aOutDocument);
        }
    }
}

static bool _HasFrameElement(nsPIDOMWindowOuter* aWindow)
{
    if (!aWindow) {
        return false;
    }

    nsCOMPtr<nsIDOMElement> frameElement = aWindow->GetFrameElement();
    if (!frameElement) {
        return false;
    }
    return true;
}

static void GetParentFrame(nsPIDOMWindowOuter* aWindow, nsPIDOMWindowOuter** outWindow)
{
    if (aWindow) {
      nsCOMPtr<nsPIDOMWindowOuter> newWin = aWindow->GetParent();
      *outWindow = newWin.forget().take();
    }
}

gfx::Rect
EmbedTouchListener::GetBoundingContentRect(nsIDOMElement* aElement)
{
    gfx::Rect retRect(0, 0, 0, 0);
    if (!aElement)
      return retRect;

    nsCOMPtr<nsIDOMNode> node = do_QueryInterface(aElement);
    NS_ENSURE_TRUE(node, retRect);

    nsCOMPtr<nsIDOMDocument> origDocument;
    nsCOMPtr<nsIDOMDocument> document;
    NS_ENSURE_SUCCESS(node->GetOwnerDocument(getter_AddRefs(document)), retRect);
    origDocument = document;
    while (HasFrameElement(document)) {
        nsCOMPtr<nsIDOMDocument> newDocument;
        GetDefViewFrameElemOwnerDocument(document, getter_AddRefs(newDocument));
        if (newDocument)
            document = newDocument;
        else
            break;
    }

    nsCOMPtr<mozIDOMWindowProxy> newWin;
    if (NS_FAILED(document->GetDefaultView(getter_AddRefs(newWin))) || !newWin) {
        return retRect;
    }

    mozilla::dom::AutoNoJSAPI noJSAPI();
    nsCOMPtr<nsIDOMWindowUtils> utils = do_GetInterface(newWin);
    int32_t scrollX = 0, scrollY = 0;
    NS_ENSURE_SUCCESS(utils->GetScrollXY(false, &scrollX, &scrollY), retRect);
    nsCOMPtr<nsIDOMClientRect> r;
    aElement->GetBoundingClientRect(getter_AddRefs(r));

    nsCOMPtr<mozIDOMWindowProxy> defView;
    origDocument->GetDefaultView(getter_AddRefs(defView));
    nsCOMPtr<nsPIDOMWindowOuter> pwin = do_GetInterface(defView);
    for (nsCOMPtr<nsPIDOMWindowOuter> frame = pwin; _HasFrameElement(frame) && frame != DOMWindow; GetParentFrame(frame, getter_AddRefs(frame))) {
      nsCOMPtr<nsIDOMElement> frElement = frame->GetFrameElement();
      if (frElement) {
        nsCOMPtr<nsIDOMClientRect> gr;
        frElement->GetBoundingClientRect(getter_AddRefs(gr));
        float grleft, grtop;
        gr->GetLeft(&grleft);
          gr->GetTop(&grtop);

#if 0
        // Read computed style
        nsCOMPtr<mozilla::dom::Element> element = do_QueryInterface(frElement);
        if (frame && element) {
          nsCOMPtr<nsIDOMCSSStyleDeclaration> bW;
          {
            mozilla::ErrorResult rv;
            bW = frame->GetComputedStyle(*element, nsString(), rv);
          }
          if (bW) {
            nsString blw, btw;
            bW->GetPropertyValue(NS_LITERAL_STRING("border-left-width"), blw);
            bW->GetPropertyValue(NS_LITERAL_STRING("border-top-width"), btw);
            scrollX += grleft + atoi(NS_ConvertUTF16toUTF8(blw).get());
            scrollY += grtop + atoi(NS_ConvertUTF16toUTF8(btw).get());
          }
        }
#endif
      }
    }

    float rleft = 0, rtop = 0, rwidth = 0, rheight = 0;
    r->GetLeft(&rleft);
    r->GetTop(&rtop);
    r->GetWidth(&rwidth);
    r->GetHeight(&rheight);

    return gfx::Rect(rleft + scrollX,
                     rtop + scrollY,
                     rwidth, rheight);
}

bool
EmbedTouchListener::IsRectZoomedIn(gfx::Rect aRect, gfx::Rect aViewport)
{
    // This function checks to see if the area of the rect visible in the
    // viewport (i.e. the "overlapArea" variable below) is approximately 
    // the max area of the rect we can show.
    gfx::Rect vRect(aViewport);
    gfx::Rect overlap = vRect.Intersect(aRect);
    float overlapArea = overlap.width * overlap.height;
    float availHeight = std::min(aRect.width * vRect.height / vRect.width, aRect.height);
    float showing = overlapArea / (aRect.width * availHeight);
    float ratioW = (aRect.width / vRect.width);
    float ratioH = (aRect.height / vRect.height);

    return (showing > 0.9 && (ratioW > 0.9 || ratioH > 0.9)); 
}

void EmbedTouchListener::ScrollUpdate(const mozilla::CSSPoint&, float)
{
}
