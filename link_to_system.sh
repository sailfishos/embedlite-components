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
jscomps/EmbedLiteJSComponents.manifest
jscomps/AboutRedirector.sys.mjs
jscomps/LoginManagerPrompter.sys.mjs
jscomps/HelperAppDialog.sys.mjs
jscomps/FilePicker.js
jscomps/ContentPermissionPrompt.sys.mjs
jscomps/ContentPermissionManager.sys.mjs
jscomps/EmbedLiteGlobalHelper.sys.mjs
jscomps/EmbedLiteNetErrorChild.sys.mjs
jscomps/EmbedLitePromptParent.sys.mjs
jscomps/EmbedLiteSelectionParent.sys.mjs
jscomps/EmbedLiteWebRTCChild.sys.mjs
jscomps/EmbedLiteWebRTCParent.sys.mjs
jscomps/EmbedLiteWebRTCProcessChild.sys.mjs
jscomps/EmbedLiteConsoleListener.sys.mjs
jscomps/EmbedPrefService.sys.mjs
jscomps/EmbedLiteChromeManager.sys.mjs
jscomps/EmbedLiteSearchEngine.sys.mjs
jscomps/UserAgentOverrideHelper.sys.mjs
jscomps/XPIDialogService.sys.mjs
jscomps/PrivateDataManager.sys.mjs
jscomps/EmbedliteDownloadManager.sys.mjs
jscomps/LoginsHelper.sys.mjs
jscomps/EmbedLiteWebrtcUI.sys.mjs
jscomps/IntentProtocolHandler.sys.mjs
"

for str in $FILES_LIST; do
    fname="${str##*/}"
    rm -f $TARGET_DIR/components/$fname;
    ln -s $(pwd)/$str $TARGET_DIR/components/$fname;
done

rm -f $TARGET_DIR/chrome/EmbedLiteJSScripts.manifest;
ln -s $(pwd)/jsscripts/EmbedLiteJSScripts.manifest $TARGET_DIR/chrome/EmbedLiteJSScripts.manifest;

rm -rf $TARGET_DIR/chrome/embedlite;
mkdir -p $TARGET_DIR/chrome/embedlite/content/search-plugins;
ln -s $(pwd)/jsscripts/embedhelper.js $TARGET_DIR/chrome/embedlite/content/embedhelper.js;
ln -s $(pwd)/jsscripts/UserAgentUpdates.sys.mjs $TARGET_DIR/chrome/embedlite/content/UserAgentUpdates.sys.mjs;
ln -s $(pwd)/jsscripts/UserAgentOverrides.sys.mjs $TARGET_DIR/chrome/embedlite/content/UserAgentOverrides.sys.mjs;
ln -s $(pwd)/jsscripts/SelectAsyncHelper.js $TARGET_DIR/chrome/embedlite/content/SelectAsyncHelper.js;
ln -s $(pwd)/jsscripts/ClipboardReadPasteHelper.js $TARGET_DIR/chrome/embedlite/content/ClipboardReadPasteHelper.js;
ln -s $(pwd)/jsscripts/SelectionHandler.js $TARGET_DIR/chrome/embedlite/content/SelectionHandler.js;
ln -s $(pwd)/jsscripts/SelectionPrototype.js $TARGET_DIR/chrome/embedlite/content/SelectionPrototype.js;
ln -s $(pwd)/jsscripts/Util.js $TARGET_DIR/chrome/embedlite/content/Util.js;
ln -s $(pwd)/jsscripts/Logger.js $TARGET_DIR/chrome/embedlite/content/Logger.js;
ln -s $(pwd)/jsscripts/ClickEventBlocker.js $TARGET_DIR/chrome/embedlite/content/ClickEventBlocker.js;
ln -s $(pwd)/jsscripts/ContextMenuHandler.js $TARGET_DIR/chrome/embedlite/content/ContextMenuHandler.js;
ln -s $(pwd)/search-engines/google.xml $TARGET_DIR/chrome/embedlite/content/search-plugins/google.xml;
ln -s $(pwd)/search-engines/bing.xml $TARGET_DIR/chrome/embedlite/content/search-plugins/bing.xml;
ln -s $(pwd)/search-engines/yahoo.xml $TARGET_DIR/chrome/embedlite/content/search-plugins/yahoo.xml;
ln -s $(pwd)/search-engines/baidu.xml $TARGET_DIR/chrome/embedlite/content/search-plugins/baidu.xml;
ln -s $(pwd)/search-engines/duckduckgo.xml $TARGET_DIR/chrome/embedlite/content/search-plugins/duckduckgo.xml;
ln -s $(pwd)/search-engines/yandex.xml $TARGET_DIR/chrome/embedlite/content/search-plugins/yandex.xml;
ln -s $(pwd)/search-engines/list.json $TARGET_DIR/chrome/embedlite/content/search-plugins/list.json;

rm -f $TARGET_DIR/chrome/EmbedLiteOverrides.manifest;
ln -s $(pwd)/overrides/EmbedLiteOverrides.manifest $TARGET_DIR/chrome/EmbedLiteOverrides.manifest;

rm -rf $TARGET_DIR/chrome/chrome;
mkdir -p $TARGET_DIR/chrome/chrome/content;
mkdir -p $TARGET_DIR/chrome/chrome/skin;
mkdir -p $TARGET_DIR/chrome/chrome/skin/images;
ln -s $(pwd)/overrides/netError.xhtml $TARGET_DIR/chrome/chrome/content/
ln -s $(pwd)/overrides/appstrings.properties $TARGET_DIR/chrome/chrome/content/
ln -s $(pwd)/overrides/netError.css $TARGET_DIR/chrome/chrome/skin/
ln -s $(pwd)/overrides/embedliteAboutNetError.css $TARGET_DIR/chrome/chrome/skin/
ln -s $(pwd)/overrides/touchcontrols.css $TARGET_DIR/chrome/chrome/skin/
ln -s $(pwd)/overrides/images/clicktoplay-bgtexture.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/error.png $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/icon-m-pause.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/icon-m-play.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/icon-m-speaker-mute.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/icon-m-speaker-on.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videoClickToPlayButton.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videocontrols-cast-active.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videocontrols-cast-ready.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videocontrols-exitfullscreen.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videocontrols-fullscreen.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videocontrols-mute.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videocontrols-pause.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videocontrols-play.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videocontrols-scrubber.svg $TARGET_DIR/chrome/chrome/skin/images/
ln -s $(pwd)/overrides/images/videocontrols-unmute.svg $TARGET_DIR/chrome/chrome/skin/images/

rm -rf $TARGET_DIR/chrome/en-US/locale/branding;
rm -rf $TARGET_DIR/chrome/en-US/locale/en-US/browser;
mkdir -p $TARGET_DIR/chrome/en-US/locale/branding;
mkdir -p $TARGET_DIR/chrome/en-US/locale/en-US/browser;
ln -s $(pwd)/overrides/brand.dtd $TARGET_DIR/chrome/en-US/locale/branding/
ln -s $(pwd)/overrides/brand.properties $TARGET_DIR/chrome/en-US/locale/branding/
ln -s $(pwd)/overrides/netError.dtd $TARGET_DIR/chrome/en-US/locale/en-US/browser/
