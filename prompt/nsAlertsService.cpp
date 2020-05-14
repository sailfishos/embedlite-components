/* -*- Mode: C++; tab-width: 2; indent-tabs-mode:nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "../logger/EmbedComponentsLog.h"

#include "nsXULAppAPI.h"

#include "nsAlertsService.h"
#include "nsStringGlue.h"

#include "nsISupportsArray.h"
#include "nsXPCOM.h"
#include "nsISupportsPrimitives.h"
#include "nsIServiceManager.h"
#include "nsIDOMWindow.h"
#include "nsIWindowWatcher.h"
#include "nsToolkitCompsCID.h"

using namespace mozilla;

NS_IMPL_ISUPPORTS(nsEmbedAlertsService, nsIAlertsService)

nsEmbedAlertsService::nsEmbedAlertsService()
{
}

nsEmbedAlertsService::~nsEmbedAlertsService()
{
}

bool nsEmbedAlertsService::ShouldShowAlert()
{
  bool result = true;
  LOGT("");
  return result;
}

NS_IMETHODIMP nsEmbedAlertsService::ShowAlertNotification(const nsAString& aImageUrl, const nsAString& aAlertTitle,
                                                          const nsAString& aAlertText, bool aAlertTextClickable,
                                                          const nsAString& aAlertCookie, nsIObserver* aAlertListener,
                                                          const nsAString& aAlertName, const nsAString& aBidi,
                                                          const nsAString& aLang, const nsAString & data, nsIPrincipal *principal,
                                                          bool aInPrivateBrowsing, bool aRequireInteraction)
{
  LOGT("image: '%s', title: '%s', text: '%s', clickable: %i, cookie: '%s', name: '%s'", __PRETTY_FUNCTION__, __LINE__,
       NS_ConvertUTF16toUTF8(aImageUrl).get(),
       NS_ConvertUTF16toUTF8(aAlertTitle).get(),
       NS_ConvertUTF16toUTF8(aAlertText).get(),
       aAlertTextClickable,
       NS_ConvertUTF16toUTF8(aAlertCookie).get(),
       NS_ConvertUTF16toUTF8(aAlertName).get()
       );

  // Do not display the alert. Instead call alertfinished and get out.
  if (aAlertListener)
    aAlertListener->Observe(nullptr, "alertclickcallback", PromiseFlatString(aAlertCookie).get());

  return NS_OK;
}

NS_IMETHODIMP nsEmbedAlertsService::CloseAlert(const nsAString & name, nsIPrincipal*)
{
  LOGT("name: '%s'", NS_ConvertUTF16toUTF8(name).get());
  return NS_OK;
}
