TEMPLATE = subdirs

SUBDIRS += search-engines

OTHER_FILES += \
    jsscripts/*.js \
    jsscripts/*.jsm \
    jsscripts/*.xml \
    jsscripts/sync/*.js \
    jsscripts/*.manifest \
    jsscripts/*.am \
    jscomps/*.js \
    jscomps/*.jsm \
    jscomps/*.manifest \
    jscomps/*.am \
    overrides/*.* \
    overrides/images/* \
    overrides/en-US/* \
    overrides/fi/* \
    overrides/ru/* \
    tools/*.py \
    configure.ac \
    link_to_system.sh \
    rpm/*.spec
