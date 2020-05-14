/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2020 Open Mobile Platform LLC.
 */

#include "EmbedComponentsLog.h"

#include <cstdlib>
#include <cstring>

bool mozilla::embedlite::LoggingEnabled()
{
  static const char *hasEmbedLog = getenv("EMBEDLITE_COMPONENTS_LOGGING");
  return hasEmbedLog && strcmp(hasEmbedLog, "1") == 0;
}
