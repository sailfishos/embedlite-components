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
    rpm/* \
    chromehelper/Makefile.am \
    history/Makefile.am \
    touchhelper/Makefile.am \
    widgetfactory/Makefile.am \
    jsscripts/Makefile.am \
    jscomps/Makefile.am \
    overrides/Makefile.am \
    Makefile.am \
    configure.ac\
    autogen.sh
