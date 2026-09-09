TEMPLATE = subdirs

SUBDIRS += search-engines

OTHER_FILES += \
    jsscripts/*.js \
    jsscripts/*.jsm \
    jsscripts/*.mjs \
    jsscripts/*.xml \
    jsscripts/*.manifest \
    jsscripts/*.am \
    jscomps/*.js \
    jscomps/*.jsm \
    jscomps/*.mjs \
    jscomps/*.manifest \
    jscomps/*.am \
    overrides/*.* \
    overrides/en-US/* \
    overrides/fi/* \
    overrides/ru/* \
    tools/*.py \
    configure.ac \
    link_to_system.sh \
    rpm/*.spec
