/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2020 Open Mobile Platform LLC.
 */

#ifndef MOZ_EMBEDLITE_COMPONENTS_LOG_H
#define MOZ_EMBEDLITE_COMPONENTS_LOG_H

#include <stdio.h>

namespace mozilla {
namespace embedlite {
bool LoggingEnabled();
}
}


#ifndef LOGT
#define LOGT(FMT, ...) if (mozilla::embedlite::LoggingEnabled()) { \
                           fprintf(stderr, \
                                   "EmbedLiteComponents [%p] %s::%d: " FMT "\n", this, __PRETTY_FUNCTION__, __LINE__, ##__VA_ARGS__); \
                       } else { \
                           do {} while (0); \
                       }
#endif

#endif
