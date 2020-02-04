TEMPLATE = subdirs

SOURCES += chromehelper/*.cpp \
    history/*.cpp \
    prompt/*.cpp \
    touchhelper/*.cpp \
    widgetfactory/*.cpp

HEADERS += chromehelper/*.h \
    history/*.h \
    prompt/*.h \
    touchhelper/*.h \
    widgetfactory/*.h

SUBDIRS += search-engines

OTHER_FILES += \
    jsscripts/*.js \
    jsscripts/*.jsm \
    jsscripts/*.xml \
    jsscripts/sync/*.js \
    jscomps/*.js \
    jscomps/*.jsm \
    overrides/* \
    configure.ac
