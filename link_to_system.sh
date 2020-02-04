#!/bin/sh

TARGET_DIR=$1
if [ "$TARGET_DIR" = "" ]; then
  echo "TARGET_DIR ex: /usr/lib/mozembedlite"
  TARGET_DIR=/usr/lib/mozembedlite
fi

OBJPREFIX=$2
if [ "$OBJPREFIX" = "" ]; then
  BARCH=`uname -m`
  OBJPREFIX=objdir-$BARCH
fi

LAST_OBJ_DIR="$OBJPREFIX"

mkdir -p $TARGET_DIR
mkdir -p $TARGET_DIR/components

FILES_LIST="
$OBJPREFIX/chromehelper/.libs/libchromehelper.so
$OBJPREFIX/history/.libs/libhistory.so
$OBJPREFIX/prompt/.libs/libprompt.so
$OBJPREFIX/touchhelper/.libs/libtouchhelper.so
$OBJPREFIX/widgetfactory/.libs/libwidgetfactory.so
EmbedLiteBinComponents.manifest
jscomps/EmbedLiteJSComponents.manifest
jscomps/AboutRedirector.js
jscomps/AlertsService.js
jscomps/LoginManagerPrompter.js
jscomps/HelperAppDialog.js
jscomps/EmbedPrefService.js
jscomps/ContentPermissionPrompt.js
jscomps/EmbedLiteGlobalHelper.js
jscomps/EmbedLiteConsoleListener.js
jscomps/EmbedLiteSyncService.js
jscomps/EmbedLiteFaviconService.js
jscomps/EmbedLiteOrientationChangeHandler.js
jscomps/EmbedLiteSearchEngine.js
jscomps/EmbedLiteErrorPageHandler.js
jscomps/UserAgentOverrideHelper.js
jscomps/XPIDialogService.js
jscomps/EmbedLiteWebAppInstall.js
jscomps/PromptService.js
jscomps/PrivateDataManager.js
jscomps/EmbedliteDownloadManager.js
jscomps/MailtoProtocolHandler.js
"

for str in $FILES_LIST; do
    fname="${str##*/}"
    rm -f $TARGET_DIR/components/$fname;
    ln -s $(pwd)/$str $TARGET_DIR/components/$fname;
done

rm -f $TARGET_DIR/chrome/EmbedLiteJSScripts.manifest;
ln -s $(pwd)/jsscripts/EmbedLiteJSScripts.manifest $TARGET_DIR/chrome/EmbedLiteJSScripts.manifest;

rm -rf $TARGET_DIR/chrome/embedlite;
mkdir -p $TARGET_DIR/chrome/embedlite/content/sync;
ln -s $(pwd)/jsscripts/embedhelper.js $TARGET_DIR/chrome/embedlite/content/embedhelper.js;
ln -s $(pwd)/jsscripts/OrientationChangeHandler.jsm $TARGET_DIR/chrome/embedlite/content/OrientationChangeHandler.jsm;
ln -s $(pwd)/jsscripts/SelectHelper.js $TARGET_DIR/chrome/embedlite/content/SelectHelper.js;
ln -s $(pwd)/jsscripts/SelectAsyncHelper.js $TARGET_DIR/chrome/embedlite/content/SelectAsyncHelper.js;
ln -s $(pwd)/jsscripts/SelectionHandler.js $TARGET_DIR/chrome/embedlite/content/SelectionHandler.js;
ln -s $(pwd)/jsscripts/SelectionPrototype.js $TARGET_DIR/chrome/embedlite/content/SelectionPrototype.js;
ln -s $(pwd)/jsscripts/Util.js $TARGET_DIR/chrome/embedlite/content/Util.js;
ln -s $(pwd)/jsscripts/ContextMenuHandler.js $TARGET_DIR/chrome/embedlite/content/ContextMenuHandler.js;
ln -s $(pwd)/search-engines/google.xml $TARGET_DIR/chrome/embedlite/content/google.xml;
ln -s $(pwd)/search-engines/bing.xml $TARGET_DIR/chrome/embedlite/content/bing.xml;
ln -s $(pwd)/search-engines/yahoo.xml $TARGET_DIR/chrome/embedlite/content/yahoo.xml;
ln -s $(pwd)/search-engines/baidu.xml $TARGET_DIR/chrome/embedlite/content/baidu.xml;
ln -s $(pwd)/search-engines/duckduckgo.xml $TARGET_DIR/chrome/embedlite/content/duckduckgo.xml;
ln -s $(pwd)/search-engines/yandex.xml $TARGET_DIR/chrome/embedlite/content/yandex.xml;

ln -s $(pwd)/jsscripts/sync/bookmarks.js $TARGET_DIR/chrome/embedlite/content/sync/bookmarks.js;

rm -f $TARGET_DIR/chrome/EmbedLiteOverrides.manifest;
ln -s $(pwd)/overrides/EmbedLiteOverrides.manifest $TARGET_DIR/chrome/EmbedLiteOverrides.manifest;

rm -rf $TARGET_DIR/chrome/chrome;
mkdir -p $TARGET_DIR/chrome/chrome/content;
mkdir -p $TARGET_DIR/chrome/chrome/skin;
mkdir -p $TARGET_DIR/chrome/chrome/skin/images;
ln -s $(pwd)/overrides/aboutCertError.xhtml $TARGET_DIR/chrome/chrome/content/
ln -s $(pwd)/overrides/netError.xhtml $TARGET_DIR/chrome/chrome/content/
ln -s $(pwd)/overrides/netError.css $TARGET_DIR/chrome/chrome/skin/
ln -s $(pwd)/overrides/touchcontrols.css $TARGET_DIR/chrome/chrome/skin/
ln -s $(pwd)/overrides/images/mute-hdpi.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/pause-hdpi.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/play-hdpi.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/unmute-hdpi.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/error.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/exitfullscreen-hdpi.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/fullscreen-hdpi.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/throbber.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/scrubber-hdpi.png $TARGET_DIR/chrome/chrome/skin/images/

rm -rf $TARGET_DIR/chrome/en-US/locale/branding;
rm -rf $TARGET_DIR/chrome/en-US/locale/en-US/browser;
mkdir -p $TARGET_DIR/chrome/en-US/locale/branding;
mkdir -p $TARGET_DIR/chrome/en-US/locale/en-US/browser;
ln -s $(pwd)/overrides/brand.dtd $TARGET_DIR/chrome/en-US/locale/branding/
ln -s $(pwd)/overrides/brand.properties $TARGET_DIR/chrome/en-US/locale/branding/
ln -s $(pwd)/overrides/aboutCertError.dtd $TARGET_DIR/chrome/en-US/locale/en-US/browser/
ln -s $(pwd)/overrides/netError.dtd $TARGET_DIR/chrome/en-US/locale/en-US/browser/
