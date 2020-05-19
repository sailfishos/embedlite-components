TEMPLATE = subdirs

SOURCES += chromehelper/*.cpp \
    logger/*.cpp \
    history/*.cpp \
    touchhelper/*.cpp \
    widgetfactory/*.cpp

HEADERS += chromehelper/*.h \
    logger/*.h \
    history/*.h \
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
